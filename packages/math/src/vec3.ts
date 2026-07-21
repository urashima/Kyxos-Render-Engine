import { NORMALIZATION_EPSILON, assertFiniteNumber, assertVec3 } from './validation.js';

import type { Vec3 } from './types.js';

function immutableVec3(x: number, y: number, z: number): Vec3 {
  assertFiniteNumber('x', x);
  assertFiniteNumber('y', y);
  assertFiniteNumber('z', z);
  return Object.freeze([x, y, z]) as Vec3;
}

export function createVec3(x = 0, y = 0, z = 0): Vec3 {
  return immutableVec3(x, y, z);
}

export function addVec3(left: Vec3, right: Vec3): Vec3 {
  assertVec3('left', left);
  assertVec3('right', right);
  return immutableVec3(left[0] + right[0], left[1] + right[1], left[2] + right[2]);
}

export function subtractVec3(left: Vec3, right: Vec3): Vec3 {
  assertVec3('left', left);
  assertVec3('right', right);
  return immutableVec3(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}

export function scaleVec3(value: Vec3, scalar: number): Vec3 {
  assertVec3('value', value);
  assertFiniteNumber('scalar', scalar);
  return immutableVec3(value[0] * scalar, value[1] * scalar, value[2] * scalar);
}

export function negateVec3(value: Vec3): Vec3 {
  assertVec3('value', value);
  return immutableVec3(-value[0], -value[1], -value[2]);
}

export function minVec3(left: Vec3, right: Vec3): Vec3 {
  assertVec3('left', left);
  assertVec3('right', right);
  return immutableVec3(
    Math.min(left[0], right[0]),
    Math.min(left[1], right[1]),
    Math.min(left[2], right[2]),
  );
}

export function maxVec3(left: Vec3, right: Vec3): Vec3 {
  assertVec3('left', left);
  assertVec3('right', right);
  return immutableVec3(
    Math.max(left[0], right[0]),
    Math.max(left[1], right[1]),
    Math.max(left[2], right[2]),
  );
}

export function dotVec3(left: Vec3, right: Vec3): number {
  assertVec3('left', left);
  assertVec3('right', right);
  const result = left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
  assertFiniteNumber('dot product', result);
  return result;
}

export function crossVec3(left: Vec3, right: Vec3): Vec3 {
  assertVec3('left', left);
  assertVec3('right', right);
  return immutableVec3(
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  );
}

export function lengthSquaredVec3(value: Vec3): number {
  return dotVec3(value, value);
}

export function lengthVec3(value: Vec3): number {
  const result = Math.sqrt(lengthSquaredVec3(value));
  assertFiniteNumber('vector length', result);
  return result;
}

export function distanceVec3(left: Vec3, right: Vec3): number {
  return lengthVec3(subtractVec3(left, right));
}

export function normalizeVec3(value: Vec3): Vec3 {
  const magnitude = lengthVec3(value);
  if (magnitude <= NORMALIZATION_EPSILON) {
    throw new RangeError('Cannot normalize a zero-length vector.');
  }
  return scaleVec3(value, 1 / magnitude);
}

export function approximatelyEqualVec3(left: Vec3, right: Vec3, epsilon = 1e-9): boolean {
  assertVec3('left', left);
  assertVec3('right', right);
  assertFiniteNumber('epsilon', epsilon);
  if (epsilon < 0) throw new RangeError('epsilon must be non-negative.');
  return (
    Math.abs(left[0] - right[0]) <= epsilon &&
    Math.abs(left[1] - right[1]) <= epsilon &&
    Math.abs(left[2] - right[2]) <= epsilon
  );
}
