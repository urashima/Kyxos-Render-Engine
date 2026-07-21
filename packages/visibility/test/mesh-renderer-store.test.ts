import { createCubeGeometry, createPlaneGeometry } from '@kyxos/render-geometry';
import { createAabb } from '@kyxos/render-math';
import { Scene } from '@kyxos/render-scene';
import { describe, expect, it } from 'vitest';

import { MeshRendererStore } from '../src/index.js';

describe('MeshRendererStore', () => {
  it('attaches immutable components and owns the Entity local bounds', () => {
    const scene = new Scene();
    const store = new MeshRendererStore(scene);
    const entity = scene.createEntity();
    const mesh = createCubeGeometry();
    const component = store.attach(entity, {
      alphaMode: 'blend',
      baseColor: [0.1, 0.2, 0.3, 0.4],
      materialKey: 'glass',
      mesh,
      pipelineKey: 'transparent',
      renderOrder: 2,
    });

    expect(component).toMatchObject({
      alphaMode: 'blend',
      baseColor: [0.1, 0.2, 0.3, 0.4],
      materialKey: 'glass',
      mesh,
      pipelineKey: 'transparent',
      renderOrder: 2,
      sequence: 1,
    });
    expect(Object.isFrozen(component)).toBe(true);
    expect(scene.localBoundsOf(entity)).toEqual(mesh.bounds);
    expect(store.size).toBe(1);
    expect(store.revision).toBe(1);
  });

  it('updates in place, preserves sequence, and supports a bounds override', () => {
    const scene = new Scene();
    const store = new MeshRendererStore(scene);
    const entity = scene.createEntity();
    const original = store.attach(entity, { mesh: createCubeGeometry() });
    const override = createAabb([-2, 0, -3], [2, 0, 3]);
    const updated = store.update(entity, {
      localBounds: override,
      mesh: createPlaneGeometry(),
      pipelineKey: 'plane',
    });

    expect(updated.sequence).toBe(original.sequence);
    expect(updated.pipelineKey).toBe('plane');
    expect(scene.localBoundsOf(entity)).toEqual(override);
    expect(store.revision).toBe(2);
  });

  it('rejects duplicates and malformed component state', () => {
    const scene = new Scene();
    const store = new MeshRendererStore(scene);
    const entity = scene.createEntity();
    const mesh = createCubeGeometry();
    store.attach(entity, { mesh });

    expect(() => store.attach(entity, { mesh })).toThrow(/already/u);
    expect(() => store.update(scene.createEntity(), { mesh })).toThrow(/no Mesh Renderer/u);
    expect(() => store.attach(scene.createEntity(), { materialKey: ' ', mesh })).toThrow(
      /materialKey/u,
    );
    expect(() => store.attach(scene.createEntity(), { mesh, renderOrder: 1.5 })).toThrow(
      /safe integer/u,
    );
    expect(() => store.attach(scene.createEntity(), { baseColor: [1, 0, 0, 1.1], mesh })).toThrow(
      /baseColor/u,
    );
  });

  it('purges destroyed subtrees and cleared scenes', () => {
    const scene = new Scene();
    const store = new MeshRendererStore(scene);
    const root = scene.createEntity();
    const child = scene.createEntity({ parent: root });
    store.attach(root, { mesh: createCubeGeometry() });
    store.attach(child, { mesh: createCubeGeometry() });

    scene.destroyEntity(root);
    expect(store.size).toBe(0);
    expect(store.revision).toBe(3);

    const next = scene.createEntity();
    store.attach(next, { mesh: createCubeGeometry() });
    scene.clear();
    expect(store.size).toBe(0);
  });

  it('detaches and disposes owned bounds without affecting mesh resources', () => {
    const scene = new Scene();
    const store = new MeshRendererStore(scene);
    const first = scene.createEntity();
    const second = scene.createEntity();
    store.attach(first, { mesh: createCubeGeometry() });
    store.attach(second, { mesh: createPlaneGeometry() });

    expect(store.detach(first)).toBe(true);
    expect(store.detach(first)).toBe(false);
    expect(scene.localBoundsOf(first)).toBeNull();
    store.dispose();
    store.dispose();
    expect(scene.localBoundsOf(second)).toBeNull();
    expect(() => store.entries()).toThrow(/disposed/u);
  });
});
