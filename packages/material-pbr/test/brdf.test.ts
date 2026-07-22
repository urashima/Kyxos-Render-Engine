import { describe, expect, it } from 'vitest';

import {
  PBR_DIELECTRIC_F0,
  PBR_MIN_ALPHA,
  deriveMetallicRoughnessColors,
  evaluateMetallicRoughnessBrdf,
  ggxTrowbridgeReitzDistribution,
  perceptualRoughnessToAlpha,
  schlickFresnel,
  smithGgxVisibility,
} from '../src/index.js';

describe('metallic-roughness BRDF reference', () => {
  it('maps perceptual roughness to squared alpha with a finite realtime floor', () => {
    expect(perceptualRoughnessToAlpha(0)).toBe(PBR_MIN_ALPHA);
    expect(perceptualRoughnessToAlpha(0.5)).toBe(0.25);
    expect(perceptualRoughnessToAlpha(1)).toBe(1);
  });

  it('matches the GGX and separable Smith reference values at alpha one', () => {
    expect(ggxTrowbridgeReitzDistribution(1, 0.25)).toBeCloseTo(1 / Math.PI, 15);
    expect(ggxTrowbridgeReitzDistribution(1, 1)).toBeCloseTo(1 / Math.PI, 15);
    expect(ggxTrowbridgeReitzDistribution(1, 0)).toBe(0);
    expect(smithGgxVisibility(1, 1, 1)).toBe(0.25);
    expect(smithGgxVisibility(1, 0, 1)).toBe(0);
  });

  it('uses Schlick F0 at normal incidence and approaches white at grazing incidence', () => {
    expect(schlickFresnel([0.04, 0.2, 0.8], 1)).toEqual([0.04, 0.2, 0.8]);
    expect(schlickFresnel([0.04, 0.2, 0.8], 0)).toEqual([1, 1, 1]);
    expect(schlickFresnel([0.04, 0.2, 0.8], -0.5)).toEqual(schlickFresnel([0.04, 0.2, 0.8], 0.5));
  });

  it('removes diffuse from metals and uses the standard dielectric F0', () => {
    expect(deriveMetallicRoughnessColors([0.8, 0.3, 0.1], 0)).toEqual({
      diffuseColor: [0.8, 0.3, 0.1],
      f0: [PBR_DIELECTRIC_F0, PBR_DIELECTRIC_F0, PBR_DIELECTRIC_F0],
    });
    expect(deriveMetallicRoughnessColors([0.8, 0.3, 0.1], 1)).toEqual({
      diffuseColor: [0, 0, 0],
      f0: [0.8, 0.3, 0.1],
    });
  });

  it('evaluates the normal-incidence white dielectric reference', () => {
    const result = evaluateMetallicRoughnessBrdf({
      baseColor: [1, 1, 1],
      metallic: 0,
      nDotH: 1,
      nDotL: 1,
      nDotV: 1,
      roughness: 1,
      vDotH: 1,
    });
    const expectedDiffuse = 0.96 / Math.PI;
    const expectedSpecular = 0.01 / Math.PI;
    expect(result.diffuse).toEqual([expectedDiffuse, expectedDiffuse, expectedDiffuse]);
    expect(result.specular).toEqual([expectedSpecular, expectedSpecular, expectedSpecular]);
    expect(result.total[0]).toBeCloseTo(0.97 / Math.PI, 15);
  });

  it('is reciprocal when light and view cosines are exchanged', () => {
    const input = {
      baseColor: [0.72, 0.31, 0.08] as const,
      metallic: 0.64,
      nDotH: 0.91,
      nDotL: 0.38,
      nDotV: 0.79,
      roughness: 0.47,
      vDotH: 0.86,
    };
    const forward = evaluateMetallicRoughnessBrdf(input);
    const reverse = evaluateMetallicRoughnessBrdf({
      ...input,
      nDotL: input.nDotV,
      nDotV: input.nDotL,
    });
    expect(reverse.total).toEqual(forward.total);
    expect(reverse.visibility).toBe(forward.visibility);
  });

  it('keeps the roughness direction correct for an aligned highlight', () => {
    const common = {
      baseColor: [0.9, 0.7, 0.2] as const,
      metallic: 1,
      nDotH: 1,
      nDotL: 1,
      nDotV: 1,
      vDotH: 1,
    };
    const smooth = evaluateMetallicRoughnessBrdf({ ...common, roughness: 0.25 });
    const rough = evaluateMetallicRoughnessBrdf({ ...common, roughness: 0.75 });
    expect(smooth.specular[0]).toBeGreaterThan(rough.specular[0]);
    expect(smooth.diffuse).toEqual([0, 0, 0]);
  });

  it('rejects invalid factors and returns zero for a rejected hemisphere', () => {
    expect(() => perceptualRoughnessToAlpha(Number.NaN)).toThrow('must be finite');
    expect(() => ggxTrowbridgeReitzDistribution(PBR_MIN_ALPHA / 2, 1)).toThrow('must be at least');
    expect(() => schlickFresnel([1.1, 0, 0], 1)).toThrow('from 0 through 1');
    expect(() =>
      evaluateMetallicRoughnessBrdf({
        baseColor: [1, 1, 1],
        metallic: 0,
        nDotH: 1,
        nDotL: -0.1,
        nDotV: 1,
        roughness: 0.5,
        vDotH: 1,
      }),
    ).not.toThrow();
    expect(
      evaluateMetallicRoughnessBrdf({
        baseColor: [1, 1, 1],
        metallic: 0,
        nDotH: 1,
        nDotL: -0.1,
        nDotV: 1,
        roughness: 0.5,
        vDotH: 1,
      }).total,
    ).toEqual([0, 0, 0]);
  });
});
