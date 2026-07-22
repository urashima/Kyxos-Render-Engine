import { PerspectiveCamera } from '@kyxos/render-camera';
import { createCubeGeometry } from '@kyxos/render-geometry';
import {
  createMaterialTextureBinding,
  createMaterialTextureReference,
} from '@kyxos/render-material-core';
import { PbrMaterial } from '@kyxos/render-material-pbr';
import { identityMat4 } from '@kyxos/render-math';
import { Scene } from '@kyxos/render-scene';
import { ManualFrameDriver, MockBackend } from '@kyxos/render-testing';
import { MeshRendererStore } from '@kyxos/render-visibility';
import { describe, expect, it, vi } from 'vitest';

import {
  KyxosRenderer,
  PBR_OBJECT_UNIFORM_LAYOUT,
  PbrMaterialLibrary,
  PbrRenderFeature,
  PbrTextureLibrary,
  PbrTextureSource,
  createPbrDirectionalLight,
  packPbrObjectUniforms,
} from '../src/index.js';

const target = {
  getContext: () => ({}),
  height: 0,
  width: 0,
};

function expectFloatTuple(actual: ArrayLike<number>, expected: readonly number[]): void {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((value, index) => expect(actual[index]).toBeCloseTo(value, 6));
}

describe('PBR GPU layout', () => {
  it('packs a stable 352-byte world-space material, lighting, and UV contract', () => {
    const material = new PbrMaterial({
      alphaCutoff: 0.35,
      baseColorFactor: [0.8, 0.3, 0.1, 0.7],
      emissiveFactor: [0.1, 0.2, 0.3],
      emissiveStrength: 4,
      metallicFactor: 0.65,
      normalScale: -1,
      occlusionStrength: 0.45,
      roughnessFactor: 0.42,
      textures: {
        'base-color': createMaterialTextureBinding({
          offset: [0.25, 0.5],
          rotation: Math.PI / 2,
          scale: [2, 3],
          texture: createMaterialTextureReference({
            id: 'base-color-layout',
            transferFunction: 'srgb',
          }),
        }),
        'metallic-roughness': createMaterialTextureBinding({
          offset: [-0.25, 0.125],
          rotation: Math.PI,
          scale: [0.5, 0.75],
          texture: createMaterialTextureReference({
            id: 'metallic-roughness-layout',
            transferFunction: 'linear',
          }),
        }),
      },
    });
    const light = createPbrDirectionalLight({
      color: [0.9, 0.8, 0.7],
      direction: [0, 0, 5],
      intensity: 2,
    });
    const packed = packPbrObjectUniforms({
      cameraPosition: [1, 2, 3],
      light,
      material: material.snapshot(),
      viewProjectionMatrix: identityMat4(),
      worldMatrix: identityMat4(),
    });

    expect(packed).toHaveLength(88);
    expect(packed.byteLength).toBe(PBR_OBJECT_UNIFORM_LAYOUT.byteLength);
    expectFloatTuple(packed.slice(48, 52), [0.8, 0.3, 0.1, 0.7]);
    expectFloatTuple(packed.slice(52, 56), [0.1, 0.2, 0.3, 4]);
    expectFloatTuple(packed.slice(56, 60), [0.65, 0.42, 0.35, 0]);
    expectFloatTuple(packed.slice(60, 64), [-1, 0.45, 1, 1]);
    expectFloatTuple(packed.slice(64, 68), [1, 2, 3, 1]);
    expectFloatTuple(packed.slice(68, 72), [0, 0, 1, 2]);
    expectFloatTuple(packed.slice(72, 76), [0.9, 0.8, 0.7, 0]);
    expectFloatTuple(packed.slice(76, 80), [0.25, 0.5, 2, 3]);
    expectFloatTuple(packed.slice(80, 84), [-0.25, 0.125, 0.5, 0.75]);
    expectFloatTuple(packed.slice(84, 88), [0, 1, -1, 0]);
  });
});

describe('PbrRenderFeature', () => {
  it('prewarms variants, shares Mesh uploads, refreshes bindings, and releases owned GPU Handles', async () => {
    const backend = new MockBackend();
    const createPipeline = vi.spyOn(backend, 'createRenderPipeline');
    const createBindGroup = vi.spyOn(backend, 'createBindGroup');
    const executeFrame = vi.spyOn(backend, 'executeFrame');
    const writeBuffer = vi.spyOn(backend, 'writeBuffer');
    const frameDriver = new ManualFrameDriver();
    const scene = new Scene();
    const camera = new PerspectiveCamera();
    const meshRenderers = new MeshRendererStore(scene);
    const materials = new PbrMaterialLibrary();
    const mesh = createCubeGeometry();
    const gold = new PbrMaterial({
      baseColorFactor: [1, 0.766, 0.336, 1],
      metallicFactor: 1,
      name: 'Gold',
      roughnessFactor: 0.24,
    });
    const leaf = new PbrMaterial({
      alphaMode: 'mask',
      baseColorFactor: [0.2, 0.7, 0.25, 0.6],
      doubleSided: true,
      name: 'Leaf',
    });
    const glass = new PbrMaterial({
      alphaMode: 'blend',
      baseColorFactor: [0.2, 0.5, 0.9, 0.4],
      name: 'Glass',
    });
    materials.set('gold', gold);
    materials.set('leaf', leaf);
    materials.set('glass', glass);

    const goldEntity = scene.createEntity({ transform: { translation: [-1, 0, 0] } });
    const leafEntity = scene.createEntity();
    const glassEntity = scene.createEntity({ transform: { translation: [1, 0, 0] } });
    const fallbackEntity = scene.createEntity({ transform: { translation: [0, 1, 0] } });
    meshRenderers.attach(goldEntity, { materialKey: 'gold', mesh });
    meshRenderers.attach(leafEntity, { materialKey: 'leaf', mesh });
    meshRenderers.attach(glassEntity, {
      alphaMode: 'blend',
      materialKey: 'glass',
      mesh,
    });
    meshRenderers.attach(fallbackEntity, { materialKey: 'missing', mesh });

    const feature = new PbrRenderFeature({
      camera,
      materials,
      meshRenderers,
      scene,
      surface: {
        cssHeight: 180,
        cssWidth: 320,
        devicePixelRatio: 1,
        target,
      },
    });
    const renderer = new KyxosRenderer({ backend, frameDriver });
    renderer.registerRenderFeature(feature);
    await renderer.initialize();

    expect(createPipeline).toHaveBeenCalledTimes(6);
    const descriptors = createPipeline.mock.calls.map(([descriptor]) => descriptor);
    expect(descriptors.map(({ fragment }) => fragment?.entryPoint).sort()).toEqual([
      'fragmentBlend',
      'fragmentBlend',
      'fragmentMask',
      'fragmentMask',
      'fragmentOpaque',
      'fragmentOpaque',
    ]);
    expect(descriptors.filter(({ primitive }) => primitive?.cullMode === 'none')).toHaveLength(3);
    expect(
      descriptors.filter(({ depthStencil }) => depthStencil?.depthWriteEnabled === false),
    ).toHaveLength(2);

    renderer.invalidate('geometry');
    frameDriver.flush(16);
    expect(renderer.getDiagnostics().lastFrameStatistics).toEqual({
      drawCalls: 4,
      instances: 4,
      triangles: 48,
      vertices: 144,
    });
    expect(feature.getDiagnostics()).toMatchObject({
      fallbackDrawCount: 1,
      gpuMeshCount: 1,
      materialCount: 3,
      objectBindingCount: 4,
      pipelineCount: 6,
      visibility: { opaqueCount: 3, transparentCount: 1, visibleCount: 4 },
    });
    expect(backend.getResourceStatistics()).toMatchObject({
      activeCount: 22,
      byKind: {
        'bind-group': { activeCount: 4 },
        buffer: { activeCount: 6 },
        pipeline: { activeCount: 6 },
        'shader-module': { activeCount: 1 },
        surface: { activeCount: 1 },
        sampler: { activeCount: 1 },
        texture: { activeCount: 3 },
      },
    });
    expect(
      new Set(
        executeFrame.mock.calls[0]?.[0].renderPasses[0]?.draws?.map(({ pipeline }) => pipeline),
      ),
    ).toHaveProperty('size', 3);
    const objectUniforms = writeBuffer.mock.calls
      .map(([, data]) => data)
      .filter((data): data is Float32Array => data instanceof Float32Array && data.length === 88);
    expect(objectUniforms).toHaveLength(4);
    expect(
      objectUniforms
        .map((uniforms) => [...uniforms.slice(48, 52)].map((value) => Number(value.toFixed(3))))
        .sort(),
    ).toEqual(
      [
        [0.2, 0.5, 0.9, 0.4],
        [0.2, 0.7, 0.25, 0.6],
        [1, 0.766, 0.336, 1],
        [1, 1, 1, 1],
      ].sort(),
    );

    const beforeNumericUpdate = backend.getResourceStatistics();
    gold.update({ roughnessFactor: 0.55 });
    renderer.invalidate('material');
    frameDriver.flush(32);
    const afterNumericUpdate = backend.getResourceStatistics();
    expect(afterNumericUpdate.activeCount).toBe(beforeNumericUpdate.activeCount);
    expect(afterNumericUpdate.byKind).toEqual(beforeNumericUpdate.byKind);
    expect(afterNumericUpdate.createdTotal).toBe(beforeNumericUpdate.createdTotal + 1);
    expect(afterNumericUpdate.destroyedTotal).toBe(beforeNumericUpdate.destroyedTotal + 1);
    expect(createBindGroup).toHaveBeenCalledTimes(4);

    const beforeVariantUpdate = backend.getResourceStatistics();
    gold.update({ doubleSided: true });
    renderer.invalidate('material');
    frameDriver.flush(48);
    const afterVariantUpdate = backend.getResourceStatistics();
    expect(afterVariantUpdate.activeCount).toBe(beforeVariantUpdate.activeCount);
    expect(afterVariantUpdate.createdTotal).toBe(beforeVariantUpdate.createdTotal + 2);
    expect(afterVariantUpdate.destroyedTotal).toBe(beforeVariantUpdate.destroyedTotal + 2);
    expect(createBindGroup).toHaveBeenCalledTimes(5);

    meshRenderers.detach(fallbackEntity);
    renderer.invalidate('geometry');
    frameDriver.flush(64);
    expect(feature.getDiagnostics()).toMatchObject({
      fallbackDrawCount: 0,
      objectBindingCount: 3,
    });
    expect(backend.getResourceStatistics().activeCount).toBe(20);

    renderer.dispose();
    expect(backend.getResourceStatistics().activeCount).toBe(0);
    expect(materials.disposed).toBe(false);
    expect(gold.disposed).toBe(false);
    materials.dispose();
  });

  it('recreates its complete GPU cache after Device Lost', async () => {
    const backend = new MockBackend();
    const frameDriver = new ManualFrameDriver();
    const scene = new Scene();
    const camera = new PerspectiveCamera();
    const meshRenderers = new MeshRendererStore(scene);
    const entity = scene.createEntity();
    meshRenderers.attach(entity, { mesh: createCubeGeometry() });
    const feature = new PbrRenderFeature({
      camera,
      meshRenderers,
      scene,
      surface: { cssHeight: 100, cssWidth: 100, devicePixelRatio: 1, target },
    });
    const fallback = feature.materials.fallbackMaterial;
    const renderer = new KyxosRenderer({ backend, frameDriver });
    renderer.registerRenderFeature(feature);
    await renderer.initialize();
    renderer.invalidate('geometry');
    frameDriver.flush(16);
    expect(backend.getResourceStatistics().activeCount).toBe(16);

    backend.simulateLoss({ message: 'PBR feature loss' });
    expect(renderer.state).toBe('lost');
    expect(backend.getResourceStatistics().activeCount).toBe(0);

    await renderer.initialize();
    renderer.invalidate('geometry');
    frameDriver.flush(32);
    expect(renderer.getDiagnostics()).toMatchObject({
      lastFrameStatistics: { drawCalls: 1, triangles: 12, vertices: 36 },
      state: 'ready',
    });
    expect(backend.getResourceStatistics().activeCount).toBe(16);

    renderer.dispose();
    expect(backend.getResourceStatistics().activeCount).toBe(0);
    expect(fallback.disposed).toBe(true);
  });

  it('uploads, samples, replaces, and releases base-color plus metallic-roughness maps', async () => {
    const backend = new MockBackend();
    const createBindGroup = vi.spyOn(backend, 'createBindGroup');
    const writeTexture = vi.spyOn(backend, 'writeTexture');
    await backend.initialize();
    const scene = new Scene();
    const camera = new PerspectiveCamera();
    const meshRenderers = new MeshRendererStore(scene);
    const materials = new PbrMaterialLibrary();
    const textures = new PbrTextureLibrary();
    const baseColor = new PbrTextureSource({
      height: 1,
      id: 'base-color',
      pixels: new Uint8Array([128, 64, 32, 255]),
      sampler: { magFilter: 'nearest', minFilter: 'nearest' },
      transferFunction: 'srgb',
      width: 1,
    });
    const metallicRoughness = new PbrTextureSource({
      height: 1,
      id: 'metallic-roughness',
      pixels: new Uint8Array([0, 128, 64, 255]),
      transferFunction: 'linear',
      width: 1,
    });
    textures.set(baseColor);
    textures.set(metallicRoughness);
    const textured = new PbrMaterial({
      textures: {
        'base-color': createMaterialTextureBinding({
          offset: [0.25, 0.5],
          rotation: Math.PI / 4,
          texture: createMaterialTextureReference({
            id: 'base-color',
            transferFunction: 'srgb',
          }),
        }),
        'metallic-roughness': createMaterialTextureBinding({
          scale: [2, 2],
          texture: createMaterialTextureReference({
            id: 'metallic-roughness',
            transferFunction: 'linear',
          }),
        }),
      },
    });
    materials.set('textured', textured);
    const entity = scene.createEntity();
    meshRenderers.attach(entity, { materialKey: 'textured', mesh: createCubeGeometry() });
    const feature = new PbrRenderFeature({
      camera,
      materials,
      meshRenderers,
      scene,
      surface: { cssHeight: 100, cssWidth: 100, devicePixelRatio: 1, target },
      textures,
    });
    await feature.initialize({ backend });

    expect(
      feature.render({
        backend,
        dirtyFlags: ['material'],
        frameIndex: 1,
        timestamp: 0,
      }),
    ).toEqual({ drawCalls: 1, instances: 1, triangles: 12, vertices: 36 });
    expect(feature.getDiagnostics()).toMatchObject({
      gpuTextureSourceCount: 2,
      objectBindingCount: 1,
      textureSourceCount: 2,
    });
    expect(writeTexture).toHaveBeenCalledTimes(4);
    expect(createBindGroup).toHaveBeenLastCalledWith(
      expect.objectContaining({
        entries: [
          expect.objectContaining({
            binding: 0,
            resource: expect.objectContaining({ buffer: expect.any(Object) }),
          }),
          expect.objectContaining({
            binding: 1,
            resource: expect.objectContaining({ texture: expect.any(Object) }),
          }),
          expect.objectContaining({
            binding: 2,
            resource: expect.objectContaining({ sampler: expect.any(Object) }),
          }),
          expect.objectContaining({
            binding: 3,
            resource: expect.objectContaining({ texture: expect.any(Object) }),
          }),
          expect.objectContaining({
            binding: 4,
            resource: expect.objectContaining({ sampler: expect.any(Object) }),
          }),
        ],
      }),
    );
    const beforeReplacement = backend.getResourceStatistics();
    textures.set(
      new PbrTextureSource({
        height: 1,
        id: 'base-color',
        pixels: new Uint8Array([32, 64, 128, 255]),
        transferFunction: 'srgb',
        width: 1,
      }),
    );
    feature.render({
      backend,
      dirtyFlags: ['material'],
      frameIndex: 2,
      timestamp: 16,
    });
    const afterReplacement = backend.getResourceStatistics();
    expect(afterReplacement.activeCount).toBe(beforeReplacement.activeCount);
    expect(afterReplacement.byKind).toEqual(beforeReplacement.byKind);
    expect(afterReplacement.createdTotal).toBe(beforeReplacement.createdTotal + 4);
    expect(afterReplacement.destroyedTotal).toBe(beforeReplacement.destroyedTotal + 4);
    expect(writeTexture).toHaveBeenCalledTimes(5);

    feature.dispose();
    expect(backend.getResourceStatistics().activeCount).toBe(0);
    expect(textures.disposed).toBe(false);
    backend.dispose();
    materials.dispose();
    textures.dispose();
  });
});
