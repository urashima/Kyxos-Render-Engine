import type { Mat4, Quaternion, Vec3 } from './types.js';

export const NORMALIZATION_EPSILON = 1e-12;

export function assertFiniteNumber(name: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be finite; received ${String(value)}.`);
  }
}

export function assertNonNegativeFiniteNumber(name: string, value: number): void {
  assertFiniteNumber(name, value);
  if (value < 0) throw new RangeError(`${name} must be non-negative; received ${value}.`);
}

export function assertVec3(name: string, value: Vec3): void {
  assertFiniteNumber(`${name}.x`, value[0]);
  assertFiniteNumber(`${name}.y`, value[1]);
  assertFiniteNumber(`${name}.z`, value[2]);
}

export function assertQuaternion(name: string, value: Quaternion): void {
  assertFiniteNumber(`${name}.x`, value[0]);
  assertFiniteNumber(`${name}.y`, value[1]);
  assertFiniteNumber(`${name}.z`, value[2]);
  assertFiniteNumber(`${name}.w`, value[3]);
}

export function assertMat4(name: string, value: Mat4): void {
  for (let index = 0; index < 16; index += 1) {
    assertFiniteNumber(`${name}[${index}]`, value[index] as number);
  }
}
