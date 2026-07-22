import { describe, expect, it } from 'vitest';

import { ManualFrameDriver, MockBackend } from '@kyxos/render-testing';

import { PbrMaterial, createCubeGeometry, createKyxosPbrRenderer } from '../src/index.js';

const target = {
  getContext: () => ({}),
  height: 180,
  width: 320,
};

describe('public PBR Renderer SDK', () => {
  it('composes PBR ownership, controls, automatic Dirty Events, and diagnostics', async () => {
    const backend = new MockBackend();
    const frameDriver = new ManualFrameDriver();
    const renderer = await createKyxosPbrRenderer({
      backend,
      canvas: target,
      cssHeight: 180,
      cssWidth: 320,
      devicePixelRatio: 1,
      frameDriver,
    });
    const material = new PbrMaterial({
      baseColorFactor: [1, 0.766, 0.336, 1],
      metallicFactor: 1,
      name: 'Gold',
      roughnessFactor: 0.24,
    });
    renderer.materials.set('gold', material);
    const entity = renderer.scene.createEntity();
    renderer.meshRenderers.attach(entity, {
      materialKey: 'gold',
      mesh: createCubeGeometry(),
    });

    expect(frameDriver.pendingCount).toBe(1);
    frameDriver.flush(16);
    expect(renderer.getPbrDiagnostics()).toMatchObject({
      feature: {
        fallbackDrawCount: 0,
        materialCount: 1,
        objectBindingCount: 1,
        pipelineCount: 12,
        visibility: { visibleCount: 1 },
      },
      materials: { materialCount: 1 },
      meshRenderers: { size: 1 },
      renderer: {
        frameIndex: 1,
        lastFrameStatistics: { drawCalls: 1, triangles: 12, vertices: 36 },
        state: 'ready',
      },
    });

    const stableResources = backend.getResourceStatistics();
    material.update({ roughnessFactor: 0.6 });
    expect(frameDriver.pendingCount).toBe(1);
    frameDriver.flush(32);
    expect(backend.getResourceStatistics()).toMatchObject({
      activeCount: stableResources.activeCount,
      activeEstimatedBytes: stableResources.activeEstimatedBytes,
    });

    renderer.setEnvironment({ intensity: 1.5, rotation: Math.PI / 4 });
    renderer.setLight({ intensity: 4 });
    renderer.setOutputTransform({ exposure: 1, toneMapping: 'none' });
    expect(renderer.environment).toMatchObject({ intensity: 1.5, rotation: Math.PI / 4 });
    expect(renderer.output).toEqual({ exposure: 1, exposureMultiplier: 2, toneMapping: 'none' });
    expect(frameDriver.pendingCount).toBe(1);
    frameDriver.flush(48);
    expect(backend.getResourceStatistics().activeCount).toBe(stableResources.activeCount);

    renderer.dispose();
    renderer.dispose();
    expect(renderer.disposed).toBe(true);
    expect(renderer.scene.disposed).toBe(true);
    expect(renderer.camera.disposed).toBe(true);
    expect(renderer.meshRenderers.disposed).toBe(true);
    expect(renderer.materials.disposed).toBe(true);
    expect(renderer.textures.disposed).toBe(true);
    expect(material.disposed).toBe(false);
    expect(backend.getResourceStatistics()).toMatchObject({
      activeCount: 0,
      activeEstimatedBytes: 0,
    });
    material.dispose();
  });

  it('recreates the complete public PBR renderer after Device Lost', async () => {
    const backend = new MockBackend();
    const frameDriver = new ManualFrameDriver();
    const renderer = await createKyxosPbrRenderer({
      backend,
      canvas: target,
      cssHeight: 100,
      cssWidth: 100,
      frameDriver,
    });
    const entity = renderer.scene.createEntity();
    renderer.meshRenderers.attach(entity, { mesh: createCubeGeometry() });
    frameDriver.flush(16);
    const readyResources = backend.getResourceStatistics();
    expect(readyResources.activeCount).toBeGreaterThan(0);

    renderer.debugSimulateDeviceLoss();
    expect(renderer.state).toBe('lost');
    expect(backend.getResourceStatistics().activeCount).toBe(0);

    await renderer.recover();
    expect(frameDriver.pendingCount).toBe(1);
    frameDriver.flush(32);
    expect(renderer.getPbrDiagnostics()).toMatchObject({
      feature: { objectBindingCount: 1 },
      renderer: {
        lastFrameStatistics: { drawCalls: 1, triangles: 12, vertices: 36 },
        state: 'ready',
      },
    });
    expect(backend.getResourceStatistics().activeCount).toBe(readyResources.activeCount);

    renderer.dispose();
    expect(backend.getResourceStatistics().activeCount).toBe(0);
  });
});
