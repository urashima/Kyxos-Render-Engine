import { PerspectiveCamera } from '@kyxos/render-camera';
import { createCubeGeometry } from '@kyxos/render-geometry';
import { Scene } from '@kyxos/render-scene';
import { describe, expect, it } from 'vitest';

import { MeshRendererStore, VisibilitySystem } from '../src/index.js';

describe('Render Queue sorting and caching', () => {
  it('sorts opaque items by order, pipeline, material, distance, and stable sequence', () => {
    const scene = new Scene();
    const camera = new PerspectiveCamera();
    const store = new MeshRendererStore(scene);
    const mesh = createCubeGeometry();
    const pipelineB = scene.createEntity();
    store.attach(pipelineB, { materialKey: 'a', mesh, pipelineKey: 'b' });
    const materialZ = scene.createEntity();
    store.attach(materialZ, { materialKey: 'z', mesh, pipelineKey: 'a' });
    const materialA = scene.createEntity({ transform: { translation: [0, 0, -1] } });
    store.attach(materialA, { materialKey: 'a', mesh, pipelineKey: 'a' });
    const explicitFirst = scene.createEntity();
    store.attach(explicitFirst, { mesh, pipelineKey: 'z', renderOrder: -1 });

    const queues = new VisibilitySystem().build(scene, camera, store);

    expect(queues.opaque.map(({ entity }) => entity)).toEqual([
      explicitFirst,
      materialA,
      materialZ,
      pipelineB,
    ]);
  });

  it('sorts transparent items back-to-front within explicit render order', () => {
    const scene = new Scene();
    const camera = new PerspectiveCamera({ far: 100 });
    const store = new MeshRendererStore(scene);
    const mesh = createCubeGeometry();
    const near = scene.createEntity({ transform: { translation: [0, 0, 1] } });
    store.attach(near, { alphaMode: 'blend', mesh });
    const far = scene.createEntity({ transform: { translation: [0, 0, -5] } });
    store.attach(far, { alphaMode: 'blend', mesh });
    const laterOrder = scene.createEntity({ transform: { translation: [0, 0, -10] } });
    store.attach(laterOrder, { alphaMode: 'blend', mesh, renderOrder: 1 });

    const queues = new VisibilitySystem().build(scene, camera, store);

    expect(queues.transparent.map(({ entity }) => entity)).toEqual([far, near, laterOrder]);
  });

  it('preserves insertion order when all sort keys are equal', () => {
    const scene = new Scene();
    const camera = new PerspectiveCamera();
    const store = new MeshRendererStore(scene);
    const mesh = createCubeGeometry();
    const first = scene.createEntity();
    const second = scene.createEntity();
    store.attach(first, { alphaMode: 'blend', mesh });
    store.attach(second, { alphaMode: 'blend', mesh });

    expect(
      new VisibilitySystem().build(scene, camera, store).transparent.map(({ entity }) => entity),
    ).toEqual([first, second]);
  });

  it('reuses an immutable Draw List until Scene, Camera, Store, or options change', () => {
    const scene = new Scene();
    const camera = new PerspectiveCamera();
    const store = new MeshRendererStore(scene);
    const mesh = createCubeGeometry();
    const entity = scene.createEntity();
    store.attach(entity, { mesh });
    const visibility = new VisibilitySystem();

    const first = visibility.build(scene, camera, store);
    expect(visibility.build(scene, camera, store)).toBe(first);
    expect(Object.isFrozen(first.opaque)).toBe(true);
    expect(Object.isFrozen(first.opaque[0])).toBe(true);

    scene.setLocalTransform(entity, { translation: [0, 0, -1] });
    const afterScene = visibility.build(scene, camera, store);
    expect(afterScene).not.toBe(first);

    camera.setAspect(2);
    const afterCamera = visibility.build(scene, camera, store);
    expect(afterCamera).not.toBe(afterScene);

    store.update(entity, { materialKey: 'updated', mesh });
    const afterStore = visibility.build(scene, camera, store);
    expect(afterStore).not.toBe(afterCamera);

    const afterOptions = visibility.build(scene, camera, store, { frustumCulling: false });
    expect(afterOptions).not.toBe(afterStore);
    expect(visibility.build(scene, camera, store, { frustumCulling: false })).toBe(afterOptions);
  });
});
