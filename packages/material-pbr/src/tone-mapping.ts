import { KyxosEngineError } from '@kyxos/render-core';
import { linearChannelToSrgb } from '@kyxos/render-material-core';

import type { BrdfRgb } from './brdf.js';

export const PBR_TONE_MAPPING_MODES = ['khronos-pbr-neutral', 'none'] as const;
export const PBR_EXPOSURE_EV_RANGE = Object.freeze([-32, 32] as const);

export type PbrToneMappingMode = (typeof PBR_TONE_MAPPING_MODES)[number];

export interface PbrOutputTransformDescriptor {
  /** Camera exposure in stops; one EV doubles linear scene radiance. */
  readonly exposure?: number;
  /** `none` clips to the display-linear range before the sRGB transfer function. */
  readonly toneMapping?: PbrToneMappingMode;
}

export interface PbrOutputTransform {
  readonly exposure: number;
  readonly exposureMultiplier: number;
  readonly toneMapping: PbrToneMappingMode;
}

export interface PbrOutputTransformResult {
  readonly exposed: BrdfRgb;
  readonly linearHdr: BrdfRgb;
  readonly srgb: BrdfRgb;
  readonly toneMapped: BrdfRgb;
  readonly transform: PbrOutputTransform;
}

function invalid(message: string): never {
  throw new KyxosEngineError(message, {
    code: 'INVALID_ARGUMENT',
    module: 'material',
    recoverable: false,
  });
}

function linearRgb(value: readonly number[], label: string): BrdfRgb {
  if (value.length !== 3) invalid(`${label} must contain three channels.`);
  return Object.freeze(
    value.map((channel, index) => {
      if (!Number.isFinite(channel) || channel < 0) {
        invalid(`${label} channel ${index} must be finite and nonnegative.`);
      }
      return channel;
    }),
  ) as unknown as BrdfRgb;
}

export function createPbrOutputTransform(
  descriptor: PbrOutputTransformDescriptor = {},
): PbrOutputTransform {
  const exposure = descriptor.exposure ?? 0;
  if (
    !Number.isFinite(exposure) ||
    exposure < PBR_EXPOSURE_EV_RANGE[0] ||
    exposure > PBR_EXPOSURE_EV_RANGE[1]
  ) {
    invalid(
      `PBR exposure must be finite and within ${PBR_EXPOSURE_EV_RANGE[0]} through ${PBR_EXPOSURE_EV_RANGE[1]} EV.`,
    );
  }
  const toneMapping = descriptor.toneMapping ?? 'khronos-pbr-neutral';
  if (!PBR_TONE_MAPPING_MODES.includes(toneMapping)) {
    invalid(`Unsupported PBR tone-mapping mode: ${String(toneMapping)}.`);
  }
  return Object.freeze({
    exposure,
    exposureMultiplier: 2 ** exposure,
    toneMapping,
  });
}

/** Khronos PBR Neutral reference curve. Input and output are linear Rec.709 RGB. */
export function khronosPbrNeutralToneMap(linearHdr: BrdfRgb): BrdfRgb {
  const color = linearRgb(linearHdr, 'PBR Neutral input');
  const minimum = Math.min(...color);
  const offset = minimum < 0.08 ? minimum - 6.25 * minimum * minimum : 0.04;
  const shifted = color.map((channel) => channel - offset) as [number, number, number];
  const peak = Math.max(...shifted);
  const startCompression = 0.76;
  if (peak < startCompression) return Object.freeze(shifted);

  const compressionDistance = 1 - startCompression;
  const newPeak =
    1 -
    (compressionDistance * compressionDistance) / (peak + compressionDistance - startCompression);
  const scaled = shifted.map((channel) => channel * (newPeak / peak));
  const desaturation = 1 - 1 / (0.15 * (peak - newPeak) + 1);
  return Object.freeze(
    scaled.map((channel) => channel * (1 - desaturation) + newPeak * desaturation),
  ) as unknown as BrdfRgb;
}

/** Deterministic CPU oracle for the Renderer display transform. */
export function evaluatePbrOutputTransform(
  linearHdr: BrdfRgb,
  descriptor: PbrOutputTransformDescriptor = {},
): PbrOutputTransformResult {
  const input = linearRgb(linearHdr, 'PBR output input');
  const transform = createPbrOutputTransform(descriptor);
  const exposed = Object.freeze(
    input.map((channel) => channel * transform.exposureMultiplier),
  ) as unknown as BrdfRgb;
  const toneMapped =
    transform.toneMapping === 'khronos-pbr-neutral'
      ? khronosPbrNeutralToneMap(exposed)
      : (Object.freeze(exposed.map((channel) => Math.min(channel, 1))) as unknown as BrdfRgb);
  const srgb = Object.freeze(
    toneMapped.map((channel) => linearChannelToSrgb(Math.min(Math.max(channel, 0), 1))),
  ) as unknown as BrdfRgb;
  return Object.freeze({ exposed, linearHdr: input, srgb, toneMapped, transform });
}
