import { describe, expect, it } from 'vitest';

import {
  IBL_MAX_REFERENCE_SAMPLE_COUNT,
  IBL_REFERENCE_SAMPLE_COUNT,
  convolveDiffuseIrradiance,
  evaluateDeterministicIblReference,
  hammersley2d,
  integrateGgxBrdfLut,
  prefilterGgxSpecular,
  radicalInverseVdc,
  sampleDeterministicIblEnvironment,
} from '../src/index.js';

describe('deterministic split-sum IBL reference', () => {
  it('freezes the unsigned Van der Corput and Hammersley sample sequence', () => {
    expect([0, 1, 2, 3, 4].map((index) => hammersley2d(index, 8))).toEqual([
      [0, 0],
      [0.125, 0.5],
      [0.25, 0.25],
      [0.375, 0.75],
      [0.5, 0.125],
    ]);
    expect(radicalInverseVdc(0xffff_ffff)).toBeCloseTo(0.9999999997671694, 15);
  });

  it('preserves the physical pi convention for a constant diffuse environment', () => {
    const result = convolveDiffuseIrradiance([0, 0, 1], () => [0.25, 0.5, 2]);
    expect(result.sampleCount).toBe(IBL_REFERENCE_SAMPLE_COUNT);
    expect(result.lambertianRadiance).toEqual([0.25, 0.5, 2]);
    expect(result.irradiance[0]).toBeCloseTo(0.25 * Math.PI, 15);
    expect(result.irradiance[1]).toBeCloseTo(0.5 * Math.PI, 15);
    expect(result.irradiance[2]).toBeCloseTo(2 * Math.PI, 15);
  });

  it('normalizes GGX prefilter weights and retains a constant environment', () => {
    const result = prefilterGgxSpecular([0.2, 0.7, 0.4], 0.73, () => [0.25, 0.5, 2]);
    expect(result.radiance).toEqual([0.25, 0.5, 2]);
    expect(result.sampleWeight).toBeGreaterThan(0);
    expect(result.sampleCount).toBe(IBL_REFERENCE_SAMPLE_COUNT);
  });

  it('keeps the prefilter roughness direction and smooth reflection limit', () => {
    const reflection = [-0.42, 0.35, 0.84] as const;
    const environment = sampleDeterministicIblEnvironment(reflection);
    const smooth = prefilterGgxSpecular(reflection, 0, sampleDeterministicIblEnvironment);
    const rough = prefilterGgxSpecular(reflection, 1, sampleDeterministicIblEnvironment);

    smooth.radiance.forEach((channel, index) => {
      expect(channel).toBeCloseTo(environment[index] as number, 5);
    });
    expect(rough.radiance).not.toEqual(smooth.radiance);
    expect(rough.sampleWeight).toBeLessThan(smooth.sampleWeight);
  });

  it('integrates finite scale and bias across the BRDF LUT domain', () => {
    const grazing = integrateGgxBrdfLut(0, 0.5);
    const normal = integrateGgxBrdfLut(1, 0.5);
    for (const result of [grazing, normal]) {
      expect(result.scale).toBeGreaterThanOrEqual(0);
      expect(result.bias).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(result.scale + result.bias)).toBe(true);
    }
    expect(grazing.bias).toBeGreaterThan(normal.bias);
  });

  it('freezes the analytic CPU oracle without random or texture inputs', () => {
    const first = evaluateDeterministicIblReference();
    const second = evaluateDeterministicIblReference();
    expect(second).toEqual(first);
    expect(Object.isFrozen(first)).toBe(true);
    const expectedDiffuse = [1.1567748910347588, 1.2353476633382934, 1.1145940172241267];
    const expectedSpecular = [0.2616162714500789, 0.3796415273593579, 0.4273159870751119];
    first.diffuse.irradiance.forEach((channel, index) => {
      expect(channel).toBeCloseTo(expectedDiffuse[index] as number, 12);
    });
    first.specular.radiance.forEach((channel, index) => {
      expect(channel).toBeCloseTo(expectedSpecular[index] as number, 12);
    });
    expect(first.brdfLut.scale).toBeCloseTo(0.971381539825925, 12);
    expect(first.brdfLut.bias).toBeCloseTo(0.007016049746546188, 12);
  });

  it('fails closed for malformed vectors, domains, radiance, and sample ranges', () => {
    expect(() => convolveDiffuseIrradiance([0, 0, 0], () => [1, 1, 1])).toThrow('nonzero length');
    expect(() => convolveDiffuseIrradiance([0, 0, 1], () => [-1, 0, 0])).toThrow('nonnegative');
    expect(() => prefilterGgxSpecular([0, 0, 1], 1.1, () => [1, 1, 1])).toThrow('from 0 through 1');
    expect(() => integrateGgxBrdfLut(Number.NaN, 0.5)).toThrow('must be finite');
    expect(() => hammersley2d(1, 1)).toThrow('within the sample count');
    expect(() => hammersley2d(0, IBL_MAX_REFERENCE_SAMPLE_COUNT + 1)).toThrow('must be an integer');
  });
});
