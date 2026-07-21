import { PerspectiveCamera } from '@kyxos/render-camera';
import { createCubeGeometry } from '@kyxos/render-geometry';
import { Scene } from '@kyxos/render-scene';
import { describe, expect, it } from 'vitest';

import { MeshRendererStore, VisibilitySystem } from '../src/index.js';

describe('VisibilitySystem culling', () => {
  it('excludes disabled, hidden, layer-mismatched, and off-frustum objects', () => {
    const scene = new Scene();
    const camera = new PerspectiveCamera({ aspect: 1, far: 100, near: 0.1 });
    const store = new MeshRendererStore(scene);
    const mesh = createCubeGeometry();

    const visible = scene.createEntity({ layerMask: 0b01 });
    store.attach(visible, { mesh });

    const offscreen = scene.createEntity({
      layerMask: 0b01,
      transform: { translation: [100, 0, 0] },
    });
    store.attach(offscreen, { mesh });

    const behind = scene.createEntity({ layerMask: 0b01, transform: { translation: [0, 0, 10] } });
    store.attach(behind, { mesh });

    const wrongLayer = scene.createEntity({ layerMask: 0b10 });
    store.attach(wrongLayer, { mesh });

    const hiddenParent = scene.createEntity({ visible: false });
    const hiddenChild = scene.createEntity({ layerMask: 0b01, parent: hiddenParent });
    store.attach(hiddenChild, { mesh });

    const disabled = scene.createEntity({ layerMask: 0b01 });
    store.attach(disabled, { enabled: false, mesh });

    const queues = new VisibilitySystem().build(scene, camera, store, { cameraLayerMask: 0b01 });

    expect(queues.opaque.map(({ entity }) => entity)).toEqual([visible]);
    expect(queues.transparent).toEqual([]);
    expect(queues.diagnostics).toEqual({
      disabledCount: 1,
      frustumCulledCount: 2,
      hiddenCount: 1,
      layerCulledCount: 1,
      opaqueCount: 1,
      totalCount: 6,
      transparentCount: 0,
      visibleCount: 1,
    });
  });

  it('can explicitly disable frustum culling without bypassing other gates', () => {
    const scene = new Scene();
    const camera = new PerspectiveCamera();
    const store = new MeshRendererStore(scene);
    const entity = scene.createEntity({ transform: { translation: [100, 0, 0] } });
    store.attach(entity, { mesh: createCubeGeometry() });

    const queues = new VisibilitySystem().build(scene, camera, store, { frustumCulling: false });

    expect(queues.opaque.map((item) => item.entity)).toEqual([entity]);
    expect(queues.diagnostics.frustumCulledCount).toBe(0);
  });

  it('validates camera layer masks', () => {
    const scene = new Scene();
    const camera = new PerspectiveCamera();
    const store = new MeshRendererStore(scene);
    const visibility = new VisibilitySystem();

    expect(() => visibility.build(scene, camera, store, { cameraLayerMask: -1 })).toThrow(
      /32-bit/u,
    );
    expect(() => visibility.build(scene, camera, store, { cameraLayerMask: 1.5 })).toThrow(
      /32-bit/u,
    );
  });
});
