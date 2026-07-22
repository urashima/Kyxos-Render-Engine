import { KyxosEngineError } from '@kyxos/render-core';
import type { Disposable } from '@kyxos/render-core';

import { createTemporalHistorySignature, temporalHistorySignaturesEqual } from './signature.js';
import type { TemporalHistorySignature, TemporalHistorySignatureDescriptor } from './signature.js';

export const TEMPORAL_HISTORY_KINDS = ['dynamic', 'static'] as const;
export type TemporalHistoryKind = (typeof TEMPORAL_HISTORY_KINDS)[number];

export const TEMPORAL_HISTORY_INVALIDATION_REASONS = [
  'accumulation',
  'animation',
  'camera',
  'device',
  'disposed',
  'environment',
  'geometry',
  'light',
  'material',
  'post-process',
  'signature-mismatch',
  'texture',
  'transform',
  'viewport',
] as const;

export type TemporalHistoryInvalidationReason =
  (typeof TEMPORAL_HISTORY_INVALIDATION_REASONS)[number];

export interface TemporalHistoryOptions {
  readonly kind: TemporalHistoryKind;
  readonly ownerId: string;
}

export interface TemporalHistorySnapshot {
  readonly disposed: boolean;
  readonly generation: number;
  readonly kind: TemporalHistoryKind;
  readonly lastInvalidation: TemporalHistoryInvalidationReason | null;
  readonly ownerId: string;
  readonly sampleCount: number;
  readonly signature: TemporalHistorySignature | null;
  readonly valid: boolean;
}

/** CPU-side validity contract; GPU history resources remain owned by their Render Feature. */
export class TemporalHistory implements Disposable {
  readonly #kind: TemporalHistoryKind;
  readonly #ownerId: string;
  #disposed = false;
  #generation = 0;
  #lastInvalidation: TemporalHistoryInvalidationReason | null = null;
  #sampleCount = 0;
  #signature: TemporalHistorySignature | undefined;

  constructor(options: TemporalHistoryOptions) {
    const ownerId = options.ownerId.trim();
    if (ownerId.length === 0) {
      throw new KyxosEngineError('Temporal history ownerId must not be empty.', {
        code: 'INVALID_ARGUMENT',
        module: 'temporal',
        recoverable: false,
      });
    }
    if (!(TEMPORAL_HISTORY_KINDS as readonly string[]).includes(options.kind)) {
      throw new KyxosEngineError(`Unsupported temporal history kind "${String(options.kind)}".`, {
        code: 'INVALID_ARGUMENT',
        module: 'temporal',
        recoverable: false,
      });
    }

    this.#kind = options.kind;
    this.#ownerId = ownerId;
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  invalidate(reason: TemporalHistoryInvalidationReason): TemporalHistorySnapshot {
    this.#assertActive();
    this.#reset(reason);
    return this.snapshot();
  }

  isReusable(signature: TemporalHistorySignatureDescriptor): boolean {
    if (this.#disposed || this.#signature === undefined || this.#sampleCount === 0) return false;
    const candidate = createTemporalHistorySignature(signature);
    return temporalHistorySignaturesEqual(this.#signature, candidate);
  }

  recordSample(signature: TemporalHistorySignatureDescriptor): TemporalHistorySnapshot {
    this.#assertActive();
    const candidate = createTemporalHistorySignature(signature);
    if (
      this.#signature !== undefined &&
      !temporalHistorySignaturesEqual(this.#signature, candidate)
    ) {
      this.#reset('signature-mismatch');
    }

    this.#signature = candidate;
    this.#sampleCount += 1;
    return this.snapshot();
  }

  snapshot(): TemporalHistorySnapshot {
    return Object.freeze({
      disposed: this.#disposed,
      generation: this.#generation,
      kind: this.#kind,
      lastInvalidation: this.#lastInvalidation,
      ownerId: this.#ownerId,
      sampleCount: this.#sampleCount,
      signature: this.#signature ?? null,
      valid: !this.#disposed && this.#signature !== undefined && this.#sampleCount > 0,
    });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#reset('disposed');
    this.#disposed = true;
  }

  #assertActive(): void {
    if (this.#disposed) {
      throw new KyxosEngineError('Cannot mutate disposed temporal history.', {
        code: 'ALREADY_DISPOSED',
        module: 'temporal',
        recoverable: false,
      });
    }
  }

  #reset(reason: TemporalHistoryInvalidationReason): void {
    this.#generation += 1;
    this.#lastInvalidation = reason;
    this.#sampleCount = 0;
    this.#signature = undefined;
  }
}
