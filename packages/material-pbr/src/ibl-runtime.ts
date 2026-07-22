import { KyxosEngineError } from '@kyxos/render-core';

import { deriveMetallicRoughnessColors } from './brdf.js';

import type { BrdfRgb } from './brdf.js';

export interface SplitSumIblInput {
  /** Effective indirect-light occlusion after material strength is applied. */
  readonly ambientOcclusion: number;
  readonly baseColor: BrdfRgb;
  /** Two-channel BRDF LUT value: scale, then bias. */
  readonly brdfLut: readonly [scale: number, bias: number];
  /** Physical diffuse irradiance E, not E/pi. */
  readonly diffuseIrradiance: BrdfRgb;
  readonly intensity: number;
  readonly metallic: number;
  readonly prefilteredSpecular: BrdfRgb;
}

export interface SplitSumIblResult {
  readonly diffuse: BrdfRgb;
  readonly specular: BrdfRgb;
  readonly total: BrdfRgb;
  readonly unoccludedTotal: BrdfRgb;
}

function invalid(message: string): never {
  throw new KyxosEngineError(message, {
    code: 'INVALID_ARGUMENT',
    module: 'material',
    recoverable: false,
  });
}

function unit(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    invalid(`${label} must be finite and within 0 through 1.`);
  }
  return value;
}

function nonnegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    invalid(`${label} must be finite and nonnegative.`);
  }
  return value;
}

function radiance(value: readonly number[], label: string): BrdfRgb {
  if (value.length !== 3) invalid(`${label} must contain three channels.`);
  return Object.freeze(
    value.map((channel, index) => nonnegative(channel, `${label} channel ${index}`)),
  ) as unknown as BrdfRgb;
}

/** CPU oracle for the runtime split-sum Renderer equation. */
export function evaluateSplitSumIbl(input: SplitSumIblInput): SplitSumIblResult {
  const colors = deriveMetallicRoughnessColors(
    input.baseColor,
    unit(input.metallic, 'IBL metallic'),
  );
  const irradiance = radiance(input.diffuseIrradiance, 'IBL diffuse irradiance');
  const prefiltered = radiance(input.prefilteredSpecular, 'IBL prefiltered Specular');
  const scale = unit(input.brdfLut[0], 'IBL BRDF LUT scale');
  const bias = unit(input.brdfLut[1], 'IBL BRDF LUT bias');
  const ambientOcclusion = unit(input.ambientOcclusion, 'IBL ambient occlusion');
  const intensity = nonnegative(input.intensity, 'IBL environment intensity');
  const diffuse = Object.freeze(
    colors.diffuseColor.map(
      (channel, index) => (channel * (irradiance[index] as number)) / Math.PI,
    ),
  ) as BrdfRgb;
  const specular = Object.freeze(
    colors.f0.map((channel, index) => (prefiltered[index] as number) * (channel * scale + bias)),
  ) as BrdfRgb;
  const unoccludedTotal = Object.freeze(
    diffuse.map((channel, index) => channel + (specular[index] as number)),
  ) as BrdfRgb;
  const total = Object.freeze(
    unoccludedTotal.map((channel) => channel * ambientOcclusion * intensity),
  ) as BrdfRgb;
  return Object.freeze({ diffuse, specular, total, unoccludedTotal });
}
