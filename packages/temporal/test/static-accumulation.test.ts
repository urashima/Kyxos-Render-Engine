import { describe, expect, it } from 'vitest';

import {
  STATIC_ACCUMULATION_REFERENCE_CASES,
  STATIC_ACCUMULATION_REFERENCE_OUTPUT_FIELDS,
  TEMPORAL_SAMPLE_LIMIT,
  accumulateStaticSample,
  evaluateDeterministicStaticAccumulationReference,
} from '../src/index.js';

describe('static accumulation reference', () => {
  it('restarts invalid History from the current linear-HDR sample', () => {
    expect(
      accumulateStaticSample({
        accumulatedColor: [100, 50, 25, 0],
        accumulatedSampleCount: 17,
        currentColor: [0.25, 0.5, 1, 0.75],
        historyValid: false,
      }),
    ).toEqual({
      currentWeight: 1,
      historyAccepted: false,
      historyWeight: 0,
      maximumChannelDelta: null,
      outputColor: [0.25, 0.5, 1, 0.75],
      sampleCount: 1,
    });
  });

  it('adds one sample through an exact arithmetic running mean', () => {
    expect(
      accumulateStaticSample({
        accumulatedColor: [0.5, 1, 2, 0.5],
        accumulatedSampleCount: 3,
        currentColor: [1.5, 0.5, 1, 1],
        historyValid: true,
      }),
    ).toEqual({
      currentWeight: 0.25,
      historyAccepted: true,
      historyWeight: 0.75,
      maximumChannelDelta: 1,
      outputColor: [0.75, 0.875, 1.75, 0.625],
      sampleCount: 4,
    });
  });

  it('supports the final sample without allowing the count to exceed the global limit', () => {
    const final = accumulateStaticSample({
      accumulatedColor: [1, 1, 1, 1],
      accumulatedSampleCount: TEMPORAL_SAMPLE_LIMIT.maximum - 1,
      currentColor: [1, 1, 1, 1],
      historyValid: true,
    });
    expect(final).toMatchObject({
      currentWeight: 1 / TEMPORAL_SAMPLE_LIMIT.maximum,
      historyWeight: (TEMPORAL_SAMPLE_LIMIT.maximum - 1) / TEMPORAL_SAMPLE_LIMIT.maximum,
      maximumChannelDelta: 0,
      outputColor: [1, 1, 1, 1],
      sampleCount: TEMPORAL_SAMPLE_LIMIT.maximum,
    });
    expect(() =>
      accumulateStaticSample({
        accumulatedColor: [1, 1, 1, 1],
        accumulatedSampleCount: TEMPORAL_SAMPLE_LIMIT.maximum,
        currentColor: [1, 1, 1, 1],
        historyValid: true,
      }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  });

  it('freezes one deterministic CPU/WGSL reference vector', () => {
    const reference = evaluateDeterministicStaticAccumulationReference();
    expect(STATIC_ACCUMULATION_REFERENCE_CASES.map(({ id }) => id)).toEqual([
      'first-sample',
      'running-mean',
    ]);
    expect(STATIC_ACCUMULATION_REFERENCE_OUTPUT_FIELDS).toHaveLength(8);
    expect(reference.cases.map(({ result }) => result)).toEqual([
      {
        currentWeight: 1,
        historyAccepted: false,
        historyWeight: 0,
        maximumChannelDelta: null,
        outputColor: [0.25, 0.5, 1, 0.75],
        sampleCount: 1,
      },
      {
        currentWeight: 0.25,
        historyAccepted: true,
        historyWeight: 0.75,
        maximumChannelDelta: 1,
        outputColor: [0.75, 0.875, 1.75, 0.625],
        sampleCount: 4,
      },
    ]);
    expect(reference.values).toEqual([
      0.25, 0.5, 1, 0.75, 1, 0, 1, -1, 0.75, 0.875, 1.75, 0.625, 4, 0.75, 0.25, 1,
    ]);
    expect(Object.isFrozen(reference)).toBe(true);
    expect(Object.isFrozen(reference.cases)).toBe(true);
    expect(Object.isFrozen(reference.values)).toBe(true);
  });

  it('fails closed for inconsistent History and invalid channel data', () => {
    expect(() =>
      accumulateStaticSample({
        accumulatedColor: [0, 0, 0, 1],
        accumulatedSampleCount: 0,
        currentColor: [0, 0, 0, 1],
        historyValid: true,
      }),
    ).toThrow('at least one prior sample');
    expect(() =>
      accumulateStaticSample({
        accumulatedColor: [0, 0, 0, 1],
        accumulatedSampleCount: 0,
        currentColor: [-1, 0, 0, 1],
        historyValid: false,
      }),
    ).toThrow('non-negative');
    expect(() =>
      accumulateStaticSample({
        accumulatedColor: [0, 0, 0, 1],
        accumulatedSampleCount: 0,
        currentColor: [0, 0, 0, 2],
        historyValid: false,
      }),
    ).toThrow('0 through 1');
    expect(() =>
      accumulateStaticSample({
        accumulatedColor: [0, 0, 0, 1],
        accumulatedSampleCount: Number.NaN,
        currentColor: [0, 0, 0, 1],
        historyValid: false,
      }),
    ).toThrow('safe integer');
  });
});
