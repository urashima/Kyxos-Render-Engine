import { TEMPORAL_TAA_DEFAULT_OPTIONS } from '@kyxos/render-temporal';
import { describe, expect, it } from 'vitest';

import { TEMPORAL_TAA_DEFAULT_SETTINGS, createTemporalTaaSettings } from '../src/index.js';

describe('Temporal TAA settings', () => {
  it('preserves the accepted defaults in an immutable public state', () => {
    expect(TEMPORAL_TAA_DEFAULT_SETTINGS).toEqual({
      jitterScale: 1,
      resolve: {
        ...TEMPORAL_TAA_DEFAULT_OPTIONS,
        edgeDepthDifference: 0,
        flickerReduction: 0,
        maxVelocityLength: 128,
        minimumCurrentWeight: 0,
        subpixelCorrection: 0,
        varianceClipGamma: 0,
      },
      responsiveMask: 0,
    });
    expect(Object.isFrozen(TEMPORAL_TAA_DEFAULT_SETTINGS)).toBe(true);
    expect(Object.isFrozen(TEMPORAL_TAA_DEFAULT_SETTINGS.resolve)).toBe(true);
  });

  it('updates one tuning field without disturbing the remaining state', () => {
    const stable = createTemporalTaaSettings({
      baseHistoryWeight: 0.94,
      depthAbsoluteThreshold: 0.002,
      depthRelativeThreshold: 0.02,
      jitterScale: 0.35,
      normalRejectionCosine: 0.8,
      responsiveHistoryReduction: 0.75,
      responsiveMask: 0.1,
    });
    const changed = createTemporalTaaSettings({ jitterScale: 0 }, stable);
    expect(changed).toEqual({
      jitterScale: 0,
      resolve: {
        baseHistoryWeight: 0.94,
        depthAbsoluteThreshold: 0.002,
        depthRelativeThreshold: 0.02,
        normalRejectionCosine: 0.8,
        responsiveHistoryReduction: 0.75,
        edgeDepthDifference: 0,
        flickerReduction: 0,
        maxVelocityLength: 128,
        minimumCurrentWeight: 0,
        subpixelCorrection: 0,
        varianceClipGamma: 0,
      },
      responsiveMask: 0.1,
    });
  });

  it('rejects non-finite and out-of-range tuning values', () => {
    expect(() => createTemporalTaaSettings({ jitterScale: -0.01 })).toThrow('jitter scale');
    expect(() => createTemporalTaaSettings({ baseHistoryWeight: 1.01 })).toThrow('History weight');
    expect(() => createTemporalTaaSettings({ normalRejectionCosine: -1.01 })).toThrow(
      'Normal rejection cosine',
    );
    expect(() => createTemporalTaaSettings({ maxVelocityLength: 0 })).toThrow(
      'maximum Velocity length',
    );
    expect(() => createTemporalTaaSettings({ varianceClipGamma: -0.01 })).toThrow(
      'variance clip gamma',
    );
    expect(() => createTemporalTaaSettings({ responsiveMask: Number.NaN })).toThrow(
      'responsive mask',
    );
  });
});
