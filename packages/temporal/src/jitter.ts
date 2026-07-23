import { KyxosEngineError } from '@kyxos/render-core';

import { TEMPORAL_SAMPLE_LIMIT } from './convergence.js';

export const TEMPORAL_JITTER_SEQUENCE = 'halton-2-3' as const;

export type TemporalVec2 = readonly [x: number, y: number];

export interface TemporalJitterSample {
  /** One-based scheduler/accumulation index. */
  readonly sampleIndex: number;
  /** Centered subpixel offset: +X right and +Y down in raster space. */
  readonly rasterOffsetPixels: TemporalVec2;
  /** Original Halton point in the half-open unit square. */
  readonly unitSample: TemporalVec2;
}

export interface TemporalJitterNdc {
  readonly ndcOffset: TemporalVec2;
  readonly rasterOffsetPixels: TemporalVec2;
  readonly sampleIndex: number;
}

export interface TemporalViewportSize {
  readonly height: number;
  readonly width: number;
}

function assertSampleIndex(sampleIndex: number): void {
  if (
    !Number.isSafeInteger(sampleIndex) ||
    sampleIndex < TEMPORAL_SAMPLE_LIMIT.minimum ||
    sampleIndex > TEMPORAL_SAMPLE_LIMIT.maximum
  ) {
    throw new KyxosEngineError(
      `Jitter sampleIndex must be a safe integer from ${TEMPORAL_SAMPLE_LIMIT.minimum} through ${TEMPORAL_SAMPLE_LIMIT.maximum}.`,
      {
        code: 'INVALID_ARGUMENT',
        module: 'temporal',
        recoverable: false,
      },
    );
  }
}

function assertViewportDimension(name: 'height' | 'width', value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new KyxosEngineError(`Temporal viewport ${name} must be a positive safe integer.`, {
      code: 'INVALID_ARGUMENT',
      module: 'temporal',
      recoverable: false,
    });
  }
}

export function radicalInverse(index: number, base: number): number {
  assertSampleIndex(index);
  if (!Number.isSafeInteger(base) || base < 2 || base > 65_536) {
    throw new KyxosEngineError(
      'Radical-inverse base must be a safe integer from 2 through 65536.',
      {
        code: 'INVALID_ARGUMENT',
        module: 'temporal',
        recoverable: false,
      },
    );
  }

  let fraction = 1 / base;
  let result = 0;
  let remaining = index;
  while (remaining > 0) {
    result += (remaining % base) * fraction;
    remaining = Math.floor(remaining / base);
    fraction /= base;
  }
  return result;
}

export function createTemporalJitterSample(sampleIndex: number): TemporalJitterSample {
  assertSampleIndex(sampleIndex);
  const unitSample = Object.freeze([
    radicalInverse(sampleIndex, 2),
    radicalInverse(sampleIndex, 3),
  ]) as TemporalVec2;
  const rasterOffsetPixels = Object.freeze([
    unitSample[0] - 0.5,
    unitSample[1] - 0.5,
  ]) as TemporalVec2;
  return Object.freeze({ rasterOffsetPixels, sampleIndex, unitSample });
}

export function createTemporalJitterSequence(sampleCount: number): readonly TemporalJitterSample[] {
  if (
    !Number.isSafeInteger(sampleCount) ||
    sampleCount < TEMPORAL_SAMPLE_LIMIT.minimum ||
    sampleCount > TEMPORAL_SAMPLE_LIMIT.maximum
  ) {
    throw new KyxosEngineError(
      `Jitter sampleCount must be a safe integer from ${TEMPORAL_SAMPLE_LIMIT.minimum} through ${TEMPORAL_SAMPLE_LIMIT.maximum}.`,
      {
        code: 'INVALID_ARGUMENT',
        module: 'temporal',
        recoverable: false,
      },
    );
  }
  return Object.freeze(
    Array.from({ length: sampleCount }, (_, index) => createTemporalJitterSample(index + 1)),
  );
}

/** Converts top-left raster offsets into the engine's canonical NDC (+Y up). */
export function temporalJitterToNdc(
  sample: TemporalJitterSample,
  viewport: TemporalViewportSize,
): TemporalJitterNdc {
  assertSampleIndex(sample.sampleIndex);
  assertViewportDimension('width', viewport.width);
  assertViewportDimension('height', viewport.height);
  const [x, y] = sample.rasterOffsetPixels;
  const [unitX, unitY] = sample.unitSample;
  if (
    ![unitX, unitY].every(Number.isFinite) ||
    unitX < 0 ||
    unitX >= 1 ||
    unitY < 0 ||
    unitY >= 1 ||
    ![x, y].every(Number.isFinite) ||
    x !== unitX - 0.5 ||
    y !== unitY - 0.5
  ) {
    throw new KyxosEngineError('Raster jitter offsets must be finite and within half a pixel.', {
      code: 'INVALID_ARGUMENT',
      module: 'temporal',
      recoverable: false,
    });
  }
  return Object.freeze({
    ndcOffset: Object.freeze([
      (2 * x) / viewport.width,
      (-2 * y) / viewport.height,
    ]) as TemporalVec2,
    rasterOffsetPixels: sample.rasterOffsetPixels,
    sampleIndex: sample.sampleIndex,
  });
}
