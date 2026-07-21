import { describe, expect, it, vi } from 'vitest';

import { Scene } from '../src/index.js';

describe('Scene events and lifecycle', () => {
  it('emits one revisioned change per accepted mutation', () => {
    const scene = new Scene();
    const changes: string[] = [];
    scene.on('changed', ({ affectedEntityCount, kind, revision }) => {
      changes.push(`${revision}:${kind}:${affectedEntityCount}`);
    });
    const root = scene.createEntity();
    const child = scene.createEntity({ parent: root });
    scene.setLocalTransform(root, { translation: [1, 0, 0] });
    scene.setName(child, 'renamed');
    scene.setName(child, 'renamed');

    expect(changes).toEqual([
      '1:entity-created:1',
      '2:entity-created:1',
      '3:transform:2',
      '4:name:1',
    ]);
    expect(scene.revision).toBe(4);
  });

  it('supports deterministic unsubscribe and idempotent disposal', () => {
    const scene = new Scene();
    const listener = vi.fn();
    const unsubscribe = scene.on('changed', listener);
    scene.createEntity();
    unsubscribe();
    unsubscribe();
    scene.createEntity();

    expect(listener).toHaveBeenCalledTimes(1);
    scene.dispose();
    scene.dispose();
    expect(scene.disposed).toBe(true);
    expect(() => scene.createEntity()).toThrow(/disposed/u);
    expect(() => scene.roots()).toThrow(/disposed/u);
  });

  it('clears the scene once and rejects invalid public names', () => {
    const scene = new Scene();
    scene.createEntity();
    scene.createEntity();

    expect(scene.clear()).toBe(2);
    expect(scene.clear()).toBe(0);
    expect(scene.entityCount).toBe(0);
    expect(() => scene.createEntity({ name: '   ' })).toThrow(/name/u);
  });
});
