import {
  approximatelyEqualVec3,
  createAabb,
  extractTranslationMat4,
  quaternionFromAxisAngle,
} from '@kyxos/render-math';
import { describe, expect, it } from 'vitest';

import { Scene, createLocalTransform } from '../src/index.js';

describe('Scene transforms', () => {
  it('propagates parent changes and caches unchanged world matrices', () => {
    const scene = new Scene();
    const parent = scene.createEntity({ transform: { translation: [10, 0, 0] } });
    const child = scene.createEntity({ parent, transform: { translation: [0, 2, 0] } });

    expect(extractTranslationMat4(scene.worldMatrixOf(child))).toEqual([10, 2, 0]);
    const updatesAfterFirstRead = scene.diagnostics().worldTransformUpdateCount;
    scene.worldMatrixOf(child);
    expect(scene.diagnostics().worldTransformUpdateCount).toBe(updatesAfterFirstRead);

    scene.setLocalTransform(parent, { translation: [20, 0, 0] });
    expect(scene.diagnostics().dirtyTransformCount).toBe(2);
    expect(scene.updateWorldTransforms()).toBe(2);
    expect(extractTranslationMat4(scene.worldMatrixOf(child))).toEqual([20, 2, 0]);
    expect(scene.updateWorldTransforms()).toBe(0);
  });

  it('reparents with local TRS unchanged and recomputes the new world transform', () => {
    const scene = new Scene();
    const firstParent = scene.createEntity({ transform: { translation: [10, 0, 0] } });
    const secondParent = scene.createEntity({ transform: { translation: [20, 0, 0] } });
    const child = scene.createEntity({
      parent: firstParent,
      transform: { translation: [1, 0, 0] },
    });

    expect(extractTranslationMat4(scene.worldMatrixOf(child))).toEqual([11, 0, 0]);
    scene.setParent(child, secondParent);
    expect(scene.localTransformOf(child).translation).toEqual([1, 0, 0]);
    expect(extractTranslationMat4(scene.worldMatrixOf(child))).toEqual([21, 0, 0]);
  });

  it('normalizes and freezes local transforms while rejecting nonfinite values', () => {
    const transform = createLocalTransform({
      rotation: [0, 0, 0, 2],
      scale: [2, 3, 4],
      translation: [1, 2, 3],
    });

    expect(transform.rotation).toEqual([0, 0, 0, 1]);
    expect(Object.isFrozen(transform)).toBe(true);
    expect(() => createLocalTransform({ scale: [1, Number.NaN, 1] })).toThrow(/finite/u);
    expect(() => createLocalTransform({ rotation: [0, 0, 0, 0] })).toThrow(/zero-length/u);
  });

  it('updates partial local TRS without resetting unspecified fields', () => {
    const scene = new Scene();
    const rotation = quaternionFromAxisAngle([0, 1, 0], Math.PI / 2);
    const entity = scene.createEntity({
      transform: { rotation, scale: [2, 3, 4], translation: [1, 2, 3] },
    });

    scene.setLocalTransform(entity, { translation: [5, 6, 7] });

    expect(scene.localTransformOf(entity)).toEqual({
      rotation,
      scale: [2, 3, 4],
      translation: [5, 6, 7],
    });
  });

  it('transforms local bounds and aggregates visible layers', () => {
    const scene = new Scene();
    const first = scene.createEntity({
      layerMask: 0b01,
      localBounds: createAabb([-1, -1, -1], [1, 1, 1]),
      transform: { translation: [10, 0, 0] },
    });
    const second = scene.createEntity({
      layerMask: 0b10,
      localBounds: createAabb([-2, -2, -2], [2, 2, 2]),
      transform: {
        rotation: quaternionFromAxisAngle([0, 1, 0], Math.PI / 2),
        translation: [-5, 0, 0],
      },
    });

    expect(scene.worldBoundsOf(first)).toEqual({ min: [9, -1, -1], max: [11, 1, 1] });
    expect(scene.calculateWorldBounds({ layerMask: 0b01 })).toEqual({
      min: [9, -1, -1],
      max: [11, 1, 1],
    });
    const aggregate = scene.calculateWorldBounds();
    expect(aggregate).not.toBeNull();
    expect(approximatelyEqualVec3(aggregate?.min ?? [0, 0, 0], [-7, -2, -2])).toBe(true);
    expect(approximatelyEqualVec3(aggregate?.max ?? [0, 0, 0], [11, 2, 2])).toBe(true);
    scene.setVisible(second, false);
    expect(scene.calculateWorldBounds()).toEqual({ min: [9, -1, -1], max: [11, 1, 1] });
    const allBounds = scene.calculateWorldBounds({ visibleOnly: false });
    expect(allBounds).not.toBeNull();
    expect(approximatelyEqualVec3(allBounds?.min ?? [0, 0, 0], [-7, -2, -2])).toBe(true);
    expect(approximatelyEqualVec3(allBounds?.max ?? [0, 0, 0], [11, 2, 2])).toBe(true);
  });

  it('inherits visibility while retaining independent layer masks', () => {
    const scene = new Scene();
    const parent = scene.createEntity();
    const child = scene.createEntity({ layerMask: 0, parent });

    expect(scene.isWorldVisible(child)).toBe(true);
    expect(scene.layerMaskOf(child)).toBe(0);
    scene.setVisible(parent, false);
    expect(scene.visibleOf(child)).toBe(true);
    expect(scene.isWorldVisible(child)).toBe(false);
    expect(() => scene.setLayerMask(child, 0x1_0000_0000)).toThrow(/32-bit/u);
  });
});
