import { KyxosEngineError } from '@kyxos/render-core';

export const TEMPORAL_SAMPLE_LIMIT = Object.freeze({ maximum: 256, minimum: 1 });

export type TemporalConvergenceReason = 'error-threshold' | 'sample-limit';

export interface TemporalConvergenceOptions {
  readonly errorThreshold?: number;
  readonly minimumSamples?: number;
  readonly stableSamples?: number;
  readonly targetSamples: number;
}

export interface TemporalConvergenceSnapshot {
  readonly consecutiveStableSamples: number;
  readonly converged: boolean;
  readonly errorThreshold: number | null;
  readonly lastError: number | null;
  readonly minimumSamples: number;
  readonly reason: TemporalConvergenceReason | null;
  readonly sampleCount: number;
  readonly stableSamples: number;
  readonly targetSamples: number;
}

function assertSampleCount(name: string, value: number, maximum: number): void {
  if (!Number.isSafeInteger(value) || value < TEMPORAL_SAMPLE_LIMIT.minimum || value > maximum) {
    throw new KyxosEngineError(
      `${name} must be a safe integer from ${TEMPORAL_SAMPLE_LIMIT.minimum} through ${maximum}.`,
      {
        code: 'INVALID_ARGUMENT',
        module: 'temporal',
        recoverable: false,
      },
    );
  }
}

/** Deterministic fixed-sample/error-threshold convergence state without any GPU policy. */
export class TemporalConvergenceTracker {
  readonly #errorThreshold: number | undefined;
  readonly #minimumSamples: number;
  readonly #stableSamples: number;
  readonly #targetSamples: number;
  #consecutiveStableSamples = 0;
  #lastError: number | undefined;
  #reason: TemporalConvergenceReason | undefined;
  #sampleCount = 0;

  constructor(options: TemporalConvergenceOptions) {
    assertSampleCount('targetSamples', options.targetSamples, TEMPORAL_SAMPLE_LIMIT.maximum);
    const minimumSamples = options.minimumSamples ?? Math.min(4, options.targetSamples);
    const stableSamples = options.stableSamples ?? Math.min(2, options.targetSamples);
    assertSampleCount('minimumSamples', minimumSamples, options.targetSamples);
    assertSampleCount('stableSamples', stableSamples, options.targetSamples);
    if (
      options.errorThreshold !== undefined &&
      (!Number.isFinite(options.errorThreshold) || options.errorThreshold < 0)
    ) {
      throw new KyxosEngineError('errorThreshold must be a finite non-negative number.', {
        code: 'INVALID_ARGUMENT',
        module: 'temporal',
        recoverable: false,
      });
    }

    this.#errorThreshold = options.errorThreshold;
    this.#minimumSamples = minimumSamples;
    this.#stableSamples = stableSamples;
    this.#targetSamples = options.targetSamples;
  }

  recordSample(error?: number): TemporalConvergenceSnapshot {
    if (this.#reason !== undefined) return this.snapshot();
    if (error !== undefined && (!Number.isFinite(error) || error < 0)) {
      throw new KyxosEngineError('Convergence error must be a finite non-negative number.', {
        code: 'INVALID_ARGUMENT',
        module: 'temporal',
        recoverable: false,
      });
    }

    this.#sampleCount += 1;
    this.#lastError = error;
    this.#consecutiveStableSamples =
      error !== undefined && this.#errorThreshold !== undefined && error <= this.#errorThreshold
        ? this.#consecutiveStableSamples + 1
        : 0;

    if (
      this.#errorThreshold !== undefined &&
      this.#sampleCount >= this.#minimumSamples &&
      this.#consecutiveStableSamples >= this.#stableSamples
    ) {
      this.#reason = 'error-threshold';
    } else if (this.#sampleCount >= this.#targetSamples) {
      this.#reason = 'sample-limit';
    }

    return this.snapshot();
  }

  reset(): TemporalConvergenceSnapshot {
    this.#consecutiveStableSamples = 0;
    this.#lastError = undefined;
    this.#reason = undefined;
    this.#sampleCount = 0;
    return this.snapshot();
  }

  snapshot(): TemporalConvergenceSnapshot {
    return Object.freeze({
      consecutiveStableSamples: this.#consecutiveStableSamples,
      converged: this.#reason !== undefined,
      errorThreshold: this.#errorThreshold ?? null,
      lastError: this.#lastError ?? null,
      minimumSamples: this.#minimumSamples,
      reason: this.#reason ?? null,
      sampleCount: this.#sampleCount,
      stableSamples: this.#stableSamples,
      targetSamples: this.#targetSamples,
    });
  }
}
