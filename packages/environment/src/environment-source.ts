import { KyxosEngineError } from '@kyxos/render-core';

import { float32ToFloat16Bits } from './float16.js';

export const ENVIRONMENT_CUBE_FACES = [
  'positive-x',
  'negative-x',
  'positive-y',
  'negative-y',
  'positive-z',
  'negative-z',
] as const;

export type EnvironmentCubeFace = (typeof ENVIRONMENT_CUBE_FACES)[number];
export type EnvironmentFloatData = Float32Array | readonly number[];
export type EnvironmentCubeFaceData = Readonly<Record<EnvironmentCubeFace, EnvironmentFloatData>>;

export interface EnvironmentCubeLevelDescriptor {
  readonly faces: EnvironmentCubeFaceData;
}

export interface EnvironmentDiffuseIrradianceDescriptor {
  readonly faces: EnvironmentCubeFaceData;
  readonly size: number;
}

export interface EnvironmentSpecularPrefilterDescriptor {
  readonly levels: readonly EnvironmentCubeLevelDescriptor[];
  readonly size: number;
}

export interface EnvironmentBrdfLutDescriptor {
  readonly height: number;
  /** Interleaved scale/bias pairs in linear space. */
  readonly pixels: EnvironmentFloatData;
  readonly width: number;
}

export interface EnvironmentSourceDescriptor {
  readonly brdfLut: EnvironmentBrdfLutDescriptor;
  readonly diffuseIrradiance: EnvironmentDiffuseIrradianceDescriptor;
  readonly id: string;
  readonly specularPrefilter: EnvironmentSpecularPrefilterDescriptor;
  /** Caller-controlled immutable content revision, for example an asset hash or version. */
  readonly version: string;
}

export interface EnvironmentSourceDiagnostics {
  readonly brdfLutSize: readonly [width: number, height: number];
  readonly contentHash: string;
  readonly diffuseFaceSize: number;
  readonly estimatedGpuBytes: number;
  readonly id: string;
  readonly identityKey: string;
  readonly specularFaceSize: number;
  readonly specularMipLevelCount: number;
  readonly version: string;
}

const MAX_FLOAT16 = 65_504;

function error(message: string): KyxosEngineError {
  return new KyxosEngineError(message, {
    code: 'INVALID_ARGUMENT',
    module: 'environment',
    recoverable: false,
  });
}

function positiveDimension(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw error(`${label} must be a positive safe integer.`);
  }
  return value;
}

function nonEmpty(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw error(`${label} must not be empty.`);
  return normalized;
}

function expectedMipCount(size: number): number {
  return Math.floor(Math.log2(size)) + 1;
}

function encodeCubeLevel(faces: EnvironmentCubeFaceData, size: number, label: string): Uint16Array {
  const sourceLength = size * size * 3;
  const texelCount = size * size * ENVIRONMENT_CUBE_FACES.length;
  if (!Number.isSafeInteger(sourceLength) || !Number.isSafeInteger(texelCount)) {
    throw error(`${label} dimensions exceed safe CPU source limits.`);
  }
  const result = new Uint16Array(texelCount * 4);
  let target = 0;
  for (const face of ENVIRONMENT_CUBE_FACES) {
    const pixels = faces[face];
    if (pixels === undefined || pixels.length !== sourceLength) {
      throw error(`${label} face ${face} must contain exactly ${sourceLength} RGB values.`);
    }
    for (let source = 0; source < sourceLength; source += 3) {
      for (let channel = 0; channel < 3; channel += 1) {
        const value = pixels[source + channel] as number;
        if (!Number.isFinite(value) || value < 0 || value > MAX_FLOAT16) {
          throw error(`${label} radiance must be finite and within 0 through ${MAX_FLOAT16}.`);
        }
        result[target++] = float32ToFloat16Bits(value);
      }
      result[target++] = float32ToFloat16Bits(1);
    }
  }
  return result;
}

function encodeBrdfLut(descriptor: EnvironmentBrdfLutDescriptor): Uint16Array {
  const length = descriptor.width * descriptor.height * 2;
  if (!Number.isSafeInteger(length) || descriptor.pixels.length !== length) {
    throw error(`Environment BRDF LUT must contain exactly ${length} scale/bias values.`);
  }
  const result = new Uint16Array(length);
  for (let index = 0; index < length; index += 1) {
    const value = descriptor.pixels[index] as number;
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw error('Environment BRDF LUT values must be finite and within 0 through 1.');
    }
    result[index] = float32ToFloat16Bits(value);
  }
  return result;
}

function mixChecksum(checksum: number, value: number): number {
  let result = checksum;
  result ^= value & 0xff;
  result = Math.imul(result, 0x01000193) >>> 0;
  result ^= value >>> 8;
  return Math.imul(result, 0x01000193) >>> 0;
}

function contentHash(values: readonly Uint16Array[]): string {
  let checksum = 0x811c9dc5;
  for (const value of values) {
    checksum = mixChecksum(checksum, value.length);
    for (const word of value) checksum = mixChecksum(checksum, word);
  }
  return checksum.toString(16).padStart(8, '0');
}

/** Immutable, prefiltered linear HDR environment source. GPU ownership is separate. */
export class EnvironmentSource {
  readonly #brdfLut: Uint16Array;
  readonly #diffuseLevel: Uint16Array;
  readonly #specularLevels: readonly Uint16Array[];
  readonly brdfLutHeight: number;
  readonly brdfLutWidth: number;
  readonly contentHash: string;
  readonly diffuseFaceSize: number;
  readonly estimatedGpuBytes: number;
  readonly id: string;
  readonly identityKey: string;
  readonly specularFaceSize: number;
  readonly specularMipLevelCount: number;
  readonly version: string;

  constructor(descriptor: EnvironmentSourceDescriptor) {
    this.id = nonEmpty(descriptor.id, 'Environment source id');
    this.version = nonEmpty(descriptor.version, 'Environment source version');
    this.diffuseFaceSize = positiveDimension(
      descriptor.diffuseIrradiance.size,
      'Diffuse Irradiance face size',
    );
    this.specularFaceSize = positiveDimension(
      descriptor.specularPrefilter.size,
      'Specular Prefilter face size',
    );
    this.brdfLutWidth = positiveDimension(descriptor.brdfLut.width, 'BRDF LUT width');
    this.brdfLutHeight = positiveDimension(descriptor.brdfLut.height, 'BRDF LUT height');

    const requiredSpecularMips = expectedMipCount(this.specularFaceSize);
    if (descriptor.specularPrefilter.levels.length !== requiredSpecularMips) {
      throw error(
        `Specular Prefilter requires the complete ${requiredSpecularMips}-level mip chain.`,
      );
    }
    this.#diffuseLevel = encodeCubeLevel(
      descriptor.diffuseIrradiance.faces,
      this.diffuseFaceSize,
      'Diffuse Irradiance',
    );
    this.#specularLevels = Object.freeze(
      descriptor.specularPrefilter.levels.map((level, mipLevel) =>
        encodeCubeLevel(
          level.faces,
          Math.max(1, Math.floor(this.specularFaceSize / 2 ** mipLevel)),
          `Specular Prefilter mip ${mipLevel}`,
        ),
      ),
    );
    this.#brdfLut = encodeBrdfLut(descriptor.brdfLut);
    this.specularMipLevelCount = this.#specularLevels.length;
    this.contentHash = contentHash([this.#diffuseLevel, ...this.#specularLevels, this.#brdfLut]);
    this.identityKey = JSON.stringify([
      this.id,
      this.version,
      this.contentHash,
      this.diffuseFaceSize,
      this.specularFaceSize,
      this.specularMipLevelCount,
      this.brdfLutWidth,
      this.brdfLutHeight,
    ]);
    this.estimatedGpuBytes =
      this.#diffuseLevel.byteLength +
      this.#specularLevels.reduce((sum, level) => sum + level.byteLength, 0) +
      this.#brdfLut.byteLength;
    Object.freeze(this);
  }

  copyDiffuseLevel(): Uint16Array {
    return this.#diffuseLevel.slice();
  }

  copySpecularLevel(mipLevel: number): Uint16Array {
    if (
      !Number.isSafeInteger(mipLevel) ||
      mipLevel < 0 ||
      mipLevel >= this.#specularLevels.length
    ) {
      throw error('Specular Prefilter mip level is outside the complete chain.');
    }
    return (this.#specularLevels[mipLevel] as Uint16Array).slice();
  }

  copyBrdfLut(): Uint16Array {
    return this.#brdfLut.slice();
  }

  diagnostics(): EnvironmentSourceDiagnostics {
    return Object.freeze({
      brdfLutSize: Object.freeze([this.brdfLutWidth, this.brdfLutHeight] as const),
      contentHash: this.contentHash,
      diffuseFaceSize: this.diffuseFaceSize,
      estimatedGpuBytes: this.estimatedGpuBytes,
      id: this.id,
      identityKey: this.identityKey,
      specularFaceSize: this.specularFaceSize,
      specularMipLevelCount: this.specularMipLevelCount,
      version: this.version,
    });
  }
}
