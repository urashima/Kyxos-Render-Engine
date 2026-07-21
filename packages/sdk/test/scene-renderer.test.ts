import { describe, expect, it } from 'vitest';

import { ManualFrameDriver, MockBackend } from '@kyxos/render-testing';

import {
  createCubeGeometry,
  createKyxosSceneRenderer,
  quaternionFromAxisAngle,
} from '../src/index.js';

const target = {
  getContext: () => ({}),
  height: 180,
  width: 320,
};

describe('public Scene Renderer SDK', () => {
  it('composes Scene, Camera, Orbit, visibility, and automatic Dirty Events', async () => {
    const backend = new MockBackend();
    const frameDriver = new ManualFrameDriver();
    const renderer = await createKyxosSceneRenderer({
      backend,
      canvas: target,
      cssHeight: 180,
      cssWidth: 320,
      devicePixelRatio: 1,
      frameDriver,
    });
    const mesh = createCubeGeometry();
    const parent = renderer.scene.createEntity({
      name: 'parent',
      transform: { translation: [-0.75, 0, 0] },
    });
    const child = renderer.scene.createEntity({
      name: 'child',
      parent,
      transform: { translation: [1.5, 0, 0] },
    });
    renderer.meshRenderers.attach(parent, { baseColor: [0.9, 0.25, 0.1, 1], mesh });
    renderer.meshRenderers.attach(child, {
      alphaMode: 'blend',
      baseColor: [0.1, 0.5, 0.95, 0.5],
      mesh,
    });

    expect(frameDriver.pendingCount).toBe(1);
    frameDriver.flush(16);
    expect(renderer.getDiagnostics()).toMatchObject({
      frameIndex: 1,
      lastFrameStatistics: { drawCalls: 2, triangles: 24, vertices: 72 },
      renderMode: 'sleeping',
      state: 'ready',
    });
    expect(renderer.getSceneDiagnostics()).toMatchObject({
      feature: {
        gpuMeshCount: 1,
        objectBindingCount: 2,
        visibility: { visibleCount: 2 },
      },
      meshRenderers: { size: 2 },
      scene: { entityCount: 2 },
    });

    renderer.scene.setLocalTransform(parent, {
      rotation: quaternionFromAxisAngle([0, 1, 0], Math.PI / 4),
    });
    expect(frameDriver.pendingCount).toBe(1);
    frameDriver.flush(32);
    expect(renderer.getDiagnostics().frameIndex).toBe(2);

    const framed = renderer.frameScene();
    expect(framed).not.toBeNull();
    expect(renderer.orbitController.state().target).toEqual(renderer.camera.target);
    renderer.orbit(0.1, 0.05);
    renderer.pan(0.1, -0.05);
    renderer.dolly(0.9);
    expect(frameDriver.pendingCount).toBe(1);
    frameDriver.flush(48);
    expect(renderer.getDiagnostics().frameIndex).toBe(3);

    const resized = renderer.resize({ cssHeight: 200, cssWidth: 400, devicePixelRatio: 1 });
    expect(resized.size).toMatchObject({ physicalHeight: 200, physicalWidth: 400 });
    expect(renderer.camera.aspect).toBe(2);
    expect(frameDriver.pendingCount).toBe(1);
    frameDriver.flush(64);

    renderer.dispose();
    renderer.dispose();
    expect(renderer.disposed).toBe(true);
    expect(renderer.scene.disposed).toBe(true);
    expect(renderer.camera.disposed).toBe(true);
    expect(renderer.meshRenderers.disposed).toBe(true);
    expect(backend.getResourceStatistics()).toMatchObject({
      activeCount: 0,
      activeEstimatedBytes: 0,
    });
  });

  it('recovers the composed SDK renderer after Device Lost', async () => {
    const backend = new MockBackend();
    const frameDriver = new ManualFrameDriver();
    const renderer = await createKyxosSceneRenderer({
      backend,
      canvas: target,
      cssHeight: 100,
      cssWidth: 100,
      frameDriver,
    });
    const entity = renderer.scene.createEntity();
    renderer.meshRenderers.attach(entity, { mesh: createCubeGeometry() });
    frameDriver.flush(16);
    expect(backend.getResourceStatistics().activeCount).toBe(9);

    backend.simulateLoss({ message: 'SDK Scene renderer loss' });
    expect(renderer.state).toBe('lost');
    expect(backend.getResourceStatistics().activeCount).toBe(0);

    await renderer.recover();
    expect(frameDriver.pendingCount).toBe(1);
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
