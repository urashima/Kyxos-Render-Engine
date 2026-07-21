import {
  addVec3,
  createVec3,
  distanceVec3,
  maxVec3,
  minVec3,
  scaleVec3,
  subtractVec3,
} from './vec3.js';
import { maxScaleOnAxisMat4, transformPointMat4 } from './mat4.js';
import { assertNonNegativeFiniteNumber, assertVec3 } from './validation.js';

import type { Aabb, BoundingSphere, Mat4, Vec3 } from './types.js';

export function createAabb(min: Vec3, max: Vec3): Aabb {
  assertVec3('min', min);
  assertVec3('max', max);
  if (min[0] > max[0] || min[1] > max[1] || min[2] > max[2]) {
    throw new RangeError('AABB minimum must not exceed its maximum on any axis.');
  }
  return Object.freeze({
    min: createVec3(min[0], min[1], min[2]),
    max: createVec3(max[0], max[1], max[2]),
  });
}

export function aabbFromPoints(points: readonly Vec3[]): Aabb {
  const first = points[0];
  if (first === undefined) throw new RangeError('Cannot create an AABB from an empty point set.');
  assertVec3('points[0]', first);
  let min = first;
  let max = first;
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index] as Vec3;
    assertVec3(`points[${index}]`, point);
    min = minVec3(min, point);
    max = maxVec3(max, point);
  }
  return createAabb(min, max);
}

export function mergeAabbs(left: Aabb, right: Aabb): Aabb {
  return createAabb(minVec3(left.min, right.min), maxVec3(left.max, right.max));
}

export function aabbCenter(bounds: Aabb): Vec3 {
  return scaleVec3(addVec3(bounds.min, bounds.max), 0.5);
}

export function aabbSize(bounds: Aabb): Vec3 {
  return subtractVec3(bounds.max, bounds.min);
}

export function aabbExtents(bounds: Aabb): Vec3 {
  return scaleVec3(aabbSize(bounds), 0.5);
}

export function transformAabb(bounds: Aabb, matrix: Mat4): Aabb {
  const { min, max } = bounds;
  return aabbFromPoints([
    transformPointMat4(matrix, [min[0], min[1], min[2]]),
    transformPointMat4(matrix, [max[0], min[1], min[2]]),
    transformPointMat4(matrix, [min[0], max[1], min[2]]),
    transformPointMat4(matrix, [max[0], max[1], min[2]]),
    transformPointMat4(matrix, [min[0], min[1], max[2]]),
    transformPointMat4(matrix, [max[0], min[1], max[2]]),
    transformPointMat4(matrix, [min[0], max[1], max[2]]),
    transformPointMat4(matrix, [max[0], max[1], max[2]]),
  ]);
}

export function createBoundingSphere(center: Vec3, radius: number): BoundingSphere {
  assertVec3('center', center);
  assertNonNegativeFiniteNumber('radius', radius);
  return Object.freeze({ center: createVec3(center[0], center[1], center[2]), radius });
}

export function boundingSphereFromAabb(bounds: Aabb): BoundingSphere {
  const center = aabbCenter(bounds);
  return createBoundingSphere(center, distanceVec3(center, bounds.max));
}

export function transformBoundingSphere(sphere: BoundingSphere, matrix: Mat4): BoundingSphere {
  return createBoundingSphere(
    transformPointMat4(matrix, sphere.center),
    sphere.radius * maxScaleOnAxisMat4(matrix),
  );
}
