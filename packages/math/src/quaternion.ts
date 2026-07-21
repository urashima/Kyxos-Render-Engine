import { createVec3, crossVec3, dotVec3, scaleVec3 } from './vec3.js';
import {
  NORMALIZATION_EPSILON,
  assertFiniteNumber,
  assertQuaternion,
  assertVec3,
} from './validation.js';

import type { Quaternion, Vec3 } from './types.js';

function immutableQuaternion(x: number, y: number, z: number, w: number): Quaternion {
  assertFiniteNumber('x', x);
  assertFiniteNumber('y', y);
  assertFiniteNumber('z', z);
  assertFiniteNumber('w', w);
  return Object.freeze([x, y, z, w]) as Quaternion;
}

export function normalizeQuaternion(value: Quaternion): Quaternion {
  assertQuaternion('value', value);
  const magnitude = Math.hypot(value[0], value[1], value[2], value[3]);
  if (!Number.isFinite(magnitude) || magnitude <= NORMALIZATION_EPSILON) {
    throw new RangeError('Cannot normalize a zero-length or nonfinite quaternion.');
  }
  const inverse = 1 / magnitude;
  return immutableQuaternion(
    value[0] * inverse,
    value[1] * inverse,
    value[2] * inverse,
    value[3] * inverse,
  );
}

export function createQuaternion(x = 0, y = 0, z = 0, w = 1): Quaternion {
  return normalizeQuaternion(immutableQuaternion(x, y, z, w));
}

export function identityQuaternion(): Quaternion {
  return immutableQuaternion(0, 0, 0, 1);
}

export function quaternionFromAxisAngle(axis: Vec3, angleRadians: number): Quaternion {
  assertVec3('axis', axis);
  assertFiniteNumber('angleRadians', angleRadians);
  const axisLength = Math.hypot(axis[0], axis[1], axis[2]);
  if (!Number.isFinite(axisLength) || axisLength <= NORMALIZATION_EPSILON) {
    throw new RangeError('Quaternion axis must have nonzero length.');
  }
  const halfAngle = angleRadians / 2;
  const scale = Math.sin(halfAngle) / axisLength;
  return createQuaternion(axis[0] * scale, axis[1] * scale, axis[2] * scale, Math.cos(halfAngle));
}

export function multiplyQuaternions(parent: Quaternion, local: Quaternion): Quaternion {
  assertQuaternion('parent', parent);
  assertQuaternion('local', local);
  const [ax, ay, az, aw] = parent;
  const [bx, by, bz, bw] = local;
  return createQuaternion(
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  );
}

export function conjugateQuaternion(value: Quaternion): Quaternion {
  assertQuaternion('value', value);
  return immutableQuaternion(-value[0], -value[1], -value[2], value[3]);
}

export function rotateVec3ByQuaternion(value: Vec3, rotation: Quaternion): Vec3 {
  assertVec3('value', value);
  const normalized = normalizeQuaternion(rotation);
  const vectorPart = createVec3(normalized[0], normalized[1], normalized[2]);
  const twiceCross = scaleVec3(crossVec3(vectorPart, value), 2);
  const correction = crossVec3(vectorPart, twiceCross);
  return createVec3(
    value[0] + normalized[3] * twiceCross[0] + correction[0],
    value[1] + normalized[3] * twiceCross[1] + correction[1],
    value[2] + normalized[3] * twiceCross[2] + correction[2],
  );
}

export function dotQuaternions(left: Quaternion, right: Quaternion): number {
  assertQuaternion('left', left);
  assertQuaternion('right', right);
  const result = left[0] * right[0] + left[1] * right[1] + left[2] * right[2] + left[3] * right[3];
  assertFiniteNumber('quaternion dot product', result);
  return result;
}

export function quaternionVectorLength(value: Quaternion): number {
  assertQuaternion('value', value);
  return Math.sqrt(dotVec3([value[0], value[1], value[2]], [value[0], value[1], value[2]]));
}
