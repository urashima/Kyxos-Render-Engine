import { KyxosEngineError } from '@kyxos/render-core';
import { TEMPORAL_TAA_DEFAULT_OPTIONS } from '@kyxos/render-temporal';

import type { TemporalTaaResolveOptions } from '@kyxos/render-temporal';

export interface TemporalTaaSettingsDescriptor extends Partial<TemporalTaaResolveOptions> {
  /** Scales the centered Halton raster offset. 0 disables projection jitter; 1 uses the full sequence. */
  readonly jitterScale?: number;
  /** Constant responsive mask applied when no larger per-frame mask is supplied. */
  readonly responsiveMask?: number;
}

export interface TemporalTaaSettings {
  readonly jitterScale: number;
  readonly resolve: TemporalTaaResolveOptions;
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

function cosine(value: number): number {
  finite(value, 'TAA Normal rejection cosine');
  if (value < -1 || value > 1) {
    invalid('TAA Normal rejection cosine must be from -1 through 1.');
  }
  return value;
}

export const TEMPORAL_TAA_DEFAULT_SETTINGS: TemporalTaaSettings = Object.freeze({
  jitterScale: 1,
  resolve: TEMPORAL_TAA_DEFAULT_OPTIONS,
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
    normalRejectionCosine: cosine(
      descriptor.normalRejectionCosine ?? base.resolve.normalRejectionCosine,
    ),
    responsiveHistoryReduction: unit(
      descriptor.responsiveHistoryReduction ?? base.resolve.responsiveHistoryReduction,
      'TAA responsive History reduction',
    ),
  });
  return Object.freeze({
    jitterScale: unit(descriptor.jitterScale ?? base.jitterScale, 'TAA jitter scale'),
    resolve,
    responsiveMask: unit(descriptor.responsiveMask ?? base.responsiveMask, 'TAA responsive mask'),
  });
}
