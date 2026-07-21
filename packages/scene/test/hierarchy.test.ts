import { extractTranslationMat4 } from '@kyxos/render-math';
import { describe, expect, it } from 'vitest';

import { Scene } from '../src/index.js';

describe('Scene hierarchy', () => {
  it('owns opaque entities and preserves deterministic hierarchy order', () => {
    const scene = new Scene();
    const root = scene.createEntity({ name: 'root' });
    const first = scene.createEntity({ name: 'first', parent: root });
    const second = scene.createEntity({ name: 'second', parent: root });

    expect(scene.roots()).toEqual([root]);
    expect(scene.childrenOf(root)).toEqual([first, second]);
    expect(scene.parentOf(first)).toBe(root);
    expect(scene.nameOf(second)).toBe('second');
    expect(Object.isFrozen(root)).toBe(true);
  });

  it('rejects hierarchy cycles without mutating the accepted tree', () => {
    const scene = new Scene();
    const root = scene.createEntity();
    const child = scene.createEntity({ parent: root });
    const grandchild = scene.createEntity({ parent: child });

    expect(() => scene.setParent(root, grandchild)).toThrow(/descendants/u);
    expect(scene.parentOf(root)).toBeNull();
    expect(scene.parentOf(child)).toBe(root);
    expect(scene.parentOf(grandchild)).toBe(child);
  });

  it('rejects foreign entities and treats owned stale destruction idempotently', () => {
    const firstScene = new Scene();
    const secondScene = new Scene();
    const entity = firstScene.createEntity();
    const foreign = secondScene.createEntity();

    expect(() => firstScene.parentOf(foreign)).toThrow(/different Scene/u);
    expect(firstScene.destroyEntity(entity)).toBe(1);
    expect(firstScene.destroyEntity(entity)).toBe(0);
    expect(() => firstScene.parentOf(entity)).toThrow(/no longer exists/u);
    expect(firstScene.createEntity().id).toBeGreaterThan(entity.id);
  });

  it('destroys a complete subtree without disturbing siblings', () => {
    const scene = new Scene();
    const root = scene.createEntity();
    const removed = scene.createEntity({ parent: root });
    scene.createEntity({ parent: removed });
    const sibling = scene.createEntity({ parent: root });

    expect(scene.destroyEntity(removed)).toBe(2);
    expect(scene.entityCount).toBe(2);
    expect(scene.childrenOf(root)).toEqual([sibling]);
  });

  it('handles a deep hierarchy without recursive transform traversal', () => {
    const scene = new Scene();
    let entity = scene.createEntity({ transform: { translation: [1, 0, 0] } });
    for (let index = 1; index < 2_000; index += 1) {
      entity = scene.createEntity({ parent: entity, transform: { translation: [1, 0, 0] } });
    }

    expect(extractTranslationMat4(scene.worldMatrixOf(entity))).toEqual([2_000, 0, 0]);
    expect(scene.diagnostics().dirtyTransformCount).toBe(0);
  });
});
