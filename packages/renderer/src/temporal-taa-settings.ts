import { KyxosEngineError } from '@kyxos/render-core';
import { TEMPORAL_TAA_DEFAULT_OPTIONS } from '@kyxos/render-temporal';

import type { TemporalTaaResolveOptions } from '@kyxos/render-temporal';

export interface TemporalTaaAdvancedResolveSettings {
  /** Enables closest-depth velocity selection near geometry edges. 0 preserves the accepted Phase 4 path. */
  readonly edgeDepthDifference: number;
  /** Pixel velocity where History is fully replaced by the current frame. */
  readonly maxVelocityLength: number;
  /** Lower bound for current-frame contribution after all History weighting. */
  readonly minimumCurrentWeight: number;
  /** Standard-deviation multiplier for variance clipping. 0 preserves min/max clamping. */
  readonly varianceClipGamma: number;
  /** Strength of subpixel-motion correction. */
  readonly subpixelCorrection: number;
  /** Strength of luminance-weighted HDR flicker suppression. */
  readonly flickerReduction: number;
}

export interface TemporalTaaResolveSettings
  extends TemporalTaaResolveOptions, TemporalTaaAdvancedResolveSettings {}

export interface TemporalTaaSettingsDescriptor extends Partial<TemporalTaaResolveSettings> {
  /** Scales the centered Halton raster offset. 0 disables projection jitter; 1 uses the full sequence. */
  readonly jitterScale?: number;
  /** Constant responsive mask applied when no larger per-frame mask is supplied. */
  readonly responsiveMask?: number;
}

export interface TemporalTaaSettings {
  readonly jitterScale: number;
  readonly resolve: TemporalTaaResolveSettings;
  readonly responsiveMask: number;
}

function invalid(message: string): never {
  throw new KyxosEngineError(message, {
    code: 'INVALID_ARGUMENT',
    module: 'renderer',
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

function nonNegative(value: number, label: string): number {
  finite(value, label);
  if (value < 0) invalid(`${label} must be non-negative.`);
  return value;
}

function positive(value: number, label: string): number {
  finite(value, label);
  if (value <= 0) invalid(`${label} must be greater than zero.`);
  return value;
}

function cosine(value: number): number {
  finite(value, 'TAA Normal rejection cosine');
  if (value < -1 || value > 1) {
    invalid('TAA Normal rejection cosine must be from -1 through 1.');
  }
  return value;
}

export const TEMPORAL_TAA_DEFAULT_SETTINGS: TemporalTaaSettings = Object.freeze({
  jitterScale: 1,
  resolve: Object.freeze({
    ...TEMPORAL_TAA_DEFAULT_OPTIONS,
    edgeDepthDifference: 0,
    flickerReduction: 0,
    maxVelocityLength: 128,
    minimumCurrentWeight: 0,
    subpixelCorrection: 0,
    varianceClipGamma: 0,
  }),
  responsiveMask: 0,
});

/** Creates an immutable, fully resolved Dynamic TAA tuning state. */
export function createTemporalTaaSettings(
  descriptor: TemporalTaaSettingsDescriptor = {},
  base: TemporalTaaSettings = TEMPORAL_TAA_DEFAULT_SETTINGS,
): TemporalTaaSettings {
  const resolve = Object.freeze({
    baseHistoryWeight: unit(
      descriptor.baseHistoryWeight ?? base.resolve.baseHistoryWeight,
      'TAA base History weight',
    ),
    depthAbsoluteThreshold: unit(
      descriptor.depthAbsoluteThreshold ?? base.resolve.depthAbsoluteThreshold,
      'TAA absolute Depth threshold',
    ),
    depthRelativeThreshold: unit(
      descriptor.depthRelativeThreshold ?? base.resolve.depthRelativeThreshold,
      'TAA relative Depth threshold',
    ),
    edgeDepthDifference: unit(
      descriptor.edgeDepthDifference ?? base.resolve.edgeDepthDifference,
      'TAA edge Depth difference',
    ),
    flickerReduction: unit(
      descriptor.flickerReduction ?? base.resolve.flickerReduction,
      'TAA flicker reduction',
    ),
    maxVelocityLength: positive(
      descriptor.maxVelocityLength ?? base.resolve.maxVelocityLength,
      'TAA maximum Velocity length',
    ),
    minimumCurrentWeight: unit(
      descriptor.minimumCurrentWeight ?? base.resolve.minimumCurrentWeight,
      'TAA minimum current weight',
    ),
    normalRejectionCosine: cosine(
      descriptor.normalRejectionCosine ?? base.resolve.normalRejectionCosine,
    ),
    responsiveHistoryReduction: unit(
      descriptor.responsiveHistoryReduction ?? base.resolve.responsiveHistoryReduction,
      'TAA responsive History reduction',
    ),
    subpixelCorrection: unit(
      descriptor.subpixelCorrection ?? base.resolve.subpixelCorrection,
      'TAA subpixel correction',
    ),
    varianceClipGamma: nonNegative(
      descriptor.varianceClipGamma ?? base.resolve.varianceClipGamma,
      'TAA variance clip gamma',
    ),
  });
  return Object.freeze({
    jitterScale: unit(descriptor.jitterScale ?? base.jitterScale, 'TAA jitter scale'),
    resolve,
    responsiveMask: unit(descriptor.responsiveMask ?? base.responsiveMask, 'TAA responsive mask'),
  });
}
