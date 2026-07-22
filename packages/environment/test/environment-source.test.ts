import { describe, expect, it, vi } from 'vitest';

import {
  ENVIRONMENT_CUBE_FACES,
  type EnvironmentCubeFaceData,
  EnvironmentLibrary,
  EnvironmentSource,
  type EnvironmentSourceDescriptor,
  float16BitsToFloat32,
  float32ToFloat16Bits,
} from '../src/index.js';

function faces(size: number, seed: number): EnvironmentCubeFaceData {
  return Object.fromEntries(
    ENVIRONMENT_CUBE_FACES.map((face, faceIndex) => [
      face,
      new Float32Array(size * size * 3).fill(seed + faceIndex * 0.01),
    ]),
  ) as unknown as EnvironmentCubeFaceData;
}

function descriptor(id = 'studio', version = 'sha256:test'): EnvironmentSourceDescriptor {
  return {
    brdfLut: {
      height: 2,
      pixels: new Float32Array([0.1, 0.2, 0.25, 0.3, 0.4, 0.05, 0.8, 0.1]),
      width: 2,
    },
    diffuseIrradiance: { faces: faces(2, 0.1), size: 2 },
    id,
    specularPrefilter: {
      levels: [{ faces: faces(4, 0.2) }, { faces: faces(2, 0.3) }, { faces: faces(1, 0.4) }],
      size: 4,
    },
    version,
  };
}

describe('EnvironmentSource', () => {
  it('encodes immutable complete HDR cube mips and a two-channel BRDF LUT', () => {
    const sourceDescriptor = descriptor();
    const source = new EnvironmentSource(sourceDescriptor);

    expect(source.diagnostics()).toEqual({
      brdfLutSize: [2, 2],
      contentHash: source.contentHash,
      diffuseFaceSize: 2,
      estimatedGpuBytes: 1216,
      id: 'studio',
      identityKey: source.identityKey,
      specularFaceSize: 4,
      specularMipLevelCount: 3,
      version: 'sha256:test',
    });
    expect(source.identityKey).toContain(source.contentHash);
    expect(source.copyDiffuseLevel()).toHaveLength(2 * 2 * 6 * 4);
    expect(source.copySpecularLevel(0)).toHaveLength(4 * 4 * 6 * 4);
    expect(source.copySpecularLevel(1)).toHaveLength(2 * 2 * 6 * 4);
    expect(source.copySpecularLevel(2)).toHaveLength(1 * 1 * 6 * 4);
    expect(source.copyBrdfLut()).toHaveLength(2 * 2 * 2);

    const copy = source.copyDiffuseLevel();
    copy.fill(0);
    expect(source.copyDiffuseLevel().some((value) => value !== 0)).toBe(true);
    (sourceDescriptor.diffuseIrradiance.faces['positive-x'] as Float32Array).fill(10);
    expect(source.copyDiffuseLevel()).not.toEqual(copy);
    expect(new EnvironmentSource(descriptor()).identityKey).toBe(source.identityKey);

    const reshapedLutDescriptor = descriptor();
    const reshapedLut = new EnvironmentSource({
      ...reshapedLutDescriptor,
      brdfLut: { ...reshapedLutDescriptor.brdfLut, height: 1, width: 4 },
    });
    expect(reshapedLut.contentHash).toBe(source.contentHash);
    expect(reshapedLut.identityKey).not.toBe(source.identityKey);
  });

  it('rejects incomplete mips, invalid channel counts, and unrepresentable radiance', () => {
    const incomplete = descriptor();
    expect(
      () =>
        new EnvironmentSource({
          ...incomplete,
          specularPrefilter: {
            ...incomplete.specularPrefilter,
            levels: incomplete.specularPrefilter.levels.slice(0, 2),
          },
        }),
    ).toThrow('complete 3-level mip chain');

    const wrongFace = descriptor();
    (wrongFace.diffuseIrradiance.faces as Record<string, EnvironmentFloatData>)['positive-x'] =
      new Float32Array(3);
    expect(() => new EnvironmentSource(wrongFace)).toThrow('exactly 12 RGB values');

    const invalidRadiance = descriptor();
    (invalidRadiance.specularPrefilter.levels[0]?.faces['negative-z'] as Float32Array)[0] =
      Number.POSITIVE_INFINITY;
    expect(() => new EnvironmentSource(invalidRadiance)).toThrow('radiance must be finite');

    const invalidLut = descriptor();
    (invalidLut.brdfLut.pixels as Float32Array)[0] = 1.01;
    expect(() => new EnvironmentSource(invalidLut)).toThrow('LUT values');
  });

  it('uses deterministic IEEE-754 binary16 conversion at contract boundaries', () => {
    expect(float32ToFloat16Bits(0)).toBe(0x0000);
    expect(float32ToFloat16Bits(-0)).toBe(0x8000);
    expect(float32ToFloat16Bits(2 ** -25)).toBe(0x0000);
    expect(float32ToFloat16Bits(0.5)).toBe(0x3800);
    expect(float32ToFloat16Bits(1)).toBe(0x3c00);
    expect(float32ToFloat16Bits(65_504)).toBe(0x7bff);
    expect(float16BitsToFloat32(0x3555)).toBeCloseTo(0.333_251_953_125, 12);
    expect(float16BitsToFloat32(0x7c00)).toBe(Number.POSITIVE_INFINITY);
    expect(() => float16BitsToFloat32(0x1_0000)).toThrow('unsigned 16-bit');
  });
});

type EnvironmentFloatData = Float32Array | readonly number[];

describe('EnvironmentLibrary', () => {
  it('tracks caller-owned immutable versions and explicit replacement events', () => {
    const library = new EnvironmentLibrary();
    const changed = vi.fn();
    library.on('changed', changed);
    const first = new EnvironmentSource(descriptor('studio', 'v1'));
    const second = new EnvironmentSource(descriptor('studio', 'v2'));

    expect(library.set(first)).toBeNull();
    expect(library.set(first)).toBe(first);
    expect(library.set(second)).toBe(first);
    expect(library.resolve('studio')).toBe(second);
    expect(library.resolve({ id: 'studio', version: 'v2' })).toBe(second);
    expect(() => library.resolve({ id: 'studio', version: 'v1' })).toThrow('not v1');
    expect(library.diagnostics()).toEqual({
      identities: [second.identityKey],
      revision: 2,
      sourceCount: 1,
    });
    expect(library.delete('studio')).toBe(second);
    expect(changed.mock.calls.map(([event]) => event.kind)).toEqual(['set', 'replaced', 'removed']);

    library.dispose();
    library.dispose();
    expect(first.diagnostics().id).toBe('studio');
    expect(() => library.resolve('studio')).toThrow('disposed');
  });
});
