import { PerspectiveCamera } from '@kyxos/render-camera';
import { createCubeGeometry } from '@kyxos/render-geometry';
import { Scene } from '@kyxos/render-scene';
import { MockBackend } from '@kyxos/render-testing';
import { MeshRendererStore } from '@kyxos/render-visibility';
import { describe, expect, it, vi } from 'vitest';

import { PBR_OBJECT_UNIFORM_LAYOUT, TemporalPbrRenderFeature } from '../src/index.js';

const signature = {
  camera: 1,
  device: 1,
  environment: 1,
  geometry: 1,
  lighting: 1,
  materials: 1,
  postProcess: 1,
  scene: 1,
  viewport: 1,
} as const;

function createTarget() {
  return { getContext: () => ({}), height: 0, width: 0 };
}

function temporal(
  mode: 'accumulating' | 'interactive' | 'stabilizing',
  sampleIndex: number,
  historyGeneration = 1,
  historyReset = false,
) {
  return Object.freeze({
    historyGeneration,
    historyReset,
    mode,
    sampleIndex,
    targetSamples: 2,
  });
}

function createFixture() {
  const scene = new Scene();
  const camera = new PerspectiveCamera({ aspect: 2 });
  const meshRenderers = new MeshRendererStore(scene);
  meshRenderers.attach(scene.createEntity(), { mesh: createCubeGeometry() });
  return { camera, meshRenderers, scene };
}

describe('TemporalPbrRenderFeature', () => {
  it('uses one borrowed Surface and orders jittered PBR MRT through Dynamic and Static output', async () => {
    const backend = new MockBackend();
    await backend.initialize();
    const { camera, meshRenderers, scene } = createFixture();
    const reportConvergence = vi.fn();
    const feature = new TemporalPbrRenderFeature({
      camera,
      frustumCulling: false,
      height: 32,
      meshRenderers,
      output: { exposure: 0, toneMapping: 'none' },
      ownerId: 'temporal-pbr',
      reportConvergence,
      scene,
      signature: () => signature,
      surface: {
        cssHeight: 32,
        cssWidth: 64,
        devicePixelRatio: 1,
        target: createTarget(),
      },
      targetSamples: 2,
      width: 64,
    });
    const executeFrame = vi.spyOn(backend, 'executeFrame');
    const writeBuffer = backend.writeBuffer.bind(backend);
    const jitteredMatrices: number[][] = [];
    vi.spyOn(backend, 'writeBuffer').mockImplementation((handle, data, offset) => {
      if (data instanceof Float32Array && data.byteLength === PBR_OBJECT_UNIFORM_LAYOUT.byteLength) {
        jitteredMatrices.push(Array.from(data.slice(0, 16)));
      }
      writeBuffer(handle, data, offset);
    });

    await feature.initialize({ backend });
    expect(backend.getResourceStatistics().byKind.surface?.activeCount).toBe(1);
    expect(feature.getDiagnostics()).toMatchObject({
      pbr: { outputTarget: 'dynamic-taa', pipelineCount: 12 },
      pipeline: { state: 'ready' },
    });

    const interactive = feature.render({
      backend,
      dirtyFlags: ['camera'],
      frameIndex: 0,
      temporal: temporal('interactive', 0, 1, true),
      timestamp: 0,
    });
    expect(interactive).toEqual({
      drawCalls: 3,
      instances: 3,
      triangles: 14,
      vertices: 42,
    });

    const accumulating = feature.render({
      backend,
      dirtyFlags: [],
      frameIndex: 1,
      temporal: temporal('accumulating', 1),
      timestamp: 16,
    });
    expect(accumulating).toEqual({
      drawCalls: 4,
      instances: 4,
      triangles: 15,
      vertices: 45,
    });
    expect(reportConvergence).toHaveBeenLastCalledWith(
      expect.objectContaining({ converged: false, sampleCount: 1, targetSamples: 2 }),
    );

    feature.render({
      backend,
      dirtyFlags: [],
      frameIndex: 2,
      temporal: temporal('accumulating', 2),
      timestamp: 32,
    });
    expect(reportConvergence).toHaveBeenLastCalledWith(
      expect.objectContaining({ converged: true, reason: 'sample-limit', sampleCount: 2 }),
    );
    expect(jitteredMatrices).toHaveLength(3);
    expect(jitteredMatrices[0]).not.toEqual(jitteredMatrices[1]);
    expect(jitteredMatrices[1]).not.toEqual(jitteredMatrices[2]);

    const labels = executeFrame.mock.calls.map(
      ([submission]) => submission.renderPasses[0]?.label ?? 'missing',
    );
    expect(labels).toEqual([
      'phase-04-pbr-temporal-mrt-pass',
      'taa-resolve-temporal-pbr-pass',
      'taa-present-temporal-pbr-pass',
      'phase-04-pbr-temporal-mrt-pass',
      'taa-resolve-temporal-pbr-pass',
      'static-accumulation-temporal-pbr-pass',
      'taa-present-temporal-pbr-pass',
      'phase-04-pbr-temporal-mrt-pass',
      'taa-resolve-temporal-pbr-pass',
      'static-accumulation-temporal-pbr-pass',
      'taa-present-temporal-pbr-pass',
    ]);

    feature.dispose();
    expect(backend.getResourceStatistics().activeCount).toBe(0);
    backend.dispose();
    meshRenderers.dispose();
    camera.dispose();
    scene.dispose();
  });

  it('resizes the borrowed Surface and both histories without creating another Surface', async () => {
    const backend = new MockBackend();
    await backend.initialize();
    const { camera, meshRenderers, scene } = createFixture();
    const feature = new TemporalPbrRenderFeature({
      camera,
      height: 32,
      meshRenderers,
      ownerId: 'temporal-pbr-resize',
      scene,
      signature: () => signature,
      surface: {
        cssHeight: 32,
        cssWidth: 64,
        devicePixelRatio: 1,
        target: createTarget(),
      },
      targetSamples: 2,
      width: 64,
    });
    await feature.initialize({ backend });

    expect(feature.resize({ cssHeight: 40, cssWidth: 80, devicePixelRatio: 1 })).toMatchObject({
      size: { physicalHeight: 40, physicalWidth: 80, suspended: false },
    });
    expect(feature.getDiagnostics().pipeline).toMatchObject({
      dynamicHistory: {
        history: { lastInvalidation: 'viewport', sampleCount: 0 },
        size: { height: 40, width: 80 },
      },
      staticHistory: {
        history: { lastInvalidation: 'viewport', sampleCount: 0 },
        size: { height: 40, width: 80 },
      },
    });
    expect(backend.getResourceStatistics().byKind.surface?.activeCount).toBe(1);

    feature.dispose();
    expect(backend.getResourceStatistics().activeCount).toBe(0);
    backend.dispose();
    meshRenderers.dispose();
    camera.dispose();
    scene.dispose();
  });

  it('detaches after Device Lost and restores the single-Surface pipeline', async () => {
    const backend = new MockBackend();
    await backend.initialize();
    const { camera, meshRenderers, scene } = createFixture();
    const feature = new TemporalPbrRenderFeature({
      camera,
      height: 32,
      meshRenderers,
      ownerId: 'temporal-pbr-loss',
      scene,
      signature: () => signature,
      surface: {
        cssHeight: 32,
        cssWidth: 64,
        devicePixelRatio: 1,
        target: createTarget(),
      },
      targetSamples: 2,
      width: 64,
    });
    await feature.initialize({ backend });
    feature.render({
      backend,
      dirtyFlags: ['geometry'],
      frameIndex: 0,
      temporal: temporal('interactive', 0, 1, true),
      timestamp: 0,
    });

    backend.simulateLoss({ message: 'forced PBR temporal loss' });
    feature.onBackendLost();
    expect(feature.getDiagnostics().pipeline.state).toBe('detached');
    expect(backend.getResourceStatistics().activeCount).toBe(0);

    await backend.initialize();
    await feature.initialize({ backend });
    expect(feature.getDiagnostics().pipeline.state).toBe('ready');
    expect(backend.getResourceStatistics().byKind.surface?.activeCount).toBe(1);
    feature.render({
      backend,
      dirtyFlags: ['device'],
      frameIndex: 1,
      temporal: temporal('interactive', 0, 2, true),
      timestamp: 16,
    });

    feature.dispose();
    expect(backend.getResourceStatistics().activeCount).toBe(0);
    backend.dispose();
    meshRenderers.dispose();
    camera.dispose();
    scene.dispose();
  });
});
