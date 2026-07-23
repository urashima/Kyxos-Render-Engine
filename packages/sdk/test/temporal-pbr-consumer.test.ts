import { describe, expect, it } from 'vitest';

import {
  TEMPORAL_PBR_RENDER_FEATURE_ID,
  TEMPORAL_TAA_DEFAULT_SETTINGS,
  TemporalFrameScheduler,
  TemporalPbrRenderFeature,
  createTemporalTaaSettings,
} from '../src/temporal-pbr.js';

describe('SDK temporal PBR entry', () => {
  it('exposes scheduler and product-neutral PBR orchestration', () => {
    expect(TEMPORAL_PBR_RENDER_FEATURE_ID).toBe('kyxos.pbr-temporal');
    expect(TemporalFrameScheduler).toBeTypeOf('function');
    expect(TemporalPbrRenderFeature).toBeTypeOf('function');
    expect(TEMPORAL_TAA_DEFAULT_SETTINGS.jitterScale).toBe(1);
    expect(createTemporalTaaSettings({ jitterScale: 0.35, baseHistoryWeight: 0.94 })).toMatchObject(
      {
        jitterScale: 0.35,
        resolve: { baseHistoryWeight: 0.94 },
      },
    );
  });
});
