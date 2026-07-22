import { identityMat4, multiplyMat4, translationMat4 } from '@kyxos/render-math';
import { describe, expect, it } from 'vitest';

import {
  CAMERA_REPROJECTION_REASON_CODES,
  CAMERA_REPROJECTION_REFERENCE_CASES,
  CAMERA_REPROJECTION_REFERENCE_OUTPUT_FIELDS,
  PerspectiveCamera,
  TemporalCameraMatrixTracker,
  evaluateDeterministicCameraReprojectionReference,
  reprojectCameraMotion,
} from '../src/index.js';
import type { Mat4 } from '@kyxos/render-math';

const identity = identityMat4();

describe('Camera-motion reprojection', () => {
  it('reconstructs stationary History UV and freezes Current-minus-History motion', () => {
    const result = reprojectCameraMotion({
      currentDepth: 0.4,
      currentInverseViewProjection: identity,
      currentUv: [0.25, 0.75],
      previousViewProjection: identity,
    });

    expect(result).toMatchObject({
      currentUv: [0.25, 0.75],
      historyUv: [0.25, 0.75],
      invalidReason: null,
      motionUv: [0, 0],
      previousDepth: expect.closeTo(0.4, 6),
      valid: true,
      worldPosition: [-0.5, -0.5, expect.closeTo(0.4, 6)],
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.historyUv)).toBe(true);
  });

  it('uses the inverse Current and Previous jittered matrices retained by the Camera tracker', () => {
    const camera = new PerspectiveCamera({ position: [0, 0, 5], target: [0, 0, 0] });
    const tracker = new TemporalCameraMatrixTracker({ camera });
    const first = tracker.update({ historyGeneration: 1, viewport: { height: 600, width: 800 } });
    const identityProduct = multiplyMat4(
      first.currentViewProjection,
      first.currentInverseViewProjection,
    );
    identity.forEach((expected, index) => {
      expect(identityProduct[index]).toBeCloseTo(expected, 11);
    });

    camera.setPose({ position: [0.4, 0.15, 5], target: [0, 0, 0] });
    const second = tracker.update({ historyGeneration: 1, viewport: { height: 600, width: 800 } });
    const result = reprojectCameraMotion({
      currentDepth: 0.98,
      currentInverseViewProjection: second.currentInverseViewProjection,
      currentUv: [0.43, 0.58],
      previousViewProjection: second.previousViewProjection,
    });

    expect(result.valid).toBe(true);
    expect(result.motionUv).not.toEqual([0, 0]);
    expect(result.historyUv[0]).toBeCloseTo(result.currentUv[0] - result.motionUv[0], 7);
    expect(result.historyUv[1]).toBeCloseTo(result.currentUv[1] - result.motionUv[1], 7);
    tracker.dispose();
    camera.dispose();
  });

  it('fails closed for background, out-of-bounds UV, projection depth, and clip W', () => {
    const base = {
      currentDepth: 0.4,
      currentInverseViewProjection: identity,
      currentUv: [0.5, 0.5] as const,
      previousViewProjection: identity,
    };
    expect(reprojectCameraMotion({ ...base, currentDepth: 1 })).toMatchObject({
      invalidReason: 'background-depth',
      valid: false,
    });
    expect(reprojectCameraMotion({ ...base, currentUv: [-0.01, 0.5] })).toMatchObject({
      invalidReason: 'current-uv-out-of-bounds',
      valid: false,
    });
    expect(
      reprojectCameraMotion({ ...base, previousViewProjection: translationMat4([0, 0, 2]) }),
    ).toMatchObject({ invalidReason: 'previous-depth-out-of-bounds', valid: false });
    expect(
      reprojectCameraMotion({ ...base, previousViewProjection: translationMat4([2, 0, 0]) }),
    ).toMatchObject({ invalidReason: 'previous-uv-out-of-bounds', valid: false });

    const zeroW = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0]) as Mat4;
    const negativeW = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1]) as Mat4;
    expect(reprojectCameraMotion({ ...base, currentInverseViewProjection: zeroW })).toMatchObject({
      invalidReason: 'current-world-invalid',
      valid: false,
    });
    expect(reprojectCameraMotion({ ...base, previousViewProjection: negativeW })).toMatchObject({
      invalidReason: 'previous-behind-camera',
      valid: false,
    });
  });

  it('freezes deterministic stationary, camera-motion, UV-rejected, and background branches', () => {
    const reference = evaluateDeterministicCameraReprojectionReference();

    expect(reference.cases.map(({ id }) => id)).toEqual([
      'stationary',
      'camera-motion',
      'uv-rejected',
      'background-depth',
    ]);
    expect(reference.cases.map(({ result }) => result.invalidReason)).toEqual([
      null,
      null,
      'previous-uv-out-of-bounds',
      'background-depth',
    ]);
    expect(reference.values).toHaveLength(
      CAMERA_REPROJECTION_REFERENCE_OUTPUT_FIELDS.length *
        CAMERA_REPROJECTION_REFERENCE_CASES.length,
    );
    expect(reference.values[CAMERA_REPROJECTION_REFERENCE_OUTPUT_FIELDS.length + 12]).toBe(1);
    expect(reference.values[CAMERA_REPROJECTION_REFERENCE_OUTPUT_FIELDS.length * 2 + 13]).toBe(
      CAMERA_REPROJECTION_REASON_CODES['previous-uv-out-of-bounds'],
    );
    expect(Object.isFrozen(reference.cases)).toBe(true);
    expect(Object.isFrozen(reference.values)).toBe(true);
  });

  it('rejects malformed public input instead of producing non-finite reprojection data', () => {
    const base = {
      currentDepth: 0.4,
      currentInverseViewProjection: identity,
      currentUv: [0.5, 0.5] as const,
      previousViewProjection: identity,
    };
    expect(() => reprojectCameraMotion({ ...base, currentDepth: Number.NaN })).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    );
    expect(() => reprojectCameraMotion({ ...base, currentDepth: 1.01 })).toThrow(
      'from 0 through 1',
    );
    expect(() =>
      reprojectCameraMotion({
        ...base,
        previousViewProjection: Object.freeze([
          Number.NaN,
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
          0,
          0,
          0,
          1,
        ]) as Mat4,
      }),
    ).toThrow('must be finite');
  });
});
