import { describe, expect, it } from 'vitest';

import {
  StaticAccumulationGpuHistory,
  StaticAccumulationPass,
  accumulateStaticSample,
  evaluateDeterministicStaticAccumulationReference,
  packStaticAccumulationUniforms,
} from '../src/static-accumulation.js';

describe('SDK static accumulation entry', () => {
  it('exposes deterministic CPU and GPU composition contracts', () => {
    expect(StaticAccumulationGpuHistory).toBeTypeOf('function');
    expect(StaticAccumulationPass).toBeTypeOf('function');
    expect(packStaticAccumulationUniforms).toBeTypeOf('function');

    const first = accumulateStaticSample({
      currentColor: [1, 0.5, 0.25, 1],
      accumulatedColor: [0, 0, 0, 0],
      historyValid: false,
      accumulatedSampleCount: 0,
    });

    expect(first).toMatchObject({
      currentWeight: 1,
      historyWeight: 0,
      outputColor: [1, 0.5, 0.25, 1],
      sampleCount: 1,
    });
    expect(evaluateDeterministicStaticAccumulationReference().values).toHaveLength(16);
  });
});
