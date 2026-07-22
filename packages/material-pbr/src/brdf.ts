import { KyxosEngineError } from '@kyxos/render-core';

import type { RgbColor } from '@kyxos/render-material-core';

export const PBR_DIELECTRIC_F0 = 0.04;
export const PBR_MIN_ALPHA = 0.0001;

export type BrdfRgb = readonly [red: number, green: number, blue: number];

export interface MetallicRoughnessColors {
  readonly diffuseColor: BrdfRgb;
  readonly f0: BrdfRgb;
}

export interface MetallicRoughnessBrdfInput {
  readonly baseColor: RgbColor;
  readonly metallic: number;
  readonly nDotH: number;
  readonly nDotL: number;
  readonly nDotV: number;
  readonly roughness: number;
  readonly vDotH: number;
}

export interface MetallicRoughnessBrdfResult {
  readonly alpha: number;
  readonly diffuse: BrdfRgb;
  readonly distribution: number;
  readonly fresnel: BrdfRgb;
  readonly specular: BrdfRgb;
  readonly total: BrdfRgb;
  readonly visibility: number;
}

function invalid(message: string): never {
  throw new KyxosEngineError(message, {
    code: 'INVALID_ARGUMENT',
    module: 'material',
    recoverable: false,
  });
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) invalid(`${label} must be finite.`);
  return value;
}

function unit(value: number, label: string): number {
  finite(value, label);
  if (value < 0 || value > 1) invalid(`${label} must be from 0 through 1.`);
  return value;
}

function signedUnit(value: number, label: string): number {
  finite(value, label);
  if (value < -1 || value > 1) invalid(`${label} must be from -1 through 1.`);
  return value;
}

function rgb(value: readonly number[], label: string): BrdfRgb {
  if (value.length !== 3) invalid(`${label} must contain three channels.`);
  return Object.freeze([
    unit(value[0] as number, `${label} red`),
    unit(value[1] as number, `${label} green`),
    unit(value[2] as number, `${label} blue`),
  ]);
}

function resultRgb(red: number, green: number, blue: number): BrdfRgb {
  return Object.freeze([red, green, blue]);
}

export function perceptualRoughnessToAlpha(roughness: number): number {
  const normalized = unit(roughness, 'PBR perceptual roughness');
  return Math.max(normalized * normalized, PBR_MIN_ALPHA);
}

export function ggxTrowbridgeReitzDistribution(alpha: number, nDotH: number): number {
  const normalizedAlpha = unit(alpha, 'PBR alpha');
  if (normalizedAlpha < PBR_MIN_ALPHA) {
    invalid(`PBR alpha must be at least ${PBR_MIN_ALPHA}.`);
  }
  const cosine = unit(nDotH, 'PBR N dot H');
  if (cosine === 0) return 0;
  const alphaSquared = normalizedAlpha * normalizedAlpha;
  const denominator = cosine * cosine * (alphaSquared - 1) + 1;
  return alphaSquared / (Math.PI * denominator * denominator);
}

export function smithGgxVisibility(alpha: number, nDotL: number, nDotV: number): number {
  const normalizedAlpha = unit(alpha, 'PBR alpha');
  if (normalizedAlpha < PBR_MIN_ALPHA) {
    invalid(`PBR alpha must be at least ${PBR_MIN_ALPHA}.`);
  }
  const lightCosine = unit(nDotL, 'PBR N dot L');
  const viewCosine = unit(nDotV, 'PBR N dot V');
  if (lightCosine === 0 || viewCosine === 0) return 0;
  const alphaSquared = normalizedAlpha * normalizedAlpha;
  const lightDenominator =
    lightCosine + Math.sqrt(alphaSquared + (1 - alphaSquared) * lightCosine * lightCosine);
  const viewDenominator =
    viewCosine + Math.sqrt(alphaSquared + (1 - alphaSquared) * viewCosine * viewCosine);
  return 1 / (lightDenominator * viewDenominator);
}

export function schlickFresnel(f0: RgbColor, vDotH: number): BrdfRgb {
  const normalIncidence = rgb(f0, 'PBR F0');
  const cosine = Math.abs(signedUnit(vDotH, 'PBR V dot H'));
  const grazingWeight = (1 - cosine) ** 5;
  return resultRgb(
    normalIncidence[0] + (1 - normalIncidence[0]) * grazingWeight,
    normalIncidence[1] + (1 - normalIncidence[1]) * grazingWeight,
    normalIncidence[2] + (1 - normalIncidence[2]) * grazingWeight,
  );
}

export function deriveMetallicRoughnessColors(
  baseColor: RgbColor,
  metallic: number,
): MetallicRoughnessColors {
  const color = rgb(baseColor, 'PBR base color');
  const metalness = unit(metallic, 'PBR metallic');
  const dielectricWeight = 1 - metalness;
  return Object.freeze({
    diffuseColor: resultRgb(
      color[0] * dielectricWeight,
      color[1] * dielectricWeight,
      color[2] * dielectricWeight,
    ),
    f0: resultRgb(
      PBR_DIELECTRIC_F0 * dielectricWeight + color[0] * metalness,
      PBR_DIELECTRIC_F0 * dielectricWeight + color[1] * metalness,
      PBR_DIELECTRIC_F0 * dielectricWeight + color[2] * metalness,
    ),
  });
}

export function evaluateMetallicRoughnessBrdf(
  input: MetallicRoughnessBrdfInput,
): MetallicRoughnessBrdfResult {
  const metallic = unit(input.metallic, 'PBR metallic');
  const roughness = unit(input.roughness, 'PBR roughness');
  const nDotH = signedUnit(input.nDotH, 'PBR N dot H');
  const nDotL = signedUnit(input.nDotL, 'PBR N dot L');
  const nDotV = signedUnit(input.nDotV, 'PBR N dot V');
  const vDotH = signedUnit(input.vDotH, 'PBR V dot H');
  const alpha = perceptualRoughnessToAlpha(roughness);
  const colors = deriveMetallicRoughnessColors(input.baseColor, metallic);
  const fresnel = schlickFresnel(colors.f0, vDotH);

  if (nDotH <= 0 || nDotL <= 0 || nDotV <= 0) {
    const zero = resultRgb(0, 0, 0);
    return Object.freeze({
      alpha,
      diffuse: zero,
      distribution: 0,
      fresnel,
      specular: zero,
      total: zero,
      visibility: 0,
    });
  }

  const distribution = ggxTrowbridgeReitzDistribution(alpha, nDotH);
  const visibility = smithGgxVisibility(alpha, nDotL, nDotV);
  const diffuse = resultRgb(
    ((1 - fresnel[0]) * colors.diffuseColor[0]) / Math.PI,
    ((1 - fresnel[1]) * colors.diffuseColor[1]) / Math.PI,
    ((1 - fresnel[2]) * colors.diffuseColor[2]) / Math.PI,
  );
  const specularScale = distribution * visibility;
  const specular = resultRgb(
    fresnel[0] * specularScale,
    fresnel[1] * specularScale,
    fresnel[2] * specularScale,
  );
  return Object.freeze({
    alpha,
    diffuse,
    distribution,
    fresnel,
    specular,
    total: resultRgb(diffuse[0] + specular[0], diffuse[1] + specular[1], diffuse[2] + specular[2]),
    visibility,
  });
}
