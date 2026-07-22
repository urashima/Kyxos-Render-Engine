import { describe, expect, it } from 'vitest';

import { evaluateSplitSumIbl } from '../src/index.js';

describe('split-sum runtime IBL', () => {
  it('combines physical irradiance, prefiltered radiance, LUT, AO, and intensity', () => {
    const result = evaluateSplitSumIbl({
      ambientOcclusion: 0.4,
      baseColor: [0.5, 0.4, 0.3],
      brdfLut: [0.5, 0.1],
      diffuseIrradiance: [0.6, 0.3, 0.15],
      intensity: 2,
      metallic: 0.25,
      prefilteredSpecular: [0.2, 0.4, 0.1],
    });

    const expectedDiffuse = [
      (0.6 * 0.375) / Math.PI,
      (0.3 * 0.3) / Math.PI,
      (0.15 * 0.225) / Math.PI,
    ];
    const expectedSpecular = [
      0.2 * (0.155 * 0.5 + 0.1),
      0.4 * (0.13 * 0.5 + 0.1),
      0.1 * (0.105 * 0.5 + 0.1),
    ];
    result.diffuse.forEach((channel, index) =>
      expect(channel).toBeCloseTo(expectedDiffuse[index] as number, 15),
    );
    result.specular.forEach((channel, index) =>
      expect(channel).toBeCloseTo(expectedSpecular[index] as number, 15),
    );
    result.total.forEach((channel, index) => {
      expect(channel).toBeCloseTo((result.unoccludedTotal[index] as number) * 0.8, 12);
    });
  });

  it('rejects nonphysical inputs', () => {
    expect(() =>
      evaluateSplitSumIbl({
        ambientOcclusion: 1,
        baseColor: [1, 1, 1],
        brdfLut: [0.5, 0.1],
        diffuseIrradiance: [1, 1, 1],
        intensity: -1,
        metallic: 0,
        prefilteredSpecular: [1, 1, 1],
      }),
    ).toThrow('intensity');
  });
});
