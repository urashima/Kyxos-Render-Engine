import { createVec3, crossVec3, dotVec3, normalizeVec3, subtractVec3 } from './vec3.js';
import { normalizeQuaternion } from './quaternion.js';
import { NORMALIZATION_EPSILON, assertFiniteNumber, assertMat4, assertVec3 } from './validation.js';

import type { Mat4, Quaternion, Vec3 } from './types.js';

function immutableMat4(values: readonly number[]): Mat4 {
  if (values.length !== 16)
    throw new RangeError(`Mat4 requires 16 values; received ${values.length}.`);
  for (let index = 0; index < 16; index += 1) {
    assertFiniteNumber(`matrix[${index}]`, values[index] as number);
  }
  return Object.freeze([...values]) as unknown as Mat4;
}

export function identityMat4(): Mat4 {
  return immutableMat4([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

export function multiplyMat4(left: Mat4, right: Mat4): Mat4 {
  assertMat4('left', left);
  assertMat4('right', right);
  const result = new Array<number>(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let value = 0;
      for (let inner = 0; inner < 4; inner += 1) {
        value += (left[inner * 4 + row] as number) * (right[column * 4 + inner] as number);
      }
      result[column * 4 + row] = value;
    }
  }
  return immutableMat4(result);
}

/** Returns the general inverse of a finite 4x4 Matrix. */
export function inverseMat4(matrix: Mat4): Mat4 {
  assertMat4('matrix', matrix);
  const a00 = matrix[0];
  const a01 = matrix[1];
  const a02 = matrix[2];
  const a03 = matrix[3];
  const a10 = matrix[4];
  const a11 = matrix[5];
  const a12 = matrix[6];
  const a13 = matrix[7];
  const a20 = matrix[8];
  const a21 = matrix[9];
  const a22 = matrix[10];
  const a23 = matrix[11];
  const a30 = matrix[12];
  const a31 = matrix[13];
  const a32 = matrix[14];
  const a33 = matrix[15];

  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;
  const determinant = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (Math.abs(determinant) <= NORMALIZATION_EPSILON) {
    throw new RangeError('Matrix inverse requires an invertible Matrix.');
  }
  const inverseDeterminant = 1 / determinant;

  return immutableMat4([
    (a11 * b11 - a12 * b10 + a13 * b09) * inverseDeterminant,
    (a02 * b10 - a01 * b11 - a03 * b09) * inverseDeterminant,
    (a31 * b05 - a32 * b04 + a33 * b03) * inverseDeterminant,
    (a22 * b04 - a21 * b05 - a23 * b03) * inverseDeterminant,
    (a12 * b08 - a10 * b11 - a13 * b07) * inverseDeterminant,
    (a00 * b11 - a02 * b08 + a03 * b07) * inverseDeterminant,
    (a32 * b02 - a30 * b05 - a33 * b01) * inverseDeterminant,
    (a20 * b05 - a22 * b02 + a23 * b01) * inverseDeterminant,
    (a10 * b10 - a11 * b08 + a13 * b06) * inverseDeterminant,
    (a01 * b08 - a00 * b10 - a03 * b06) * inverseDeterminant,
    (a30 * b04 - a31 * b02 + a33 * b00) * inverseDeterminant,
    (a21 * b02 - a20 * b04 - a23 * b00) * inverseDeterminant,
    (a11 * b07 - a10 * b09 - a12 * b06) * inverseDeterminant,
    (a00 * b09 - a01 * b07 + a02 * b06) * inverseDeterminant,
    (a31 * b01 - a30 * b03 - a32 * b00) * inverseDeterminant,
    (a20 * b03 - a21 * b01 + a22 * b00) * inverseDeterminant,
  ]);
}

export function translationMat4(translation: Vec3): Mat4 {
  assertVec3('translation', translation);
  return immutableMat4([
    1,
    0,
    0,
    0,
    0,
    1,
    0,
    0,
    0,
    0,
    1,
    0,
    translation[0],
    translation[1],
    translation[2],
    1,
  ]);
}

export function scalingMat4(scale: Vec3): Mat4 {
  assertVec3('scale', scale);
  return immutableMat4([scale[0], 0, 0, 0, 0, scale[1], 0, 0, 0, 0, scale[2], 0, 0, 0, 0, 1]);
}

export function rotationMat4(rotation: Quaternion): Mat4 {
  const [x, y, z, w] = normalizeQuaternion(rotation);
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;
  return immutableMat4([
    1 - (yy + zz),
    xy + wz,
    xz - wy,
    0,
    xy - wz,
    1 - (xx + zz),
    yz + wx,
    0,
    xz + wy,
    yz - wx,
    1 - (xx + yy),
    0,
    0,
    0,
    0,
    1,
  ]);
}

export function composeTrsMat4(translation: Vec3, rotation: Quaternion, scale: Vec3): Mat4 {
  assertVec3('translation', translation);
  assertVec3('scale', scale);
  const matrix = rotationMat4(rotation);
  return immutableMat4([
    matrix[0] * scale[0],
    matrix[1] * scale[0],
    matrix[2] * scale[0],
    0,
    matrix[4] * scale[1],
    matrix[5] * scale[1],
    matrix[6] * scale[1],
    0,
    matrix[8] * scale[2],
    matrix[9] * scale[2],
    matrix[10] * scale[2],
    0,
    translation[0],
    translation[1],
    translation[2],
    1,
  ]);
}

export function transformPointMat4(matrix: Mat4, point: Vec3): Vec3 {
  assertMat4('matrix', matrix);
  assertVec3('point', point);
  const x = point[0];
  const y = point[1];
  const z = point[2];
  const resultX = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
  const resultY = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
  const resultZ = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14];
  const resultW = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
  if (Math.abs(resultW) <= NORMALIZATION_EPSILON) {
    throw new RangeError('Point transform produced a zero homogeneous W component.');
  }
  return createVec3(resultX / resultW, resultY / resultW, resultZ / resultW);
}

export function transformDirectionMat4(matrix: Mat4, direction: Vec3): Vec3 {
  assertMat4('matrix', matrix);
  assertVec3('direction', direction);
  return createVec3(
    matrix[0] * direction[0] + matrix[4] * direction[1] + matrix[8] * direction[2],
    matrix[1] * direction[0] + matrix[5] * direction[1] + matrix[9] * direction[2],
    matrix[2] * direction[0] + matrix[6] * direction[1] + matrix[10] * direction[2],
  );
}

export function extractTranslationMat4(matrix: Mat4): Vec3 {
  assertMat4('matrix', matrix);
  return createVec3(matrix[12], matrix[13], matrix[14]);
}

export function maxScaleOnAxisMat4(matrix: Mat4): number {
  assertMat4('matrix', matrix);
  const xScaleSquared = matrix[0] ** 2 + matrix[1] ** 2 + matrix[2] ** 2;
  const yScaleSquared = matrix[4] ** 2 + matrix[5] ** 2 + matrix[6] ** 2;
  const zScaleSquared = matrix[8] ** 2 + matrix[9] ** 2 + matrix[10] ** 2;
  const result = Math.sqrt(Math.max(xScaleSquared, yScaleSquared, zScaleSquared));
  assertFiniteNumber('maximum matrix scale', result);
  return result;
}

/** Returns the inverse-transpose of a Matrix's upper-left 3x3 for transforming normals. */
export function normalMatrixMat4(matrix: Mat4): Mat4 {
  assertMat4('matrix', matrix);
  const a00 = matrix[0];
  const a01 = matrix[4];
  const a02 = matrix[8];
  const a10 = matrix[1];
  const a11 = matrix[5];
  const a12 = matrix[9];
  const a20 = matrix[2];
  const a21 = matrix[6];
  const a22 = matrix[10];
  const determinant =
    a00 * (a11 * a22 - a12 * a21) - a01 * (a10 * a22 - a12 * a20) + a02 * (a10 * a21 - a11 * a20);
  if (Math.abs(determinant) <= NORMALIZATION_EPSILON) {
    throw new RangeError('Normal Matrix requires an invertible upper-left 3x3 Matrix.');
  }
  const inverseDeterminant = 1 / determinant;
  return immutableMat4([
    (a11 * a22 - a12 * a21) * inverseDeterminant,
    (a02 * a21 - a01 * a22) * inverseDeterminant,
    (a01 * a12 - a02 * a11) * inverseDeterminant,
    0,
    (a12 * a20 - a10 * a22) * inverseDeterminant,
    (a00 * a22 - a02 * a20) * inverseDeterminant,
    (a02 * a10 - a00 * a12) * inverseDeterminant,
    0,
    (a10 * a21 - a11 * a20) * inverseDeterminant,
    (a01 * a20 - a00 * a21) * inverseDeterminant,
    (a00 * a11 - a01 * a10) * inverseDeterminant,
    0,
    0,
    0,
    0,
    1,
  ]);
}

export function perspectiveMat4(
  verticalFieldOfViewRadians: number,
  aspect: number,
  near: number,
  far: number = Number.POSITIVE_INFINITY,
): Mat4 {
  assertFiniteNumber('verticalFieldOfViewRadians', verticalFieldOfViewRadians);
  assertFiniteNumber('aspect', aspect);
  assertFiniteNumber('near', near);
  if (verticalFieldOfViewRadians <= 0 || verticalFieldOfViewRadians >= Math.PI) {
    throw new RangeError('verticalFieldOfViewRadians must be between 0 and PI.');
  }
  if (aspect <= 0) throw new RangeError('aspect must be greater than zero.');
  if (near <= 0) throw new RangeError('near must be greater than zero.');
  if (!(far === Number.POSITIVE_INFINITY || Number.isFinite(far))) {
    throw new RangeError('far must be finite or positive infinity.');
  }
  if (far !== Number.POSITIVE_INFINITY && far <= near) {
    throw new RangeError('far must be greater than near.');
  }

  const focalLength = 1 / Math.tan(verticalFieldOfViewRadians / 2);
  const depthScale = far === Number.POSITIVE_INFINITY ? -1 : far / (near - far);
  const depthOffset = far === Number.POSITIVE_INFINITY ? -near : (far * near) / (near - far);
  return immutableMat4([
    focalLength / aspect,
    0,
    0,
    0,
    0,
    focalLength,
    0,
    0,
    0,
    0,
    depthScale,
    -1,
    0,
    0,
    depthOffset,
    0,
  ]);
}

export function lookAtMat4(eye: Vec3, target: Vec3, up: Vec3): Mat4 {
  assertVec3('eye', eye);
  assertVec3('target', target);
  assertVec3('up', up);
  const backward = normalizeVec3(subtractVec3(eye, target));
  let right: Vec3;
  try {
    right = normalizeVec3(crossVec3(up, backward));
  } catch {
    throw new RangeError('up must not be parallel to the camera direction.');
  }
  const correctedUp = crossVec3(backward, right);
  return immutableMat4([
    right[0],
    correctedUp[0],
    backward[0],
    0,
    right[1],
    correctedUp[1],
    backward[1],
    0,
    right[2],
    correctedUp[2],
    backward[2],
    0,
    -dotVec3(right, eye),
    -dotVec3(correctedUp, eye),
    -dotVec3(backward, eye),
    1,
  ]);
}
