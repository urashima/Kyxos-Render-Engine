import type {
  BackendResourceHandle,
  BackendSamplerHandle,
  BackendTextureHandle,
  GraphicsBackend,
} from '@kyxos/render-backend-api';
import { KyxosEngineError } from '@kyxos/render-core';
import type { Disposable, Unsubscribe } from '@kyxos/render-core';
import {
  type TemporalConvergenceOptions,
  type TemporalConvergenceSnapshot,
  TemporalConvergenceTracker,
  TemporalHistory,
  type TemporalHistoryInvalidationReason,
  type TemporalHistorySignature,
  type TemporalHistorySignatureDescriptor,
  type TemporalHistorySnapshot,
  createTemporalHistorySignature,
  temporalHistorySignaturesEqual,
} from '@kyxos/render-temporal';

const COLOR_BYTES_PER_TEXEL = 8;
const TARGET_COUNT = 2;

export interface StaticAccumulationGpuHistoryOptions extends TemporalConvergenceOptions {
  readonly height: number;
  readonly ownerId: string;
  readonly width: number;
}

export interface StaticAccumulationGpuHistorySize {
  readonly height: number;
  readonly width: number;
}

export interface StaticAccumulationGpuFrame {
  readonly historyValid: boolean;
  readonly ownerId: string;
  readonly previousSampleCount: number;
  readonly readColorTexture: BackendTextureHandle;
  readonly resourceGeneration: number;
  readonly sampler: BackendSamplerHandle;
  readonly size: StaticAccumulationGpuHistorySize;
  readonly writeColorTexture: BackendTextureHandle;
}

export interface StaticAccumulationGpuHistoryDiagnostics {
  readonly convergence: TemporalConvergenceSnapshot;
  readonly estimatedGpuBytes: number;
  readonly frameOpen: boolean;
  readonly history: TemporalHistorySnapshot;
  readonly ownerId: string;
  readonly resourceGeneration: number;
  readonly size: StaticAccumulationGpuHistorySize;
  readonly state: 'detached' | 'disposed' | 'ready';
}

interface StaticAccumulationGpuResources {
  readonly sampler: BackendSamplerHandle;
  readonly targetTextures: readonly [BackendTextureHandle, BackendTextureHandle];
}

function error(
  message: string,
  code: 'ALREADY_DISPOSED' | 'INVALID_ARGUMENT' | 'INVALID_STATE',
  recoverable = false,
): KyxosEngineError {
  return new KyxosEngineError(message, {
    code,
    module: 'renderer',
    recoverable,
  });
}

function validateExtent(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw error(`${name} must be a positive safe integer.`, 'INVALID_ARGUMENT');
  }
  return value;
}

function validateError(value: number | undefined): void {
  if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
    throw error(
      'Static accumulation convergence error must be finite and non-negative.',
      'INVALID_ARGUMENT',
    );
  }
}

/**
 * Owner-scoped Static Accumulation ping-pong resources and convergence transaction.
 * The Backend is caller-owned; all Texture and Sampler Handles are owned by this object.
 */
export class StaticAccumulationGpuHistory implements Disposable {
  readonly #convergence: TemporalConvergenceTracker;
  readonly #history: TemporalHistory;
  readonly #ownerId: string;
  #backend: GraphicsBackend | undefined;
  #disposed = false;
  #frameSignature: TemporalHistorySignature | undefined;
  #height: number;
  #readIndex: 0 | 1 = 0;
  #resourceGeneration = 0;
  #resources: StaticAccumulationGpuResources | undefined;
  #unsubscribeLost: Unsubscribe | undefined;
  #width: number;

  constructor(options: StaticAccumulationGpuHistoryOptions) {
    this.#history = new TemporalHistory({ kind: 'static', ownerId: options.ownerId });
    this.#ownerId = this.#history.snapshot().ownerId;
    this.#convergence = new TemporalConvergenceTracker({
      ...(options.errorThreshold === undefined ? {} : { errorThreshold: options.errorThreshold }),
      ...(options.minimumSamples === undefined ? {} : { minimumSamples: options.minimumSamples }),
      ...(options.stableSamples === undefined ? {} : { stableSamples: options.stableSamples }),
      targetSamples: options.targetSamples,
    });
    this.#width = validateExtent('Static Accumulation History width', options.width);
    this.#height = validateExtent('Static Accumulation History height', options.height);
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  initialize(backend: GraphicsBackend): void {
    this.#assertActive();
    if (backend.state !== 'ready') {
      throw error('Static Accumulation GPU History requires a ready Backend.', 'INVALID_STATE');
    }
    if (this.#backend === backend && this.#resources !== undefined) return;
    if (this.#backend !== undefined) {
      throw error(
        'Static Accumulation GPU History is already attached to another Backend.',
        'INVALID_STATE',
      );
    }

    const resources = this.#createResources(backend, this.#width, this.#height);
    this.#backend = backend;
    this.#resources = resources;
    this.#readIndex = 0;
    this.#resourceGeneration += 1;
    this.#unsubscribeLost = backend.on('lost', () => this.#onBackendLost(backend));
  }

  prepareFrame(signature: TemporalHistorySignatureDescriptor): StaticAccumulationGpuFrame {
    this.#assertActive();
    if (this.#frameSignature !== undefined) {
      throw error('Static Accumulation GPU History already has an open frame.', 'INVALID_STATE');
    }
    const backend = this.#backend;
    const resources = this.#resources;
    if (backend === undefined || backend.state !== 'ready' || resources === undefined) {
      throw error(
        'Static Accumulation GPU resources are unavailable until the Backend is restored.',
        'INVALID_STATE',
        true,
      );
    }

    const candidate = createTemporalHistorySignature(signature);
    const historySnapshot = this.#history.snapshot();
    if (
      historySnapshot.signature !== null &&
      !temporalHistorySignaturesEqual(historySnapshot.signature, candidate)
    ) {
      this.#convergence.reset();
    }
    const convergence = this.#convergence.snapshot();
    if (convergence.converged) {
      throw error(
        `Static Accumulation has converged by ${convergence.reason ?? 'policy'}.`,
        'INVALID_STATE',
      );
    }

    const historyValid = this.#history.isReusable(candidate);
    if (!historyValid) this.#readIndex = 0;
    this.#frameSignature = candidate;
    const writeIndex = this.#readIndex === 0 ? 1 : 0;
    return Object.freeze({
      historyValid,
      ownerId: this.#ownerId,
      previousSampleCount: historyValid ? historySnapshot.sampleCount : 0,
      readColorTexture: resources.targetTextures[this.#readIndex],
      resourceGeneration: this.#resourceGeneration,
      sampler: resources.sampler,
      size: this.#size(),
      writeColorTexture: resources.targetTextures[writeIndex],
    });
  }

  commitFrame(convergenceError?: number): StaticAccumulationGpuHistoryDiagnostics {
    this.#assertActive();
    validateError(convergenceError);
    const signature = this.#frameSignature;
    if (signature === undefined) {
      throw error(
        'Static Accumulation GPU History has no prepared frame to commit.',
        'INVALID_STATE',
      );
    }
    this.#frameSignature = undefined;
    const history = this.#history.recordSample(signature);
    const convergence = this.#convergence.recordSample(convergenceError);
    this.#readIndex = this.#readIndex === 0 ? 1 : 0;
    if (history.sampleCount !== convergence.sampleCount) {
      throw error('Static Accumulation History and convergence counts diverged.', 'INVALID_STATE');
    }
    return this.getDiagnostics();
  }

  cancelFrame(): void {
    this.#assertActive();
    this.#frameSignature = undefined;
  }

  invalidate(reason: TemporalHistoryInvalidationReason): StaticAccumulationGpuHistoryDiagnostics {
    this.#assertActive();
    this.#frameSignature = undefined;
    this.#readIndex = 0;
    this.#history.invalidate(reason);
    this.#convergence.reset();
    return this.getDiagnostics();
  }

  resize(width: number, height: number): StaticAccumulationGpuHistoryDiagnostics {
    this.#assertActive();
    const nextWidth = validateExtent('Static Accumulation History width', width);
    const nextHeight = validateExtent('Static Accumulation History height', height);
    if (this.#frameSignature !== undefined) {
      throw error(
        'Cannot resize Static Accumulation GPU History during an open frame.',
        'INVALID_STATE',
      );
    }
    if (nextWidth === this.#width && nextHeight === this.#height) return this.getDiagnostics();

    const backend = this.#backend;
    const previous = this.#resources;
    let replacement: StaticAccumulationGpuResources | undefined;
    if (backend !== undefined) {
      if (backend.state !== 'ready' || previous === undefined) {
        throw error('Static Accumulation GPU History Backend is not ready.', 'INVALID_STATE', true);
      }
      replacement = this.#createResources(backend, nextWidth, nextHeight);
    }

    this.#width = nextWidth;
    this.#height = nextHeight;
    this.#resources = replacement;
    this.#readIndex = 0;
    if (replacement !== undefined) this.#resourceGeneration += 1;
    this.#history.invalidate('viewport');
    this.#convergence.reset();

    if (backend !== undefined && previous !== undefined) {
      const errors = this.#destroyResources(backend, previous);
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) {
        throw new AggregateError(errors, 'Static Accumulation GPU History resize cleanup failed.');
      }
    }
    return this.getDiagnostics();
  }

  getAccumulatedColorTexture(): BackendTextureHandle {
    this.#assertActive();
    const backend = this.#backend;
    const resources = this.#resources;
    if (backend === undefined || backend.state !== 'ready' || resources === undefined) {
      throw error(
        'Static Accumulation GPU resources are unavailable until the Backend is restored.',
        'INVALID_STATE',
        true,
      );
    }
    if (!this.#history.snapshot().valid) {
      throw error('Static Accumulation History has no committed Color.', 'INVALID_STATE');
    }
    return resources.targetTextures[this.#readIndex];
  }

  getDiagnostics(): StaticAccumulationGpuHistoryDiagnostics {
    return Object.freeze({
      convergence: this.#convergence.snapshot(),
      estimatedGpuBytes: this.#width * this.#height * COLOR_BYTES_PER_TEXEL * TARGET_COUNT,
      frameOpen: this.#frameSignature !== undefined,
      history: this.#history.snapshot(),
      ownerId: this.#ownerId,
      resourceGeneration: this.#resourceGeneration,
      size: this.#size(),
      state: this.#disposed ? 'disposed' : this.#resources === undefined ? 'detached' : 'ready',
    });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#frameSignature = undefined;
    this.#unsubscribeLost?.();
    this.#unsubscribeLost = undefined;
    const backend = this.#backend;
    const resources = this.#resources;
    this.#backend = undefined;
    this.#resources = undefined;
    this.#history.dispose();
    this.#convergence.reset();
    const errors =
      backend === undefined || resources === undefined
        ? []
        : this.#destroyResources(backend, resources);
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(errors, 'Static Accumulation GPU History disposal failed.');
    }
  }

  #createResources(
    backend: GraphicsBackend,
    width: number,
    height: number,
  ): StaticAccumulationGpuResources {
    const created: BackendResourceHandle[] = [];
    try {
      const createTexture = (index: 0 | 1): BackendTextureHandle => {
        const texture = backend.createTexture({
          format: 'rgba16float',
          label: `static-accumulation-${this.#ownerId}-${index}-color`,
          size: { height, width },
          usage: ['render-attachment', 'sampled'],
        });
        created.push(texture);
        return texture;
      };
      const first = createTexture(0);
      const second = createTexture(1);
      const sampler = backend.createSampler({
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
        addressModeW: 'clamp-to-edge',
        label: `static-accumulation-${this.#ownerId}-sampler`,
        magFilter: 'linear',
        minFilter: 'linear',
        mipmapFilter: 'nearest',
      });
      created.push(sampler);
      return Object.freeze({
        sampler,
        targetTextures: Object.freeze([first, second] as const),
      });
    } catch (cause) {
      const cleanupErrors = this.#destroyHandles(backend, created.reverse());
      if (cleanupErrors.length > 0) {
        throw new AggregateError(
          [cause, ...cleanupErrors],
          'Static Accumulation GPU History resource creation failed.',
          { cause },
        );
      }
      throw cause;
    }
  }

  #destroyResources(
    backend: GraphicsBackend,
    resources: StaticAccumulationGpuResources,
  ): unknown[] {
    const [first, second] = resources.targetTextures;
    return this.#destroyHandles(backend, [resources.sampler, second, first]);
  }

  #destroyHandles(backend: GraphicsBackend, handles: readonly BackendResourceHandle[]): unknown[] {
    const errors: unknown[] = [];
    for (const handle of handles) {
      try {
        backend.destroyResource(handle);
      } catch (cause) {
        errors.push(cause);
      }
    }
    return errors;
  }

  #onBackendLost(backend: GraphicsBackend): void {
    if (backend !== this.#backend || this.#disposed) return;
    this.#unsubscribeLost?.();
    this.#unsubscribeLost = undefined;
    this.#backend = undefined;
    this.#resources = undefined;
    this.#frameSignature = undefined;
    this.#history.invalidate('device');
    this.#convergence.reset();
  }

  #size(): StaticAccumulationGpuHistorySize {
    return Object.freeze({ height: this.#height, width: this.#width });
  }

  #assertActive(): void {
    if (this.#disposed) {
      throw error('Static Accumulation GPU History is disposed.', 'ALREADY_DISPOSED');
    }
  }
}
