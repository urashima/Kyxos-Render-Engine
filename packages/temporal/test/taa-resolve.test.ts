import { describe, expect, it } from 'vitest';

import {
  TEMPORAL_TAA_DEFAULT_OPTIONS,
  TEMPORAL_TAA_REFERENCE_CASES,
  TEMPORAL_TAA_REFERENCE_OUTPUT_FIELDS,
  evaluateDeterministicTemporalTaaReference,
  resolveTemporalTaa,
} from '../src/index.js';
import type { TemporalTaaNeighborhood } from '../src/index.js';

const accepted = TEMPORAL_TAA_REFERENCE_CASES[0];
const depthRejected = TEMPORAL_TAA_REFERENCE_CASES[1];
const normalRejected = TEMPORAL_TAA_REFERENCE_CASES[2];

describe('Dynamic TAA resolve reference', () => {
  it('clamps reprojected History to the current 3x3 neighborhood before responsive blending', () => {
    const result = resolveTemporalTaa(accepted.input);

    expect(result).toMatchObject({
      clampedHistoryColor: [0.4, 0.1, 0.55],
      historyWeight: 0.54,
      neighborhoodMaximum: [0.4, 0.5, 0.55],
      neighborhoodMinimum: [0.05, 0.1, 0.1],
      rejected: false,
      rejectionReason: null,
    });
    expect(result.depthDifference).toBeCloseTo(0.003, 15);
    expect(result.depthTolerance).toBeCloseTo(0.00403, 15);
    expect(result.normalSimilarity).toBeCloseTo(0.9798040587804069, 15);
    expect(result.outputColor).toEqual([0.331, 0.21499999999999997, 0.504, 0.8]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.outputColor)).toBe(true);
  });

  it('rejects disoccluded Depth before sampling clamped History', () => {
    const result = resolveTemporalTaa(depthRejected.input);

    expect(result).toMatchObject({
      historyWeight: 0,
      outputColor: depthRejected.input.currentColor,
      rejected: true,
      rejectionReason: 'depth',
    });
    expect(result.depthDifference).toBeCloseTo(0.05, 15);
    expect(result.depthTolerance).toBeCloseTo(0.0045, 15);
  });

  it('rejects incompatible Normals and invalid History fail closed', () => {
    expect(resolveTemporalTaa(normalRejected.input)).toMatchObject({
      historyWeight: 0,
      normalSimilarity: 0,
      rejected: true,
      rejectionReason: 'normal',
    });
    expect(resolveTemporalTaa({ ...accepted.input, historyValid: false })).toMatchObject({
      historyWeight: 0,
      rejected: true,
      rejectionReason: 'history-invalid',
    });
  });

  it('reduces accepted History weight monotonically with the responsive mask', () => {
    const zero = resolveTemporalTaa({ ...accepted.input, responsiveMask: 0 });
    const half = resolveTemporalTaa(accepted.input);
    const full = resolveTemporalTaa({ ...accepted.input, responsiveMask: 1 });

    expect(zero.historyWeight).toBe(TEMPORAL_TAA_DEFAULT_OPTIONS.baseHistoryWeight);
    expect(half.historyWeight).toBe(0.54);
    expect(full.historyWeight).toBeCloseTo(0.18, 15);
    expect(zero.historyWeight).toBeGreaterThan(half.historyWeight);
    expect(half.historyWeight).toBeGreaterThan(full.historyWeight);
  });

  it('freezes three deterministic branch cases into the exact WGSL output layout', () => {
    const reference = evaluateDeterministicTemporalTaaReference();

    expect(reference.cases.map(({ id }) => id)).toEqual([
      'accepted',
      'depth-rejected',
      'normal-rejected',
    ]);
    expect(reference.values).toHaveLength(TEMPORAL_TAA_REFERENCE_OUTPUT_FIELDS.length * 3);
    expect(reference.cases.map(({ result }) => result.rejected)).toEqual([false, true, true]);
    expect(Object.isFrozen(reference.cases)).toBe(true);
    expect(Object.isFrozen(reference.values)).toBe(true);
  });

  it('rejects non-finite, out-of-range, zero-Normal, and malformed neighborhood input', () => {
    expect(() => resolveTemporalTaa({ ...accepted.input, currentDepth: Number.NaN })).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    );
    expect(() => resolveTemporalTaa({ ...accepted.input, currentNormal: [0, 0, 0] })).toThrow(
      'must be non-zero',
    );
    expect(() => resolveTemporalTaa({ ...accepted.input, responsiveMask: 1.01 })).toThrow(
      'from 0 through 1',
    );
    expect(() =>
      resolveTemporalTaa({
        ...accepted.input,
        neighborhood: accepted.input.neighborhood.slice(0, 8) as unknown as TemporalTaaNeighborhood,
      }),
    ).toThrow('exactly nine');
    expect(() => resolveTemporalTaa(accepted.input, { normalRejectionCosine: 2 })).toThrow(
      'from -1 through 1',
    );
  });
});
