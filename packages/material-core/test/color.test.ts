import { describe, expect, it } from 'vitest';

import {
  createLinearRgb,
  createLinearRgba,
  linearChannelToSrgb,
  linearToSrgbRgb,
  linearToSrgbRgba,
  srgbChannelToLinear,
  srgbToLinearRgb,
  srgbToLinearRgba,
} from '../src/index.js';

describe('material color contract', () => {
  it('matches the standard sRGB transfer curve reference points', () => {
    expect(srgbChannelToLinear(0.04045)).toBeCloseTo(0.0031308049535603713, 15);
    expect(srgbChannelToLinear(0.5)).toBeCloseTo(0.21404114048223255, 15);
    expect(linearChannelToSrgb(0.0031308)).toBeCloseTo(0.040449936, 8);
    expect(linearChannelToSrgb(0.21404114048223255)).toBeCloseTo(0.5, 15);
  });

  it('round-trips extended finite RGB values and preserves linear alpha', () => {
    const source = [-0.25, 0.5, 1.25] as const;
    const encoded = linearToSrgbRgb(source);
    const roundTrip = srgbToLinearRgb(encoded);
    expect(roundTrip[0]).toBeCloseTo(source[0], 14);
    expect(roundTrip[1]).toBeCloseTo(source[1], 14);
    expect(roundTrip[2]).toBeCloseTo(source[2], 14);

    expect(srgbToLinearRgba([0.5, 0.5, 0.5, 0.37])[3]).toBe(0.37);
    expect(linearToSrgbRgba([0.2, 0.3, 0.4, 0.61])[3]).toBe(0.61);
  });

  it('creates frozen unit-range linear material factors', () => {
    const rgb = createLinearRgb([0.1, 0.2, 0.3]);
    const rgba = createLinearRgba([0.1, 0.2, 0.3, 0.4]);
    expect(Object.isFrozen(rgb)).toBe(true);
    expect(Object.isFrozen(rgba)).toBe(true);
    expect(rgb).toEqual([0.1, 0.2, 0.3]);
    expect(rgba).toEqual([0.1, 0.2, 0.3, 0.4]);
  });

  it('rejects nonfinite channels and out-of-range material factors', () => {
    expect(() => srgbChannelToLinear(Number.NaN)).toThrow('must be finite');
    expect(() => linearChannelToSrgb(Number.POSITIVE_INFINITY)).toThrow('must be finite');
    expect(() => createLinearRgb([-0.01, 0, 0])).toThrow('must be from 0 through 1');
    expect(() => createLinearRgba([0, 0, 0, 1.01])).toThrow('must be from 0 through 1');
  });
});
