import type {
  BackendResourceHandle,
  BackendSamplerHandle,
  BackendTextureHandle,
  GraphicsBackend,
} from '@kyxos/render-backend-api';
import { KyxosEngineError } from '@kyxos/render-core';
import type { Disposable, Unsubscribe } from '@kyxos/render-core';
import {
  TemporalHistory,
  type TemporalHistoryInvalidationReason,
  type TemporalHistorySignature,
  type TemporalHistorySignatureDescriptor,
  type TemporalHistorySnapshot,
  createTemporalHistorySignature,
} from '@kyxos/render-temporal';

const RGBA16FLOAT_BYTES_PER_TEXEL = 8;
const HISTORY_TEXTURE_COUNT = 2;

export interface DynamicTaaGpuHistoryOptions {
  readonly height: number;
  readonly ownerId: string;
  readonly width: number;
}

export interface DynamicTaaGpuHistorySize {
  readonly height: number;
  readonly width: number;
}

export interface DynamicTaaGpuFrame {
  readonly historyValid: boolean;
  readonly ownerId: string;
  readonly readTexture: BackendTextureHandle;
  readonly resourceGeneration: number;
  readonly sampler: BackendSamplerHandle;
  readonly size: DynamicTaaGpuHistorySize;
  readonly writeTexture: BackendTextureHandle;
}

export interface DynamicTaaGpuHistoryDiagnostics {
  readonly estimatedGpuBytes: number;
  readonly frameOpen: boolean;
  readonly history: TemporalHistorySnapshot;
  readonly ownerId: string;
  readonly resourceGeneration: number;
  readonly size: DynamicTaaGpuHistorySize;
  readonly state: 'detached' | 'disposed' | 'ready';
}

interface DynamicTaaGpuResources {
  readonly sampler: BackendSamplerHandle;
  readonly textures: readonly [BackendTextureHandle, BackendTextureHandle];
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

/**
 * Owner-scoped Dynamic TAA ping-pong resources.
 * The Backend is caller-owned; all Texture and Sampler Handles are owned by this object.
 */
export class DynamicTaaGpuHistory implements Disposable {
  readonly #history: TemporalHistory;
  readonly #ownerId: string;
  #backend: GraphicsBackend | undefined;
  #disposed = false;
  #frameSignature: TemporalHistorySignature | undefined;
  #height: number;
  #readIndex: 0 | 1 = 0;
  #resourceGeneration = 0;
  #resources: DynamicTaaGpuResources | undefined;
  #unsubscribeLost: Unsubscribe | undefined;
  #width: number;

  constructor(options: DynamicTaaGpuHistoryOptions) {
    this.#history = new TemporalHistory({ kind: 'dynamic', ownerId: options.ownerId });
    this.#ownerId = this.#history.snapshot().ownerId;
    this.#width = validateExtent('Dynamic TAA History width', options.width);
    this.#height = validateExtent('Dynamic TAA History height', options.height);
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  initialize(backend: GraphicsBackend): void {
    this.#assertActive();
    if (backend.state !== 'ready') {
      throw error('Dynamic TAA GPU History requires a ready Backend.', 'INVALID_STATE');
    }
    if (this.#backend === backend && this.#resources !== undefined) return;
    if (this.#backend !== undefined) {
      throw error(
        'Dynamic TAA GPU History is already attached to another Backend.',
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

  prepareFrame(signature: TemporalHistorySignatureDescriptor): DynamicTaaGpuFrame {
    this.#assertActive();
    if (this.#frameSignature !== undefined) {
      throw error('Dynamic TAA GPU History already has an open frame.', 'INVALID_STATE');
    }
    const backend = this.#backend;
    const resources = this.#resources;
    if (backend === undefined || backend.state !== 'ready' || resources === undefined) {
      throw error(
        'Dynamic TAA GPU resources are unavailable until the Backend is restored.',
        'INVALID_STATE',
        true,
      );
    }

    const candidate = createTemporalHistorySignature(signature);
    const historyValid = this.#history.isReusable(candidate);
    this.#frameSignature = candidate;
    const writeIndex = this.#readIndex === 0 ? 1 : 0;
    return Object.freeze({
      historyValid,
      ownerId: this.#ownerId,
      readTexture: resources.textures[this.#readIndex],
      resourceGeneration: this.#resourceGeneration,
      sampler: resources.sampler,
      size: this.#size(),
      writeTexture: resources.textures[writeIndex],
    });
  }

  commitFrame(): DynamicTaaGpuHistoryDiagnostics {
    this.#assertActive();
    const signature = this.#frameSignature;
    if (signature === undefined) {
      throw error('Dynamic TAA GPU History has no prepared frame to commit.', 'INVALID_STATE');
    }
    this.#frameSignature = undefined;
    this.#history.recordSample(signature);
    this.#readIndex = this.#readIndex === 0 ? 1 : 0;
    return this.getDiagnostics();
  }

  cancelFrame(): void {
    this.#assertActive();
    this.#frameSignature = undefined;
  }

  invalidate(reason: TemporalHistoryInvalidationReason): DynamicTaaGpuHistoryDiagnostics {
    this.#assertActive();
    this.#frameSignature = undefined;
    this.#history.invalidate(reason);
    return this.getDiagnostics();
  }

  resize(width: number, height: number): DynamicTaaGpuHistoryDiagnostics {
    this.#assertActive();
    const nextWidth = validateExtent('Dynamic TAA History width', width);
    const nextHeight = validateExtent('Dynamic TAA History height', height);
    if (this.#frameSignature !== undefined) {
      throw error('Cannot resize Dynamic TAA GPU History during an open frame.', 'INVALID_STATE');
    }
    if (nextWidth === this.#width && nextHeight === this.#height) return this.getDiagnostics();

    const backend = this.#backend;
    const previous = this.#resources;
    let replacement: DynamicTaaGpuResources | undefined;
    if (backend !== undefined) {
      if (backend.state !== 'ready' || previous === undefined) {
        throw error('Dynamic TAA GPU History Backend is not ready.', 'INVALID_STATE', true);
      }
      replacement = this.#createResources(backend, nextWidth, nextHeight);
    }

    this.#width = nextWidth;
    this.#height = nextHeight;
    this.#resources = replacement;
    this.#readIndex = 0;
    if (replacement !== undefined) this.#resourceGeneration += 1;
    this.#history.invalidate('viewport');

    if (backend !== undefined && previous !== undefined) {
      const errors = this.#destroyResources(backend, previous);
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) {
        throw new AggregateError(errors, 'Dynamic TAA GPU History resize cleanup failed.');
      }
    }
    return this.getDiagnostics();
  }

  getDiagnostics(): DynamicTaaGpuHistoryDiagnostics {
    return Object.freeze({
      estimatedGpuBytes:
        this.#width * this.#height * RGBA16FLOAT_BYTES_PER_TEXEL * HISTORY_TEXTURE_COUNT,
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
    const errors =
      backend === undefined || resources === undefined
        ? []
        : this.#destroyResources(backend, resources);
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(errors, 'Dynamic TAA GPU History disposal failed.');
    }
  }

  #createResources(
    backend: GraphicsBackend,
    width: number,
    height: number,
  ): DynamicTaaGpuResources {
    const created: BackendResourceHandle[] = [];
    try {
      const first = backend.createTexture({
        format: 'rgba16float',
        label: `taa-history-${this.#ownerId}-0`,
        size: { height, width },
        usage: ['render-attachment', 'sampled'],
      });
      created.push(first);
      const second = backend.createTexture({
        format: 'rgba16float',
        label: `taa-history-${this.#ownerId}-1`,
        size: { height, width },
        usage: ['render-attachment', 'sampled'],
      });
      created.push(second);
      const sampler = backend.createSampler({
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
        addressModeW: 'clamp-to-edge',
        label: `taa-history-${this.#ownerId}-sampler`,
        magFilter: 'linear',
        minFilter: 'linear',
        mipmapFilter: 'nearest',
      });
      created.push(sampler);
      return Object.freeze({ sampler, textures: Object.freeze([first, second] as const) });
    } catch (cause) {
      const cleanupErrors = this.#destroyHandles(backend, created.reverse());
      if (cleanupErrors.length > 0) {
        throw new AggregateError(
          [cause, ...cleanupErrors],
          'Dynamic TAA GPU History resource creation failed.',
          { cause },
        );
      }
      throw cause;
    }
  }

  #destroyResources(backend: GraphicsBackend, resources: DynamicTaaGpuResources): unknown[] {
    return this.#destroyHandles(backend, [
      resources.sampler,
      resources.textures[1],
      resources.textures[0],
    ]);
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
  }

  #size(): DynamicTaaGpuHistorySize {
    return Object.freeze({ height: this.#height, width: this.#width });
  }

  #assertActive(): void {
    if (this.#disposed) {
      throw error('Dynamic TAA GPU History is disposed.', 'ALREADY_DISPOSED');
    }
  }
}
