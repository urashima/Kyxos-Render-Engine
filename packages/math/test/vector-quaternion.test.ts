import { describe, expect, it } from 'vitest';

import {
  addVec3,
  approximatelyEqualVec3,
  createQuaternion,
  createVec3,
  crossVec3,
  dotVec3,
  identityQuaternion,
  lengthVec3,
  multiplyQuaternions,
  normalizeVec3,
  quaternionFromAxisAngle,
  rotateVec3ByQuaternion,
  scaleVec3,
} from '../src/index.js';

describe('Vec3', () => {
  it('returns immutable values with right-handed cross products', () => {
    const x = createVec3(1, 0, 0);
    const y = createVec3(0, 1, 0);

    expect(Object.isFrozen(x)).toBe(true);
    expect(crossVec3(x, y)).toEqual([0, 0, 1]);
    expect(dotVec3(x, y)).toBe(0);
    expect(addVec3(x, y)).toEqual([1, 1, 0]);
    expect(scaleVec3(addVec3(x, y), 2)).toEqual([2, 2, 0]);
  });

  it('normalizes finite nonzero values without mutating the input', () => {
    const input = createVec3(3, 0, 4);
    const normalized = normalizeVec3(input);

    expect(input).toEqual([3, 0, 4]);
    expect(lengthVec3(normalized)).toBeCloseTo(1, 12);
    expect(approximatelyEqualVec3(normalized, [0.6, 0, 0.8])).toBe(true);
  });

  it('rejects nonfinite and zero-length values', () => {
    expect(() => createVec3(Number.NaN, 0, 0)).toThrow(/finite/u);
    expect(() => normalizeVec3([0, 0, 0])).toThrow(/zero-length/u);
  });
});

describe('Quaternion', () => {
  it('normalizes public construction and preserves identity', () => {
    expect(createQuaternion(0, 0, 0, 5)).toEqual(identityQuaternion());
    expect(Object.isFrozen(identityQuaternion())).toBe(true);
  });

  it('uses right-handed positive rotation', () => {
    const rotation = quaternionFromAxisAngle([0, 0, 1], Math.PI / 2);
    const rotated = rotateVec3ByQuaternion([1, 0, 0], rotation);

    expect(rotated[0]).toBeCloseTo(0, 12);
    expect(rotated[1]).toBeCloseTo(1, 12);
    expect(rotated[2]).toBeCloseTo(0, 12);
  });

  it('composes parent then local rotations', () => {
    const parent = quaternionFromAxisAngle([0, 0, 1], Math.PI / 2);
    const local = quaternionFromAxisAngle([1, 0, 0], Math.PI / 2);
    const composed = multiplyQuaternions(parent, local);

    expect(approximatelyEqualVec3(rotateVec3ByQuaternion([0, 1, 0], composed), [0, 0, 1])).toBe(
      true,
    );
  });

  it('rejects degenerate public values', () => {
    expect(() => createQuaternion(0, 0, 0, 0)).toThrow(/zero-length/u);
    expect(() => quaternionFromAxisAngle([0, 0, 0], 1)).toThrow(/nonzero/u);
  });
});
