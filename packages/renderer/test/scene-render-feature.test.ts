import { PerspectiveCamera } from '@kyxos/render-camera';
import { createCubeGeometry } from '@kyxos/render-geometry';
import { Scene } from '@kyxos/render-scene';
import { ManualFrameDriver, MockBackend } from '@kyxos/render-testing';
import { MeshRendererStore } from '@kyxos/render-visibility';
import { describe, expect, it, vi } from 'vitest';

import { KyxosRenderer, SceneRenderFeature } from '../src/index.js';

const target = {
  getContext: () => ({}),
  height: 0,
  width: 0,
};

describe('SceneRenderFeature', () => {
  it('shares immutable Mesh uploads and submits ordered opaque and transparent Draws', async () => {
    const backend = new MockBackend();
    const executeFrame = vi.spyOn(backend, 'executeFrame');
    const writeBuffer = vi.spyOn(backend, 'writeBuffer');
    const frameDriver = new ManualFrameDriver();
    const scene = new Scene();
    const camera = new PerspectiveCamera();
    const meshRenderers = new MeshRendererStore(scene);
    const mesh = createCubeGeometry();
    const opaque = scene.createEntity({ transform: { translation: [-1, 0, 0] } });
    const transparent = scene.createEntity({ transform: { translation: [1, 0, 0] } });
    meshRenderers.attach(opaque, { baseColor: [0.8, 0.2, 0.1, 1], mesh });
    meshRenderers.attach(transparent, {
      alphaMode: 'blend',
      baseColor: [0.1, 0.4, 0.9, 0.45],
      mesh,
    });
    const feature = new SceneRenderFeature({
      camera,
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

    renderer.invalidate('geometry');
    frameDriver.flush(16);

    expect(renderer.getDiagnostics().lastFrameStatistics).toEqual({
      drawCalls: 2,
      instances: 2,
      triangles: 24,
      vertices: 72,
    });
    expect(backend.getResourceStatistics()).toMatchObject({
      activeCount: 11,
      byKind: {
        'bind-group': { activeCount: 2 },
        buffer: { activeCount: 4 },
        pipeline: { activeCount: 2 },
        'shader-module': { activeCount: 1 },
        surface: { activeCount: 1 },
        texture: { activeCount: 1 },
      },
    });
    expect(feature.getDiagnostics()).toMatchObject({
      gpuMeshCount: 1,
      objectBindingCount: 2,
      visibility: { opaqueCount: 1, transparentCount: 1, visibleCount: 2 },
    });
    const submission = executeFrame.mock.calls[0]?.[0];
    const draws = submission?.renderPasses[0]?.draws;
    expect(draws).toHaveLength(2);
    expect(draws?.[0]?.pipeline).not.toBe(draws?.[1]?.pipeline);
    expect(draws?.map((draw) => draw.indexCount)).toEqual([36, 36]);
    const objectUniforms = writeBuffer.mock.calls
      .map(([, data]) => data)
      .filter((data): data is Float32Array => data instanceof Float32Array && data.length === 36);
    expect(objectUniforms).toHaveLength(2);
    const opaqueUniforms = objectUniforms[0];
    const transparentUniforms = objectUniforms[1];
    if (opaqueUniforms === undefined || transparentUniforms === undefined) {
      throw new Error('Expected one Uniform upload for each visible Scene object.');
    }
    for (const [actual, expected] of [
      [opaqueUniforms.slice(32), [0.8, 0.2, 0.1, 1]],
      [transparentUniforms.slice(32), [0.1, 0.4, 0.9, 0.45]],
    ] as const) {
      expected.forEach((channel, index) => expect(actual[index]).toBeCloseTo(channel, 6));
    }

    const beforeResize = backend.getResourceStatistics();
    const resized = feature.resize({ cssHeight: 200, cssWidth: 400, devicePixelRatio: 1 });
    expect(resized.size).toMatchObject({ physicalHeight: 200, physicalWidth: 400 });
    expect(camera.aspect).toBe(2);
    const afterResize = backend.getResourceStatistics();
    expect(afterResize.activeCount).toBe(beforeResize.activeCount);
    expect(afterResize.createdTotal).toBe(beforeResize.createdTotal + 1);
    expect(afterResize.destroyedTotal).toBe(beforeResize.destroyedTotal + 1);

    meshRenderers.detach(transparent);
    renderer.invalidate('geometry');
    frameDriver.flush(32);
    expect(renderer.getDiagnostics().lastFrameStatistics.drawCalls).toBe(1);
    expect(backend.getResourceStatistics().activeCount).toBe(9);

    meshRenderers.detach(opaque);
    renderer.invalidate('geometry');
    frameDriver.flush(48);
    expect(renderer.getDiagnostics().lastFrameStatistics.drawCalls).toBe(0);
    expect(backend.getResourceStatistics().activeCount).toBe(5);
    expect(feature.getDiagnostics()).toMatchObject({ gpuMeshCount: 0, objectBindingCount: 0 });

    renderer.dispose();
    expect(backend.getResourceStatistics()).toMatchObject({
      activeCount: 0,
      activeEstimatedBytes: 0,
    });
  });

  it('recreates every GPU-owned Scene resource after Device Lost', async () => {
    const backend = new MockBackend();
    const frameDriver = new ManualFrameDriver();
    const scene = new Scene();
    const camera = new PerspectiveCamera();
    const meshRenderers = new MeshRendererStore(scene);
    const entity = scene.createEntity();
    meshRenderers.attach(entity, { mesh: createCubeGeometry() });
    const feature = new SceneRenderFeature({
      camera,
      meshRenderers,
      scene,
      surface: { cssHeight: 100, cssWidth: 100, devicePixelRatio: 1, target },
    });
    const renderer = new KyxosRenderer({ backend, frameDriver });
    renderer.registerRenderFeature(feature);
    await renderer.initialize();
    renderer.invalidate('geometry');
    frameDriver.flush(16);
    expect(backend.getResourceStatistics().activeCount).toBe(9);

    backend.simulateLoss({ message: 'scene feature loss' });
    expect(renderer.state).toBe('lost');
    expect(backend.getResourceStatistics().activeCount).toBe(0);

    await renderer.initialize();
    renderer.invalidate('geometry');
    frameDriver.flush(32);
    expect(renderer.getDiagnostics()).toMatchObject({
      lastFrameStatistics: { drawCalls: 1, triangles: 12, vertices: 36 },
      state: 'ready',
    });
    expect(backend.getResourceStatistics().activeCount).toBe(9);

    renderer.dispose();
    expect(backend.getResourceStatistics().activeCount).toBe(0);
  });
});
