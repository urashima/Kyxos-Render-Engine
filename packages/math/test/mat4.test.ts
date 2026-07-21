import { describe, expect, it } from 'vitest';

import {
  approximatelyEqualVec3,
  composeTrsMat4,
  identityMat4,
  lookAtMat4,
  multiplyMat4,
  perspectiveMat4,
  quaternionFromAxisAngle,
  transformDirectionMat4,
  transformPointMat4,
  translationMat4,
} from '../src/index.js';

describe('Mat4', () => {
  it('uses column vectors and parentWorld multiplied by local', () => {
    const parent = translationMat4([10, 0, 0]);
    const local = translationMat4([0, 2, 0]);
    const world = multiplyMat4(parent, local);

    expect(transformPointMat4(world, [0, 0, 0])).toEqual([10, 2, 0]);
    expect(multiplyMat4(identityMat4(), world)).toEqual(world);
  });

  it('composes local transforms in T × R × S order', () => {
    const rotation = quaternionFromAxisAngle([0, 0, 1], Math.PI / 2);
    const matrix = composeTrsMat4([5, 1, 0], rotation, [2, 3, 1]);

    expect(approximatelyEqualVec3(transformPointMat4(matrix, [1, 0, 0]), [5, 3, 0])).toBe(true);
    expect(approximatelyEqualVec3(transformDirectionMat4(matrix, [0, 1, 0]), [-3, 0, 0])).toBe(
      true,
    );
  });

  it('maps the camera eye and target using a right-handed negative-Z view', () => {
    const view = lookAtMat4([0, 0, 5], [0, 0, 0], [0, 1, 0]);

    expect(transformPointMat4(view, [0, 0, 5])).toEqual([0, 0, 0]);
    expect(transformPointMat4(view, [0, 0, 0])).toEqual([0, 0, -5]);
  });

  it('uses canonical zero-to-one perspective depth', () => {
    const projection = perspectiveMat4(Math.PI / 2, 1, 0.1, 100);

    expect(transformPointMat4(projection, [0, 0, -0.1])[2]).toBeCloseTo(0, 12);
    expect(transformPointMat4(projection, [0, 0, -100])[2]).toBeCloseTo(1, 12);
    const corner = transformPointMat4(projection, [1, 1, -1]);
    expect(corner[0]).toBeCloseTo(1, 12);
    expect(corner[1]).toBeCloseTo(1, 12);
  });

  it('supports an infinite far plane and rejects invalid projections', () => {
    const projection = perspectiveMat4(Math.PI / 3, 2, 0.25);

    expect(transformPointMat4(projection, [0, 0, -0.25])[2]).toBeCloseTo(0, 12);
    expect(transformPointMat4(projection, [0, 0, -1_000_000])[2]).toBeCloseTo(1, 6);
    expect(() => perspectiveMat4(0, 1, 0.1, 100)).toThrow(/between/u);
    expect(() => perspectiveMat4(1, 0, 0.1, 100)).toThrow(/aspect/u);
    expect(() => perspectiveMat4(1, 1, 1, 1)).toThrow(/greater than near/u);
  });

  it('rejects degenerate camera bases and projective points at W zero', () => {
    expect(() => lookAtMat4([0, 0, 0], [0, 0, 0], [0, 1, 0])).toThrow(/zero-length/u);
    expect(() => lookAtMat4([0, 0, 5], [0, 0, 0], [0, 0, 1])).toThrow(/parallel/u);
    expect(() => transformPointMat4(perspectiveMat4(1, 1, 0.1, 100), [0, 0, 0])).toThrow(
      /homogeneous W/u,
    );
  });
});
