import { describe, expect, it } from 'vitest';

import {
  createPbrOutputTransform,
  evaluatePbrOutputTransform,
  khronosPbrNeutralToneMap,
} from '../src/index.js';

describe('PBR output transform', () => {
  it('applies EV exposure, Khronos PBR Neutral, then the sRGB transfer exactly once', () => {
    const result = evaluatePbrOutputTransform([4, 2, 1], {
      exposure: 1,
      toneMapping: 'khronos-pbr-neutral',
    });

    expect(result.transform).toEqual({
      exposure: 1,
      exposureMultiplier: 2,
      toneMapping: 'khronos-pbr-neutral',
    });
    expect(result.exposed).toEqual([8, 4, 2]);
    expect(result.toneMapped).toEqual(khronosPbrNeutralToneMap([8, 4, 2]));
    result.toneMapped.forEach((channel) => {
      expect(channel).toBeGreaterThanOrEqual(0);
      expect(channel).toBeLessThanOrEqual(1);
    });
    result.srgb.forEach((channel) => {
      expect(channel).toBeGreaterThanOrEqual(0);
      expect(channel).toBeLessThanOrEqual(1);
    });
  });

  it('preserves the reference curve anchors and supports explicit clipped output', () => {
    expect(khronosPbrNeutralToneMap([0, 0, 0])).toEqual([0, 0, 0]);
    expect(khronosPbrNeutralToneMap([0.5, 0.5, 0.5])).toEqual([0.46, 0.46, 0.46]);
    expect(evaluatePbrOutputTransform([2, 0.5, 0.003], { toneMapping: 'none' })).toMatchObject({
      exposed: [2, 0.5, 0.003],
      toneMapped: [1, 0.5, 0.003],
    });
  });

  it('rejects invalid exposure, mode, and radiance', () => {
    expect(() => createPbrOutputTransform({ exposure: 33 })).toThrow('exposure');
    expect(() =>
      createPbrOutputTransform({ toneMapping: 'aces' as 'khronos-pbr-neutral' }),
    ).toThrow('tone-mapping');
    expect(() => evaluatePbrOutputTransform([1, -1, 1])).toThrow('nonnegative');
  });
});
