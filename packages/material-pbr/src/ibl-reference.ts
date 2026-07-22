import { KyxosEngineError } from '@kyxos/render-core';

import { PBR_MIN_ALPHA, perceptualRoughnessToAlpha, smithGgxVisibility } from './brdf.js';

export const IBL_REFERENCE_SAMPLE_COUNT = 64;
export const IBL_MAX_REFERENCE_SAMPLE_COUNT = 4096;

export type IblVec2 = readonly [x: number, y: number];
export type IblVec3 = readonly [x: number, y: number, z: number];
export type IblEnvironmentSampler = (direction: IblVec3) => readonly number[];

export interface DiffuseIrradianceReference {
  readonly irradiance: IblVec3;
  readonly lambertianRadiance: IblVec3;
  readonly sampleCount: number;
}

export interface GgxSpecularPrefilterReference {
  readonly radiance: IblVec3;
  readonly roughness: number;
  readonly sampleCount: number;
  readonly sampleWeight: number;
}

export interface BrdfLutReference {
  readonly bias: number;
  readonly nDotV: number;
  readonly roughness: number;
  readonly sampleCount: number;
  readonly scale: number;
}

export interface DeterministicIblReference {
  readonly brdfLut: BrdfLutReference;
  readonly diffuse: DiffuseIrradianceReference;
  readonly specular: GgxSpecularPrefilterReference;
}

export const IBL_REFERENCE_INPUT = Object.freeze({
  brdfLutNdotV: 0.67,
  brdfLutRoughness: 0.38,
  diffuseNormal: Object.freeze([0.31, 0.82, 0.48]) as IblVec3,
  specularDirection: Object.freeze([-0.42, 0.35, 0.84]) as IblVec3,
  specularRoughness: 0.43,
});

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

function referenceSampleCount(value: number): number {
  finite(value, 'IBL reference sample count');
  if (!Number.isInteger(value) || value < 1 || value > IBL_MAX_REFERENCE_SAMPLE_COUNT) {
    invalid(
      `IBL reference sample count must be an integer from 1 through ${IBL_MAX_REFERENCE_SAMPLE_COUNT}.`,
    );
  }
  return value;
}

function vec3(x: number, y: number, z: number): IblVec3 {
  return Object.freeze([x, y, z]);
}

function direction(value: readonly number[], label: string): IblVec3 {
  if (value.length !== 3) invalid(`${label} must contain three components.`);
  const x = finite(value[0] as number, `${label} x`);
  const y = finite(value[1] as number, `${label} y`);
  const z = finite(value[2] as number, `${label} z`);
  const length = Math.hypot(x, y, z);
  if (length <= Number.EPSILON) invalid(`${label} must have nonzero length.`);
  return vec3(x / length, y / length, z / length);
}

function radiance(value: readonly number[], label: string): IblVec3 {
  if (value.length !== 3) invalid(`${label} must contain three channels.`);
  const channels = value.map((channel, index) => {
    const normalized = finite(channel, `${label} channel ${index}`);
    if (normalized < 0) invalid(`${label} channels must be nonnegative.`);
    return normalized;
  });
  return vec3(channels[0] as number, channels[1] as number, channels[2] as number);
}

function dot(left: IblVec3, right: IblVec3): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function cross(left: IblVec3, right: IblVec3): IblVec3 {
  return vec3(
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  );
}

function addScaled(
  first: IblVec3,
  firstScale: number,
  second: IblVec3,
  secondScale: number,
  third: IblVec3,
  thirdScale: number,
): IblVec3 {
  return vec3(
    first[0] * firstScale + second[0] * secondScale + third[0] * thirdScale,
    first[1] * firstScale + second[1] * secondScale + third[1] * thirdScale,
    first[2] * firstScale + second[2] * secondScale + third[2] * thirdScale,
  );
}

function tangentFrame(normal: IblVec3): readonly [IblVec3, IblVec3] {
  const referenceAxis = Math.abs(normal[2]) < 0.999 ? vec3(0, 0, 1) : vec3(0, 1, 0);
  const tangent = direction(cross(referenceAxis, normal), 'IBL tangent');
  return Object.freeze([tangent, cross(normal, tangent)]);
}

function worldDirection(
  tangent: IblVec3,
  bitangent: IblVec3,
  normal: IblVec3,
  local: IblVec3,
): IblVec3 {
  return direction(
    addScaled(tangent, local[0], bitangent, local[1], normal, local[2]),
    'IBL sampled direction',
  );
}

function sampleCosineHemisphere(point: IblVec2): IblVec3 {
  const phi = 2 * Math.PI * point[0];
  const cosine = Math.sqrt(1 - point[1]);
  const sine = Math.sqrt(point[1]);
  return vec3(sine * Math.cos(phi), sine * Math.sin(phi), cosine);
}

function sampleGgxHalfVector(point: IblVec2, roughness: number): IblVec3 {
  const alpha = perceptualRoughnessToAlpha(roughness);
  const alphaSquared = alpha * alpha;
  const denominator = 1 + (alphaSquared - 1) * point[1];
  const cosine = Math.sqrt((1 - point[1]) / denominator);
  const sine = Math.sqrt(Math.max(0, 1 - cosine * cosine));
  const phi = 2 * Math.PI * point[0];
  return vec3(sine * Math.cos(phi), sine * Math.sin(phi), cosine);
}

function reflectIncident(incident: IblVec3, normal: IblVec3): IblVec3 {
  const scale = 2 * dot(normal, incident);
  return direction(
    vec3(
      normal[0] * scale - incident[0],
      normal[1] * scale - incident[1],
      normal[2] * scale - incident[2],
    ),
    'IBL reflected direction',
  );
}

export function radicalInverseVdc(index: number): number {
  finite(index, 'IBL radical-inverse index');
  if (!Number.isInteger(index) || index < 0 || index > 0xffff_ffff) {
    invalid('IBL radical-inverse index must be an unsigned 32-bit integer.');
  }
  let bits = index >>> 0;
  bits = ((bits << 16) | (bits >>> 16)) >>> 0;
  bits = (((bits & 0x5555_5555) << 1) | ((bits & 0xaaaa_aaaa) >>> 1)) >>> 0;
  bits = (((bits & 0x3333_3333) << 2) | ((bits & 0xcccc_cccc) >>> 2)) >>> 0;
  bits = (((bits & 0x0f0f_0f0f) << 4) | ((bits & 0xf0f0_f0f0) >>> 4)) >>> 0;
  bits = (((bits & 0x00ff_00ff) << 8) | ((bits & 0xff00_ff00) >>> 8)) >>> 0;
  return bits * 2.3283064365386963e-10;
}

export function hammersley2d(index: number, sampleCount: number): IblVec2 {
  const count = referenceSampleCount(sampleCount);
  finite(index, 'IBL Hammersley index');
  if (!Number.isInteger(index) || index < 0 || index >= count) {
    invalid('IBL Hammersley index must be an integer within the sample count.');
  }
  return Object.freeze([index / count, radicalInverseVdc(index)]);
}

export function sampleDeterministicIblEnvironment(sampleDirection: readonly number[]): IblVec3 {
  const normalized = direction(sampleDirection, 'IBL environment direction');
  const x = normalized[0];
  const y = normalized[1];
  const z = normalized[2];
  return vec3(
    0.16 + 0.26 * (0.5 + 0.5 * x) + 0.12 * y * y,
    0.12 + 0.32 * (0.5 + 0.5 * y) + 0.08 * z * z,
    0.1 + 0.38 * (0.5 + 0.5 * z) + 0.06 * x * y,
  );
}

export function convolveDiffuseIrradiance(
  surfaceNormal: readonly number[],
  environment: IblEnvironmentSampler,
  sampleCount = IBL_REFERENCE_SAMPLE_COUNT,
): DiffuseIrradianceReference {
  const normal = direction(surfaceNormal, 'IBL diffuse normal');
  const count = referenceSampleCount(sampleCount);
  const [tangent, bitangent] = tangentFrame(normal);
  let accumulatedRed = 0;
  let accumulatedGreen = 0;
  let accumulatedBlue = 0;

  for (let index = 0; index < count; index += 1) {
    const local = sampleCosineHemisphere(hammersley2d(index, count));
    const sampledDirection = worldDirection(tangent, bitangent, normal, local);
    const sample = radiance(environment(sampledDirection), 'IBL environment radiance');
    accumulatedRed += sample[0];
    accumulatedGreen += sample[1];
    accumulatedBlue += sample[2];
  }

  const lambertianRadiance = vec3(
    accumulatedRed / count,
    accumulatedGreen / count,
    accumulatedBlue / count,
  );
  return Object.freeze({
    irradiance: vec3(
      lambertianRadiance[0] * Math.PI,
      lambertianRadiance[1] * Math.PI,
      lambertianRadiance[2] * Math.PI,
    ),
    lambertianRadiance,
    sampleCount: count,
  });
}

export function prefilterGgxSpecular(
  reflectionDirection: readonly number[],
  roughness: number,
  environment: IblEnvironmentSampler,
  sampleCount = IBL_REFERENCE_SAMPLE_COUNT,
): GgxSpecularPrefilterReference {
  const normal = direction(reflectionDirection, 'IBL specular direction');
  const normalizedRoughness = unit(roughness, 'IBL specular roughness');
  const count = referenceSampleCount(sampleCount);
  const [tangent, bitangent] = tangentFrame(normal);
  let accumulatedRed = 0;
  let accumulatedGreen = 0;
  let accumulatedBlue = 0;
  let sampleWeight = 0;

  for (let index = 0; index < count; index += 1) {
    const localHalf = sampleGgxHalfVector(hammersley2d(index, count), normalizedRoughness);
    const halfVector = worldDirection(tangent, bitangent, normal, localHalf);
    const light = reflectIncident(normal, halfVector);
    const nDotL = Math.max(dot(normal, light), 0);
    if (nDotL <= 0) continue;
    const sample = radiance(environment(light), 'IBL environment radiance');
    accumulatedRed += sample[0] * nDotL;
    accumulatedGreen += sample[1] * nDotL;
    accumulatedBlue += sample[2] * nDotL;
    sampleWeight += nDotL;
  }

  const inverseWeight = sampleWeight > 0 ? 1 / sampleWeight : 0;
  return Object.freeze({
    radiance: vec3(
      accumulatedRed * inverseWeight,
      accumulatedGreen * inverseWeight,
      accumulatedBlue * inverseWeight,
    ),
    roughness: normalizedRoughness,
    sampleCount: count,
    sampleWeight,
  });
}

export function integrateGgxBrdfLut(
  nDotV: number,
  roughness: number,
  sampleCount = IBL_REFERENCE_SAMPLE_COUNT,
): BrdfLutReference {
  const requestedNdotV = unit(nDotV, 'IBL BRDF LUT N dot V');
  const viewCosine = Math.max(requestedNdotV, PBR_MIN_ALPHA);
  const normalizedRoughness = unit(roughness, 'IBL BRDF LUT roughness');
  const count = referenceSampleCount(sampleCount);
  const alpha = perceptualRoughnessToAlpha(normalizedRoughness);
  const view = vec3(Math.sqrt(Math.max(0, 1 - viewCosine * viewCosine)), 0, viewCosine);
  let scale = 0;
  let bias = 0;

  for (let index = 0; index < count; index += 1) {
    const halfVector = sampleGgxHalfVector(hammersley2d(index, count), normalizedRoughness);
    const light = reflectIncident(view, halfVector);
    const nDotL = Math.max(light[2], 0);
    const nDotH = Math.max(halfVector[2], 0);
    const vDotH = Math.max(dot(view, halfVector), 0);
    if (nDotL <= 0 || nDotH <= 0 || vDotH <= 0) continue;

    const visibility = smithGgxVisibility(alpha, nDotL, viewCosine);
    const visibilityOverPdf = (4 * visibility * vDotH * nDotL) / nDotH;
    const grazingWeight = (1 - vDotH) ** 5;
    scale += (1 - grazingWeight) * visibilityOverPdf;
    bias += grazingWeight * visibilityOverPdf;
  }

  return Object.freeze({
    bias: bias / count,
    nDotV: requestedNdotV,
    roughness: normalizedRoughness,
    sampleCount: count,
    scale: scale / count,
  });
}

export function evaluateDeterministicIblReference(): DeterministicIblReference {
  return Object.freeze({
    brdfLut: integrateGgxBrdfLut(
      IBL_REFERENCE_INPUT.brdfLutNdotV,
      IBL_REFERENCE_INPUT.brdfLutRoughness,
    ),
    diffuse: convolveDiffuseIrradiance(
      IBL_REFERENCE_INPUT.diffuseNormal,
      sampleDeterministicIblEnvironment,
    ),
    specular: prefilterGgxSpecular(
      IBL_REFERENCE_INPUT.specularDirection,
      IBL_REFERENCE_INPUT.specularRoughness,
      sampleDeterministicIblEnvironment,
    ),
  });
}
