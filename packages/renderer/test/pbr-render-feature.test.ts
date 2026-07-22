import { PerspectiveCamera } from '@kyxos/render-camera';
import {
  ENVIRONMENT_CUBE_FACES,
  type EnvironmentCubeFaceData,
  EnvironmentSource,
} from '@kyxos/render-environment';
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

function environmentFaces(size: number, value: number): EnvironmentCubeFaceData {
  return Object.fromEntries(
    ENVIRONMENT_CUBE_FACES.map((face, index) => [
      face,
      new Float32Array(size * size * 3).fill(value + index * 0.01),
    ]),
  ) as unknown as EnvironmentCubeFaceData;
}

function environmentSource(id: string, value: number, specularSize = 1): EnvironmentSource {
  const levels = Array.from({ length: Math.floor(Math.log2(specularSize)) + 1 }, (_, mipLevel) => ({
    faces: environmentFaces(Math.max(1, Math.floor(specularSize / 2 ** mipLevel)), value + 0.1),
  }));
  return new EnvironmentSource({
    brdfLut: { height: 1, pixels: new Float32Array([0.5, 0.1]), width: 1 },
    diffuseIrradiance: { faces: environmentFaces(1, value), size: 1 },
    id,
    specularPrefilter: { levels, size: specularSize },
    version: 'v1',
  });
}

function expectFloatTuple(actual: ArrayLike<number>, expected: readonly number[]): void {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((value, index) => expect(actual[index]).toBeCloseTo(value, 6));
}

describe('PBR GPU layout', () => {
  it('packs a stable 448-byte world-space material, lighting, UV, and IBL contract', () => {
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
        normal: createMaterialTextureBinding({
          offset: [0.1, 0.2],
          rotation: Math.PI / 2,
          scale: [1.5, 0.5],
          texture: createMaterialTextureReference({
            id: 'normal-layout',
            transferFunction: 'linear',
          }),
        }),
        emissive: createMaterialTextureBinding({
          offset: [-0.1, 0.4],
          rotation: -Math.PI / 2,
          scale: [0.25, 4],
          texture: createMaterialTextureReference({
            id: 'emissive-layout',
            transferFunction: 'srgb',
          }),
        }),
        occlusion: createMaterialTextureBinding({
          offset: [0.3, -0.2],
          rotation: Math.PI / 4,
          scale: [0.75, 1.25],
          texture: createMaterialTextureReference({
            id: 'occlusion-layout',
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
      environment: { intensity: 2.5, rotation: Math.PI / 2, specularMipLevelCount: 4 },
      light,
      material: material.snapshot(),
      normalYDirection: 'down',
      output: { exposure: 1, toneMapping: 'none' },
      viewProjectionMatrix: identityMat4(),
      worldMatrix: identityMat4(),
    });

    expect(packed).toHaveLength(112);
    expect(packed.byteLength).toBe(PBR_OBJECT_UNIFORM_LAYOUT.byteLength);
    expectFloatTuple(packed.slice(48, 52), [0.8, 0.3, 0.1, 0.7]);
    expectFloatTuple(packed.slice(52, 56), [0.1, 0.2, 0.3, 4]);
    expectFloatTuple(packed.slice(56, 60), [0.65, 0.42, 0.35, 0]);
    expectFloatTuple(packed.slice(60, 64), [-1, 0.45, 1, -1]);
    expectFloatTuple(packed.slice(64, 68), [1, 2, 3, 1]);
    expectFloatTuple(packed.slice(68, 72), [0, 0, 1, 2]);
    expectFloatTuple(packed.slice(72, 76), [0.9, 0.8, 0.7, 0]);
    expectFloatTuple(packed.slice(76, 80), [0.25, 0.5, 2, 3]);
    expectFloatTuple(packed.slice(80, 84), [-0.25, 0.125, 0.5, 0.75]);
    expectFloatTuple(packed.slice(84, 88), [0.1, 0.2, 1.5, 0.5]);
    expectFloatTuple(packed.slice(88, 92), [-0.1, 0.4, 0.25, 4]);
    expectFloatTuple(packed.slice(92, 96), [0, 1, -1, 0]);
    expectFloatTuple(packed.slice(96, 100), [0, 1, 0, -1]);
    expectFloatTuple(packed.slice(100, 104), [0.3, -0.2, 0.75, 1.25]);
    expectFloatTuple(packed.slice(104, 108), [Math.SQRT1_2, Math.SQRT1_2, 0, 1]);
    expectFloatTuple(packed.slice(108, 112), [2.5, 3, 2, 0]);
    expect(() =>
      packPbrObjectUniforms({
        cameraPosition: [1, 2, 3],
        light,
        material: material.snapshot(),
        normalYDirection: 'sideways' as 'up',
        viewProjectionMatrix: identityMat4(),
        worldMatrix: identityMat4(),
      }),
    ).toThrow('normalYDirection');
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

    expect(createPipeline).toHaveBeenCalledTimes(12);
    const descriptors = createPipeline.mock.calls.map(([descriptor]) => descriptor);
    expect(descriptors.map(({ fragment }) => fragment?.entryPoint).sort()).toEqual([
      'fragmentBlend',
      'fragmentBlend',
      'fragmentBlend',
      'fragmentBlend',
      'fragmentMask',
      'fragmentMask',
      'fragmentMask',
      'fragmentMask',
      'fragmentOpaque',
      'fragmentOpaque',
      'fragmentOpaque',
      'fragmentOpaque',
    ]);
    expect(descriptors.filter(({ primitive }) => primitive?.cullMode === 'none')).toHaveLength(6);
    expect(
      descriptors.filter(({ depthStencil }) => depthStencil?.depthWriteEnabled === false),
    ).toHaveLength(4);
    expect(descriptors[0]?.vertex.buffers?.[0]).toEqual({
      arrayStride: 48,
      attributes: [
        { format: 'float32x3', offset: 0, shaderLocation: 0 },
        { format: 'float32x3', offset: 12, shaderLocation: 1 },
        { format: 'float32x2', offset: 24, shaderLocation: 2 },
        { format: 'float32x4', offset: 32, shaderLocation: 3 },
      ],
    });

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
      outputExposure: 0,
      outputExposureMultiplier: 1,
      outputToneMapping: 'khronos-pbr-neutral',
      pipelineCount: 12,
      visibility: { opaqueCount: 3, transparentCount: 1, visibleCount: 4 },
    });
    expect(backend.getResourceStatistics()).toMatchObject({
      activeCount: 46,
      byKind: {
        'bind-group': { activeCount: 16 },
        buffer: { activeCount: 6 },
        pipeline: { activeCount: 12 },
        'shader-module': { activeCount: 1 },
        surface: { activeCount: 1 },
        sampler: { activeCount: 3 },
        texture: { activeCount: 7 },
      },
    });
    expect(
      new Set(
        executeFrame.mock.calls[0]?.[0].renderPasses[0]?.draws?.map(({ pipeline }) => pipeline),
      ),
    ).toHaveProperty('size', 3);
    const objectUniforms = writeBuffer.mock.calls
      .map(([, data]) => data)
      .filter((data): data is Float32Array => data instanceof Float32Array && data.length === 112);
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
    expect(createBindGroup).toHaveBeenCalledTimes(16);

    const beforeVariantUpdate = backend.getResourceStatistics();
    gold.update({ doubleSided: true });
    renderer.invalidate('material');
    frameDriver.flush(48);
    const afterVariantUpdate = backend.getResourceStatistics();
    expect(afterVariantUpdate.activeCount).toBe(beforeVariantUpdate.activeCount);
    expect(afterVariantUpdate.createdTotal).toBe(beforeVariantUpdate.createdTotal + 2);
    expect(afterVariantUpdate.destroyedTotal).toBe(beforeVariantUpdate.destroyedTotal + 2);
    expect(createBindGroup).toHaveBeenCalledTimes(17);

    meshRenderers.detach(fallbackEntity);
    renderer.invalidate('geometry');
    frameDriver.flush(64);
    expect(feature.getDiagnostics()).toMatchObject({
      fallbackDrawCount: 0,
      objectBindingCount: 3,
    });
    expect(backend.getResourceStatistics().activeCount).toBe(44);

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
    expect(backend.getResourceStatistics().activeCount).toBe(40);

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
    expect(backend.getResourceStatistics().activeCount).toBe(40);

    renderer.dispose();
    expect(backend.getResourceStatistics().activeCount).toBe(0);
    expect(fallback.disposed).toBe(true);
  });

  it('atomically switches Pipeline-specific environment groups while controls stay uniform-only', async () => {
    const backend = new MockBackend();
    const createBindGroup = vi.spyOn(backend, 'createBindGroup');
    const writeBuffer = vi.spyOn(backend, 'writeBuffer');
    await backend.initialize();
    const scene = new Scene();
    const camera = new PerspectiveCamera();
    const meshRenderers = new MeshRendererStore(scene);
    const entity = scene.createEntity();
    meshRenderers.attach(entity, { mesh: createCubeGeometry() });
    const firstEnvironment = environmentSource('studio-a', 0.1);
    const secondEnvironment = environmentSource('studio-b', 0.2, 2);
    const feature = new PbrRenderFeature({
      camera,
      environment: { intensity: 1.5, rotation: 0.25, source: firstEnvironment },
      meshRenderers,
      scene,
      surface: { cssHeight: 100, cssWidth: 100, devicePixelRatio: 1, target },
    });
    await feature.initialize({ backend });
    feature.render({ backend, dirtyFlags: ['environment'], frameIndex: 1, timestamp: 0 });

    expect(feature.getDiagnostics()).toMatchObject({
      environmentCache: {
        activeLeaseCount: 1,
        cachedEnvironmentCount: 1,
        gpuReadyEnvironmentCount: 1,
        state: 'ready',
      },
      environmentIdentity: firstEnvironment.identityKey,
      environmentIntensity: 1.5,
      environmentRotation: 0.25,
    });
    expect(
      createBindGroup.mock.calls.filter(([descriptor]) => descriptor.group === 1),
    ).toHaveLength(12);
    expect(
      createBindGroup.mock.calls.find(([descriptor]) => descriptor.group === 1)?.[0].entries,
    ).toHaveLength(5);
    const initialUniform = writeBuffer.mock.calls
      .map(([, data]) => data)
      .find((data): data is Float32Array => data instanceof Float32Array && data.length === 112);
    expectFloatTuple(initialUniform?.slice(108, 112) ?? [], [1.5, 0, 1, 1]);

    const beforeControls = backend.getResourceStatistics();
    feature.setEnvironment({ intensity: 2, rotation: Math.PI / 2 });
    feature.setOutputTransform({ exposure: 1, toneMapping: 'none' });
    expect(backend.getResourceStatistics()).toEqual(beforeControls);

    const beforeReplacement = backend.getResourceStatistics();
    feature.setEnvironment({ source: secondEnvironment });
    const afterReplacement = backend.getResourceStatistics();
    expect(afterReplacement.activeCount).toBe(beforeReplacement.activeCount);
    expect(afterReplacement.createdTotal).toBe(beforeReplacement.createdTotal + 17);
    expect(afterReplacement.destroyedTotal).toBe(beforeReplacement.destroyedTotal + 17);
    expect(feature.getDiagnostics()).toMatchObject({
      environmentIdentity: secondEnvironment.identityKey,
      environmentIntensity: 2,
      environmentRotation: Math.PI / 2,
      outputExposure: 1,
      outputExposureMultiplier: 2,
      outputToneMapping: 'none',
    });

    feature.render({ backend, dirtyFlags: ['environment'], frameIndex: 2, timestamp: 16 });
    const latestUniform = writeBuffer.mock.calls
      .map(([, data]) => data)
      .filter((data): data is Float32Array => data instanceof Float32Array && data.length === 112)
      .at(-1);
    expectFloatTuple(latestUniform?.slice(104, 108) ?? [], [1, 0, 0, 1]);
    expectFloatTuple(latestUniform?.slice(108, 112) ?? [], [2, 1, 2, 0]);

    feature.dispose();
    expect(backend.getResourceStatistics().activeCount).toBe(0);
    backend.dispose();
  });

  it('uploads, samples, replaces, and releases all direct-light PBR maps', async () => {
    const backend = new MockBackend();
    const createBindGroup = vi.spyOn(backend, 'createBindGroup');
    const writeBuffer = vi.spyOn(backend, 'writeBuffer');
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
    const normal = new PbrTextureSource({
      height: 1,
      id: 'normal',
      normalYDirection: 'down',
      pixels: new Uint8Array([128, 255, 128, 255]),
      transferFunction: 'linear',
      width: 1,
    });
    const emissive = new PbrTextureSource({
      height: 1,
      id: 'emissive',
      pixels: new Uint8Array([64, 128, 255, 255]),
      transferFunction: 'srgb',
      width: 1,
    });
    const occlusion = new PbrTextureSource({
      height: 1,
      id: 'occlusion',
      pixels: new Uint8Array([64, 255, 255, 255]),
      transferFunction: 'linear',
      width: 1,
    });
    textures.set(baseColor);
    textures.set(metallicRoughness);
    textures.set(normal);
    textures.set(emissive);
    textures.set(occlusion);
    const textured = new PbrMaterial({
      emissiveFactor: [0.25, 0.5, 0.75],
      emissiveStrength: 3,
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
        normal: createMaterialTextureBinding({
          texture: createMaterialTextureReference({
            id: 'normal',
            transferFunction: 'linear',
          }),
        }),
        emissive: createMaterialTextureBinding({
          texture: createMaterialTextureReference({
            id: 'emissive',
            transferFunction: 'srgb',
          }),
        }),
        occlusion: createMaterialTextureBinding({
          offset: [0.125, 0.25],
          texture: createMaterialTextureReference({
            id: 'occlusion',
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
      gpuTextureSourceCount: 5,
      objectBindingCount: 1,
      pipelineCount: 12,
      textureSourceCount: 5,
    });
    expect(writeTexture).toHaveBeenCalledTimes(11);
    const objectUniform = writeBuffer.mock.calls
      .map(([, data]) => data)
      .find((data): data is Float32Array => data instanceof Float32Array && data.length === 112);
    expect(objectUniform).toBeDefined();
    expectFloatTuple(objectUniform?.slice(52, 56) ?? [], [0.25, 0.5, 0.75, 3]);
    expectFloatTuple(objectUniform?.slice(60, 64) ?? [], [1, 1, 1, -1]);
    expectFloatTuple(objectUniform?.slice(100, 104) ?? [], [0.125, 0.25, 1, 1]);
    expectFloatTuple(objectUniform?.slice(108, 112) ?? [], [1, 0, 1, 1]);
    const vertexUpload = writeBuffer.mock.calls
      .map(([, data]) => data)
      .find(
        (data): data is Float32Array =>
          data instanceof Float32Array && data.length === createCubeGeometry().vertexCount * 12,
      );
    expect(vertexUpload?.length).toBe(createCubeGeometry().vertexCount * 12);
    for (let index = 11; index < (vertexUpload?.length ?? 0); index += 12) {
      expect(Math.abs(vertexUpload?.[index] ?? 0)).toBe(1);
    }
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
          expect.objectContaining({
            binding: 5,
            resource: expect.objectContaining({ texture: expect.any(Object) }),
          }),
          expect.objectContaining({
            binding: 6,
            resource: expect.objectContaining({ sampler: expect.any(Object) }),
          }),
          expect.objectContaining({
            binding: 7,
            resource: expect.objectContaining({ texture: expect.any(Object) }),
          }),
          expect.objectContaining({
            binding: 8,
            resource: expect.objectContaining({ sampler: expect.any(Object) }),
          }),
          expect.objectContaining({
            binding: 9,
            resource: expect.objectContaining({ texture: expect.any(Object) }),
          }),
          expect.objectContaining({
            binding: 10,
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
    expect(writeTexture).toHaveBeenCalledTimes(12);

    feature.dispose();
    expect(backend.getResourceStatistics().activeCount).toBe(0);
    expect(textures.disposed).toBe(false);
    backend.dispose();
    materials.dispose();
    textures.dispose();
  });
});
