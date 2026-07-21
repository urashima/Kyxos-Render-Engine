import { createVec3, dotVec3 } from './vec3.js';
import { NORMALIZATION_EPSILON, assertFiniteNumber, assertMat4, assertVec3 } from './validation.js';

import type { Aabb, BoundingSphere, Frustum, Mat4, Plane, Vec3 } from './types.js';

export function createPlane(normal: Vec3, constant: number): Plane {
  assertVec3('normal', normal);
  assertFiniteNumber('constant', constant);
  const magnitude = Math.hypot(normal[0], normal[1], normal[2]);
  if (!Number.isFinite(magnitude) || magnitude <= NORMALIZATION_EPSILON) {
    throw new RangeError('Plane normal must have nonzero length.');
  }
  const inverse = 1 / magnitude;
  return Object.freeze({
    normal: createVec3(normal[0] * inverse, normal[1] * inverse, normal[2] * inverse),
    constant: constant * inverse,
  });
}

export function signedDistanceToPlane(plane: Plane, point: Vec3): number {
  assertVec3('point', point);
  const result = dotVec3(plane.normal, point) + plane.constant;
  assertFiniteNumber('signed plane distance', result);
  return result;
}

export function extractFrustum(viewProjection: Mat4): Frustum {
  assertMat4('viewProjection', viewProjection);
  const row0 = [
    viewProjection[0],
    viewProjection[4],
    viewProjection[8],
    viewProjection[12],
  ] as const;
  const row1 = [
    viewProjection[1],
    viewProjection[5],
    viewProjection[9],
    viewProjection[13],
  ] as const;
  const row2 = [
    viewProjection[2],
    viewProjection[6],
    viewProjection[10],
    viewProjection[14],
  ] as const;
  const row3 = [
    viewProjection[3],
    viewProjection[7],
    viewProjection[11],
    viewProjection[15],
  ] as const;
  const fromRows = (left: readonly number[], right: readonly number[], sign: 1 | -1): Plane =>
    createPlane(
      [
        (left[0] as number) + sign * (right[0] as number),
        (left[1] as number) + sign * (right[1] as number),
        (left[2] as number) + sign * (right[2] as number),
      ],
      (left[3] as number) + sign * (right[3] as number),
    );

  return Object.freeze({
    planes: Object.freeze([
      fromRows(row3, row0, 1),
      fromRows(row3, row0, -1),
      fromRows(row3, row1, 1),
      fromRows(row3, row1, -1),
      createPlane([row2[0], row2[1], row2[2]], row2[3]),
      fromRows(row3, row2, -1),
    ]),
  }) as Frustum;
}

export function frustumContainsPoint(frustum: Frustum, point: Vec3): boolean {
  return frustum.planes.every((plane) => signedDistanceToPlane(plane, point) >= 0);
}

export function frustumIntersectsSphere(frustum: Frustum, sphere: BoundingSphere): boolean {
  return frustum.planes.every(
    (plane) => signedDistanceToPlane(plane, sphere.center) >= -sphere.radius,
  );
}

export function frustumIntersectsAabb(frustum: Frustum, bounds: Aabb): boolean {
  return frustum.planes.every((plane) => {
    const positiveVertex: Vec3 = [
      plane.normal[0] >= 0 ? bounds.max[0] : bounds.min[0],
      plane.normal[1] >= 0 ? bounds.max[1] : bounds.min[1],
      plane.normal[2] >= 0 ? bounds.max[2] : bounds.min[2],
    ];
    return signedDistanceToPlane(plane, positiveVertex) >= 0;
  });
}
