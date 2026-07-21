import { describe, expect, it } from 'vitest';

import {
  aabbCenter,
  aabbFromPoints,
  aabbSize,
  boundingSphereFromAabb,
  composeTrsMat4,
  createAabb,
  createBoundingSphere,
  createPlane,
  extractFrustum,
  frustumContainsPoint,
  frustumIntersectsAabb,
  frustumIntersectsSphere,
  identityQuaternion,
  lookAtMat4,
  multiplyMat4,
  perspectiveMat4,
  signedDistanceToPlane,
  transformAabb,
  transformBoundingSphere,
} from '../src/index.js';

describe('bounds', () => {
  it('derives immutable AABB center, size, and conservative sphere', () => {
    const bounds = aabbFromPoints([
      [-1, -2, -3],
      [4, 5, 6],
      [0, 10, 1],
    ]);
    const sphere = boundingSphereFromAabb(bounds);

    expect(bounds).toEqual({ min: [-1, -2, -3], max: [4, 10, 6] });
    expect(aabbCenter(bounds)).toEqual([1.5, 4, 1.5]);
    expect(aabbSize(bounds)).toEqual([5, 12, 9]);
    expect(sphere.radius).toBeCloseTo(Math.hypot(2.5, 6, 4.5), 12);
    expect(Object.isFrozen(bounds)).toBe(true);
  });

  it('transforms all AABB corners and scales spheres conservatively', () => {
    const matrix = composeTrsMat4([2, 3, 4], identityQuaternion(), [2, 1, 0.5]);
    const bounds = transformAabb(createAabb([-1, -1, -1], [1, 1, 1]), matrix);
    const sphere = transformBoundingSphere(createBoundingSphere([0, 0, 0], 1), matrix);

    expect(bounds).toEqual({ min: [0, 2, 3.5], max: [4, 4, 4.5] });
    expect(sphere).toEqual({ center: [2, 3, 4], radius: 2 });
  });

  it('rejects empty, reversed, and nonfinite bounds', () => {
    expect(() => aabbFromPoints([])).toThrow(/empty/u);
    expect(() => createAabb([1, 0, 0], [0, 1, 1])).toThrow(/minimum/u);
    expect(() => createBoundingSphere([0, 0, 0], -1)).toThrow(/non-negative/u);
    expect(() => createBoundingSphere([0, Number.POSITIVE_INFINITY, 0], 1)).toThrow(/finite/u);
  });
});

describe('frustum', () => {
  const view = lookAtMat4([0, 0, 5], [0, 0, 0], [0, 1, 0]);
  const projection = perspectiveMat4(Math.PI / 2, 1, 0.1, 100);
  const frustum = extractFrustum(multiplyMat4(projection, view));

  it('extracts normalized inward planes from canonical zero-to-one clip space', () => {
    expect(frustum.planes).toHaveLength(6);
    expect(frustumContainsPoint(frustum, [0, 0, 0])).toBe(true);
    expect(frustumContainsPoint(frustum, [0, 0, 5])).toBe(false);
    expect(frustumContainsPoint(frustum, [100, 0, 0])).toBe(false);
  });

  it('uses conservative sphere and positive-vertex AABB tests', () => {
    expect(frustumIntersectsSphere(frustum, createBoundingSphere([0, 0, 0], 1))).toBe(true);
    expect(frustumIntersectsSphere(frustum, createBoundingSphere([20, 0, 0], 1))).toBe(false);
    expect(frustumIntersectsAabb(frustum, createAabb([-1, -1, -1], [1, 1, 1]))).toBe(true);
    expect(frustumIntersectsAabb(frustum, createAabb([20, -1, -1], [22, 1, 1]))).toBe(false);
  });

  it('normalizes explicit planes and rejects zero normals', () => {
    const plane = createPlane([0, 2, 0], -4);

    expect(plane).toEqual({ normal: [0, 1, 0], constant: -2 });
    expect(signedDistanceToPlane(plane, [0, 3, 0])).toBe(1);
    expect(() => createPlane([0, 0, 0], 0)).toThrow(/nonzero/u);
  });
});
