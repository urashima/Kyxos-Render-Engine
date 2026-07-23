import { describe, expect, it } from 'vitest';

import {
  TEMPORAL_PBR_RENDER_FEATURE_ID,
  TemporalFrameScheduler,
  TemporalPbrRenderFeature,
} from '../src/temporal-pbr.js';

describe('SDK temporal PBR entry', () => {
  it('exposes scheduler and product-neutral PBR orchestration', () => {
    expect(TEMPORAL_PBR_RENDER_FEATURE_ID).toBe('kyxos.pbr-temporal');
    expect(TemporalFrameScheduler).toBeTypeOf('function');
    expect(TemporalPbrRenderFeature).toBeTypeOf('function');
  });
});
