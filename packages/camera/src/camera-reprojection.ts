import { KyxosEngineError } from '@kyxos/render-core';
import {
  identityMat4,
  inverseMat4,
  lookAtMat4,
  multiplyMat4,
  perspectiveMat4,
  translationMat4,
} from '@kyxos/render-math';

import type { Mat4, Vec3 } from '@kyxos/render-math';

export type CameraReprojectionVec2 = readonly [x: number, y: number];
export type CameraReprojectionVec3 = readonly [x: number, y: number, z: number];

export type CameraReprojectionInvalidReason =
  | 'background-depth'
  | 'current-uv-out-of-bounds'
  | 'current-world-invalid'
  | 'previous-behind-camera'
  | 'previous-depth-out-of-bounds'
  | 'previous-projection-invalid'
  | 'previous-uv-out-of-bounds';

export interface CameraMotionReprojectionInput {
  /** Current frame raster UV with a top-left origin. */
  readonly currentUv: CameraReprojectionVec2;
  /** Current WebGPU depth in the canonical zero-to-one range. */
  readonly currentDepth: number;
  readonly currentInverseViewProjection: Mat4;
  readonly previousViewProjection: Mat4;
}

export interface CameraMotionReprojectionResult {
  readonly currentDepth: number;
  readonly currentUv: CameraReprojectionVec2;
  /** Coordinate at which the previous History frame would be sampled. */
  readonly historyUv: CameraReprojectionVec2;
  readonly invalidReason: CameraReprojectionInvalidReason | null;
  /** Current UV minus History UV, so History UV = Current UV - Motion UV. */
  readonly motionUv: CameraReprojectionVec2;
  readonly previousClipW: number;
  readonly previousDepth: number;
  readonly previousNdc: CameraReprojectionVec3;
  readonly valid: boolean;
  readonly worldPosition: CameraReprojectionVec3;
}

export interface CameraReprojectionReferenceCase {
  readonly id: 'background-depth' | 'camera-motion' | 'stationary' | 'uv-rejected';
  readonly input: CameraMotionReprojectionInput;
}

export interface DeterministicCameraReprojectionReference {
  readonly cases: readonly {
    readonly id: CameraReprojectionReferenceCase['id'];
    readonly result: CameraMotionReprojectionResult;
  }[];
  readonly values: readonly number[];
}

export const CAMERA_REPROJECTION_HOMOGENEOUS_EPSILON = 0.000001;

export const CAMERA_REPROJECTION_REASON_CODES = Object.freeze({
  valid: 0,
  'current-uv-out-of-bounds': 1,
  'background-depth': 2,
  'current-world-invalid': 3,
  'previous-behind-camera': 4,
  'previous-depth-out-of-bounds': 5,
  'previous-uv-out-of-bounds': 6,
  'previous-projection-invalid': 7,
}) satisfies Readonly<Record<CameraReprojectionInvalidReason | 'valid', number>>;

export const CAMERA_REPROJECTION_REFERENCE_OUTPUT_FIELDS = Object.freeze([
  'history-u',
  'history-v',
  'motion-u',
  'motion-v',
  'world-x',
  'world-y',
  'world-z',
  'current-depth',
  'previous-ndc-x',
  'previous-ndc-y',
  'previous-depth',
  'previous-clip-w',
  'valid-mask',
  'reason-code',
  'current-u',
  'current-v',
] as const);

type MutableVec4 = [number, number, number, number];

interface InvalidState {
  readonly historyUv?: CameraReprojectionVec2;
  readonly motionUv?: CameraReprojectionVec2;
  readonly previousClipW?: number;
  readonly previousNdc?: CameraReprojectionVec3;
  readonly worldPosition?: CameraReprojectionVec3;
}

const ZERO_VEC2 = Object.freeze([0, 0]) as CameraReprojectionVec2;
const ZERO_VEC3 = Object.freeze([0, 0, 0]) as CameraReprojectionVec3;

function invalidArgument(message: string): never {
  throw new KyxosEngineError(message, {
    code: 'INVALID_ARGUMENT',
    module: 'camera',
    recoverable: false,
  });
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) invalidArgument(`${label} must be finite.`);
  return Math.fround(value);
}

function canonicalDepth(value: number): number {
  if (!Number.isFinite(value)) invalidArgument('Camera reprojection current Depth must be finite.');
  if (value < 0 || value > 1) {
    invalidArgument('Camera reprojection current Depth must be from 0 through 1.');
  }
  return Math.fround(value);
}

function rasterUv(value: readonly number[]): CameraReprojectionVec2 {
  if (value.length !== 2)
    invalidArgument('Camera reprojection current UV must contain two values.');
  return Object.freeze([
    finite(value[0] as number, 'Camera reprojection current UV x'),
    finite(value[1] as number, 'Camera reprojection current UV y'),
  ]);
}

function finiteMatrix(value: Mat4, label: string): void {
  if (value.length !== 16) invalidArgument(`${label} must contain sixteen values.`);
  for (let index = 0; index < 16; index += 1) {
    finite(value[index] as number, `${label}[${index}]`);
  }
}

function multiplyMatrixVectorF32(matrix: Mat4, vector: MutableVec4): MutableVec4 {
  const result: MutableVec4 = [0, 0, 0, 0];
  for (let row = 0; row < 4; row += 1) {
    let value = Math.fround(0);
    for (let column = 0; column < 4; column += 1) {
      const product = Math.fround(
        Math.fround(matrix[column * 4 + row] as number) * Math.fround(vector[column] as number),
      );
      value = Math.fround(value + product);
    }
    result[row] = value;
  }
  return result;
}

function finiteVector(value: readonly number[]): boolean {
  return value.every(Number.isFinite);
}

function inUnitSquare(uv: CameraReprojectionVec2): boolean {
  return uv[0] >= 0 && uv[0] <= 1 && uv[1] >= 0 && uv[1] <= 1;
}

function frozenVec2(x: number, y: number): CameraReprojectionVec2 {
  return Object.freeze([Math.fround(x), Math.fround(y)]);
}

function frozenVec3(x: number, y: number, z: number): CameraReprojectionVec3 {
  return Object.freeze([Math.fround(x), Math.fround(y), Math.fround(z)]);
}

function invalidResult(
  reason: CameraReprojectionInvalidReason,
  currentUv: CameraReprojectionVec2,
  currentDepth: number,
  state: InvalidState = {},
): CameraMotionReprojectionResult {
  const previousNdc = state.previousNdc ?? ZERO_VEC3;
  return Object.freeze({
    currentDepth,
    currentUv,
    historyUv: state.historyUv ?? currentUv,
    invalidReason: reason,
    motionUv: state.motionUv ?? ZERO_VEC2,
    previousClipW: state.previousClipW ?? 0,
    previousDepth: previousNdc[2],
    previousNdc,
    valid: false,
    worldPosition: state.worldPosition ?? ZERO_VEC3,
  });
}

/**
 * Reprojects one current raster coordinate through reconstructed World space into previous History.
 * The calculation intentionally uses float32 operations to match the WGSL contract.
 */
export function reprojectCameraMotion(
  input: CameraMotionReprojectionInput,
): CameraMotionReprojectionResult {
  const currentUv = rasterUv(input.currentUv);
  const currentDepth = canonicalDepth(input.currentDepth);
  finiteMatrix(input.currentInverseViewProjection, 'Camera reprojection current inverse Matrix');
  finiteMatrix(input.previousViewProjection, 'Camera reprojection previous Matrix');

  if (!inUnitSquare(currentUv)) {
    return invalidResult('current-uv-out-of-bounds', currentUv, currentDepth);
  }
  if (currentDepth >= 1) {
    return invalidResult('background-depth', currentUv, currentDepth);
  }

  const currentClip: MutableVec4 = [
    Math.fround(Math.fround(currentUv[0] * 2) - 1),
    Math.fround(1 - Math.fround(currentUv[1] * 2)),
    currentDepth,
    1,
  ];
  const worldHomogeneous = multiplyMatrixVectorF32(input.currentInverseViewProjection, currentClip);
  const worldW = worldHomogeneous[3];
  if (
    !finiteVector(worldHomogeneous) ||
    Math.abs(worldW) <= CAMERA_REPROJECTION_HOMOGENEOUS_EPSILON
  ) {
    return invalidResult('current-world-invalid', currentUv, currentDepth);
  }
  const worldPosition = frozenVec3(
    Math.fround(worldHomogeneous[0] / worldW),
    Math.fround(worldHomogeneous[1] / worldW),
    Math.fround(worldHomogeneous[2] / worldW),
  );
  const previousClip = multiplyMatrixVectorF32(input.previousViewProjection, [
    worldPosition[0],
    worldPosition[1],
    worldPosition[2],
    1,
  ]);
  const previousClipW = previousClip[3];
  const baseState = { previousClipW, worldPosition } as const;
  if (!finiteVector(previousClip)) {
    return invalidResult('previous-projection-invalid', currentUv, currentDepth, baseState);
  }
  if (previousClipW <= CAMERA_REPROJECTION_HOMOGENEOUS_EPSILON) {
    return invalidResult('previous-behind-camera', currentUv, currentDepth, baseState);
  }

  const previousNdc = frozenVec3(
    Math.fround(previousClip[0] / previousClipW),
    Math.fround(previousClip[1] / previousClipW),
    Math.fround(previousClip[2] / previousClipW),
  );
  const historyUv = frozenVec2(
    Math.fround(Math.fround(previousNdc[0] + 1) * 0.5),
    Math.fround(Math.fround(1 - previousNdc[1]) * 0.5),
  );
  const motionUv = frozenVec2(
    Math.fround(currentUv[0] - historyUv[0]),
    Math.fround(currentUv[1] - historyUv[1]),
  );
  const projectedState = {
    historyUv,
    motionUv,
    previousClipW,
    previousNdc,
    worldPosition,
  } as const;
  if (previousNdc[2] < 0 || previousNdc[2] > 1) {
    return invalidResult('previous-depth-out-of-bounds', currentUv, currentDepth, projectedState);
  }
  if (!inUnitSquare(historyUv)) {
    return invalidResult('previous-uv-out-of-bounds', currentUv, currentDepth, projectedState);
  }

  return Object.freeze({
    currentDepth,
    currentUv,
    historyUv,
    invalidReason: null,
    motionUv,
    previousClipW,
    previousDepth: previousNdc[2],
    previousNdc,
    valid: true,
    worldPosition,
  });
}

function referenceViewProjection(eye: Vec3, jitterNdc: Vec3): Mat4 {
  const projection = perspectiveMat4(Math.PI / 3, 1.5, 0.1, 100);
  const jitteredProjection = multiplyMat4(translationMat4(jitterNdc), projection);
  return multiplyMat4(jitteredProjection, lookAtMat4(eye, [0, 0, 0], [0, 1, 0]));
}

const REFERENCE_CURRENT_VIEW_PROJECTION = referenceViewProjection(
  [0.4, 0.15, 5],
  [0.003, -0.002, 0],
);
const REFERENCE_PREVIOUS_VIEW_PROJECTION = referenceViewProjection([0, 0, 5], [-0.002, 0.001, 0]);
const IDENTITY_MATRIX = identityMat4();

export const CAMERA_REPROJECTION_REFERENCE_CASES: readonly [
  CameraReprojectionReferenceCase,
  CameraReprojectionReferenceCase,
  CameraReprojectionReferenceCase,
  CameraReprojectionReferenceCase,
] = Object.freeze([
  Object.freeze({
    id: 'stationary',
    input: Object.freeze({
      currentDepth: 0.4,
      currentInverseViewProjection: IDENTITY_MATRIX,
      currentUv: frozenVec2(0.25, 0.75),
      previousViewProjection: IDENTITY_MATRIX,
    }),
  }),
  Object.freeze({
    id: 'camera-motion',
    input: Object.freeze({
      currentDepth: 0.98,
      currentInverseViewProjection: inverseMat4(REFERENCE_CURRENT_VIEW_PROJECTION),
      currentUv: frozenVec2(0.43, 0.58),
      previousViewProjection: REFERENCE_PREVIOUS_VIEW_PROJECTION,
    }),
  }),
  Object.freeze({
    id: 'uv-rejected',
    input: Object.freeze({
      currentDepth: 0.4,
      currentInverseViewProjection: IDENTITY_MATRIX,
      currentUv: frozenVec2(0.75, 0.5),
      previousViewProjection: translationMat4([2, 0, 0]),
    }),
  }),
  Object.freeze({
    id: 'background-depth',
    input: Object.freeze({
      currentDepth: 1,
      currentInverseViewProjection: IDENTITY_MATRIX,
      currentUv: frozenVec2(0.5, 0.5),
      previousViewProjection: IDENTITY_MATRIX,
    }),
  }),
]);

function encodeReferenceResult(result: CameraMotionReprojectionResult): readonly number[] {
  const reasonCode = CAMERA_REPROJECTION_REASON_CODES[result.invalidReason ?? 'valid'];
  return Object.freeze([
    ...result.historyUv,
    ...result.motionUv,
    ...result.worldPosition,
    result.currentDepth,
    ...result.previousNdc,
    result.previousClipW,
    result.valid ? 1 : 0,
    reasonCode,
    ...result.currentUv,
  ]);
}

export function evaluateDeterministicCameraReprojectionReference(): DeterministicCameraReprojectionReference {
  const cases = Object.freeze(
    CAMERA_REPROJECTION_REFERENCE_CASES.map(({ id, input }) =>
      Object.freeze({ id, result: reprojectCameraMotion(input) }),
    ),
  );
  return Object.freeze({
    cases,
    values: Object.freeze(cases.flatMap(({ result }) => encodeReferenceResult(result))),
  });
}
