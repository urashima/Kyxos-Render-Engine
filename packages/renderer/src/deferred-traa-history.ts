import type {
  BackendResourceHandle,
  BackendSamplerHandle,
  BackendTextureHandle,
  GraphicsBackend,
} from '@kyxos/render-backend-api';
import { KyxosEngineError } from '@kyxos/render-core';
import type { Disposable, Unsubscribe } from '@kyxos/render-core';

const HISTORY_SET_BYTES_PER_TEXEL = 8 + 4;
const HISTORY_SET_COUNT = 2;

export type DeferredTraaHistoryResetReason =
  'camera' | 'device-lost' | 'manual' | 'scene' | 'settings' | 'viewport';

export interface DeferredTraaHistoryOptions {
  readonly height: number;
  readonly ownerId: string;
  readonly width: number;
}

export interface DeferredTraaHistorySize {
  readonly height: number;
  readonly width: number;
}

export interface DeferredTraaHistoryPrepareInput {
  readonly historyGeneration: number;
  readonly reset?: boolean;
  readonly resetReason?: DeferredTraaHistoryResetReason;
}

export interface DeferredTraaHistoryFrame {
  readonly historyGeneration: number;
  readonly historyValid: boolean;
  readonly ownerId: string;
  readonly readColorTexture: BackendTextureHandle;
  readonly readDepthTexture: BackendTextureHandle;
  readonly resourceGeneration: number;
  readonly sampler: BackendSamplerHandle;
  readonly size: DeferredTraaHistorySize;
  readonly writeColorTexture: BackendTextureHandle;
  readonly writeDepthTexture: BackendTextureHandle;
}

export interface DeferredTraaResolvedFrame {
  readonly colorTexture: BackendTextureHandle;
  readonly depthTexture: BackendTextureHandle;
  readonly historyGeneration: number;
  readonly ownerId: string;
  readonly resourceGeneration: number;
  readonly size: DeferredTraaHistorySize;
}

export interface DeferredTraaHistoryDiagnostics {
  readonly estimatedGpuBytes: number;
  readonly frameOpen: boolean;
  readonly historyGeneration: number | null;
  readonly historyValid: boolean;
  readonly lastResetReason: DeferredTraaHistoryResetReason | null;
  readonly ownerId: string;
  readonly readIndex: 0 | 1;
  readonly resourceGeneration: number;
  readonly size: DeferredTraaHistorySize;
  readonly state: 'detached' | 'disposed' | 'ready';
}

interface DeferredTraaHistoryResources {
  readonly sampler: BackendSamplerHandle;
  readonly targetSets: readonly [DeferredTraaHistoryTargetSet, DeferredTraaHistoryTargetSet];
}

interface DeferredTraaHistoryTargetSet {
  readonly colorTexture: BackendTextureHandle;
  readonly depthTexture: BackendTextureHandle;
}

interface PreparedDeferredTraaHistoryFrame {
  readonly historyGeneration: number;
  readonly invalidated: boolean;
  readonly resetReason: DeferredTraaHistoryResetReason | null;
  readonly writeIndex: 0 | 1;
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

function validateGeneration(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw error(
      'Deferred TRAA History generation must be a non-negative safe integer.',
      'INVALID_ARGUMENT',
    );
  }
  return value;
}

function validateOwnerId(value: string): string {
  const ownerId = value.trim();
  if (ownerId.length === 0) {
    throw error('Deferred TRAA History ownerId must not be empty.', 'INVALID_ARGUMENT');
  }
  return ownerId;
}

/**
 * Independent linear-HDR Color/Depth ping-pong History for the Deferred TRAA path.
 *
 * The object owns only two Color/Depth sets and one sampler. It never imports or delegates to legacy
 * Dynamic TAA, Static Accumulation, TemporalHistory, or the legacy temporal transaction.
 */
export class DeferredTraaHistory implements Disposable {
  readonly #ownerId: string;
  #backend: GraphicsBackend | undefined;
  #disposed = false;
  #height: number;
  #historyGeneration: number | undefined;
  #historyValid = false;
  #lastResetReason: DeferredTraaHistoryResetReason | null = null;
  #prepared: PreparedDeferredTraaHistoryFrame | undefined;
  #readIndex: 0 | 1 = 0;
  #resourceGeneration = 0;
  #resources: DeferredTraaHistoryResources | undefined;
  #unsubscribeLost: Unsubscribe | undefined;
  #width: number;

  constructor(options: DeferredTraaHistoryOptions) {
    this.#ownerId = validateOwnerId(options.ownerId);
    this.#width = validateExtent('Deferred TRAA History width', options.width);
    this.#height = validateExtent('Deferred TRAA History height', options.height);
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  initialize(backend: GraphicsBackend): void {
    this.#assertActive();
    if (backend.state !== 'ready') {
      throw error('Deferred TRAA History requires a ready Backend.', 'INVALID_STATE');
    }
    if (backend === this.#backend && this.#resources !== undefined) return;
    if (this.#backend !== undefined) {
      throw error('Deferred TRAA History is already attached to another Backend.', 'INVALID_STATE');
    }

    const resources = this.#createResources(backend, this.#width, this.#height);
    this.#backend = backend;
    this.#resources = resources;
    this.#prepared = undefined;
    this.#readIndex = 0;
    this.#historyGeneration = undefined;
    this.#historyValid = false;
    this.#resourceGeneration += 1;
    this.#unsubscribeLost = backend.on('lost', () => this.#onBackendLost(backend));
  }

  prepareFrame(input: DeferredTraaHistoryPrepareInput): DeferredTraaHistoryFrame {
    this.#assertActive();
    if (this.#prepared !== undefined) {
      throw error('Deferred TRAA History already has an open frame.', 'INVALID_STATE');
    }
    const backend = this.#backend;
    const resources = this.#resources;
    if (backend === undefined || backend.state !== 'ready' || resources === undefined) {
      throw error(
        'Deferred TRAA History resources are unavailable until the Backend is restored.',
        'INVALID_STATE',
        true,
      );
    }

    const historyGeneration = validateGeneration(input.historyGeneration);
    const generationChanged =
      this.#historyGeneration !== undefined && this.#historyGeneration !== historyGeneration;
    const invalidated = input.reset === true || generationChanged || !this.#historyValid;
    const readIndex: 0 | 1 = invalidated ? 0 : this.#readIndex;
    const writeIndex: 0 | 1 = readIndex === 0 ? 1 : 0;
    const resetReason = invalidated
      ? (input.resetReason ?? (generationChanged ? 'scene' : (this.#lastResetReason ?? 'manual')))
      : null;
    this.#prepared = Object.freeze({
      historyGeneration,
      invalidated,
      resetReason,
      writeIndex,
    });

    const read = resources.targetSets[readIndex];
    const write = resources.targetSets[writeIndex];
    return Object.freeze({
      historyGeneration,
      historyValid: !invalidated,
      ownerId: this.#ownerId,
      readColorTexture: read.colorTexture,
      readDepthTexture: read.depthTexture,
      resourceGeneration: this.#resourceGeneration,
      sampler: resources.sampler,
      size: this.#size(),
      writeColorTexture: write.colorTexture,
      writeDepthTexture: write.depthTexture,
    });
  }

  commitFrame(): DeferredTraaHistoryDiagnostics {
    this.#assertActive();
    const prepared = this.#prepared;
    if (prepared === undefined) {
      throw error('Deferred TRAA History has no prepared frame to commit.', 'INVALID_STATE');
    }
    this.#prepared = undefined;
    this.#readIndex = prepared.writeIndex;
    this.#historyGeneration = prepared.historyGeneration;
    this.#historyValid = true;
    if (prepared.invalidated) this.#lastResetReason = prepared.resetReason;
    return this.getDiagnostics();
  }

  cancelFrame(): DeferredTraaHistoryDiagnostics {
    this.#assertActive();
    this.#prepared = undefined;
    return this.getDiagnostics();
  }

  acquireResolvedFrame(): DeferredTraaResolvedFrame {
    this.#assertActive();
    if (this.#prepared !== undefined) {
      throw error(
        'Deferred TRAA History cannot reuse History during an open frame.',
        'INVALID_STATE',
      );
    }
    const backend = this.#backend;
    const resources = this.#resources;
    const historyGeneration = this.#historyGeneration;
    if (
      backend === undefined ||
      backend.state !== 'ready' ||
      resources === undefined ||
      !this.#historyValid ||
      historyGeneration === undefined
    ) {
      throw error('Deferred TRAA resolved History is unavailable.', 'INVALID_STATE', true);
    }
    const resolved = resources.targetSets[this.#readIndex];
    return Object.freeze({
      colorTexture: resolved.colorTexture,
      depthTexture: resolved.depthTexture,
      historyGeneration,
      ownerId: this.#ownerId,
      resourceGeneration: this.#resourceGeneration,
      size: this.#size(),
    });
  }

  invalidate(reason: DeferredTraaHistoryResetReason): DeferredTraaHistoryDiagnostics {
    this.#assertActive();
    this.#prepared = undefined;
    this.#historyValid = false;
    this.#readIndex = 0;
    this.#lastResetReason = reason;
    return this.getDiagnostics();
  }

  resize(width: number, height: number): DeferredTraaHistoryDiagnostics {
    this.#assertActive();
    const nextWidth = validateExtent('Deferred TRAA History width', width);
    const nextHeight = validateExtent('Deferred TRAA History height', height);
    if (this.#prepared !== undefined) {
      throw error('Cannot resize Deferred TRAA History during an open frame.', 'INVALID_STATE');
    }
    if (nextWidth === this.#width && nextHeight === this.#height) return this.getDiagnostics();

    const backend = this.#backend;
    const previous = this.#resources;
    let replacement: DeferredTraaHistoryResources | undefined;
    if (backend !== undefined) {
      if (backend.state !== 'ready' || previous === undefined) {
        throw error('Deferred TRAA History Backend is not ready.', 'INVALID_STATE', true);
      }
      replacement = this.#createResources(backend, nextWidth, nextHeight);
    }

    this.#width = nextWidth;
    this.#height = nextHeight;
    this.#resources = replacement;
    this.#historyGeneration = undefined;
    this.#historyValid = false;
    this.#lastResetReason = 'viewport';
    this.#readIndex = 0;
    if (replacement !== undefined) this.#resourceGeneration += 1;

    if (backend !== undefined && previous !== undefined) {
      const cleanupErrors = this.#destroyResources(backend, previous);
      if (cleanupErrors.length === 1) throw cleanupErrors[0];
      if (cleanupErrors.length > 1) {
        throw new AggregateError(cleanupErrors, 'Deferred TRAA History Resize cleanup failed.');
      }
    }
    return this.getDiagnostics();
  }

  getDiagnostics(): DeferredTraaHistoryDiagnostics {
    return Object.freeze({
      estimatedGpuBytes:
        this.#width * this.#height * HISTORY_SET_BYTES_PER_TEXEL * HISTORY_SET_COUNT,
      frameOpen: this.#prepared !== undefined,
      historyGeneration: this.#historyGeneration ?? null,
      historyValid: this.#historyValid,
      lastResetReason: this.#lastResetReason,
      ownerId: this.#ownerId,
      readIndex: this.#readIndex,
      resourceGeneration: this.#resourceGeneration,
      size: this.#size(),
      state: this.#disposed ? 'disposed' : this.#resources === undefined ? 'detached' : 'ready',
    });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#prepared = undefined;
    this.#historyGeneration = undefined;
    this.#historyValid = false;
    this.#unsubscribeLost?.();
    this.#unsubscribeLost = undefined;
    const backend = this.#backend;
    const resources = this.#resources;
    this.#backend = undefined;
    this.#resources = undefined;
    const cleanupErrors =
      backend === undefined || resources === undefined
        ? []
        : this.#destroyResources(backend, resources);
    if (cleanupErrors.length === 1) throw cleanupErrors[0];
    if (cleanupErrors.length > 1) {
      throw new AggregateError(cleanupErrors, 'Deferred TRAA History disposal failed.');
    }
  }

  #createResources(
    backend: GraphicsBackend,
    width: number,
    height: number,
  ): DeferredTraaHistoryResources {
    const created: BackendResourceHandle[] = [];
    try {
      const createTargetSet = (index: 0 | 1): DeferredTraaHistoryTargetSet => {
        const colorTexture = backend.createTexture({
          format: 'rgba16float',
          label: `deferred-traa-history-${this.#ownerId}-${index}-color`,
          size: { height, width },
          usage: ['render-attachment', 'sampled'],
        });
        created.push(colorTexture);
        const depthTexture = backend.createTexture({
          format: 'depth32float',
          label: `deferred-traa-history-${this.#ownerId}-${index}-depth`,
          size: { height, width },
          usage: ['render-attachment', 'sampled'],
        });
        created.push(depthTexture);
        return Object.freeze({ colorTexture, depthTexture });
      };
      const first = createTargetSet(0);
      const second = createTargetSet(1);
      const sampler = backend.createSampler({
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
        addressModeW: 'clamp-to-edge',
        label: `deferred-traa-history-${this.#ownerId}-sampler`,
        magFilter: 'linear',
        minFilter: 'linear',
        mipmapFilter: 'nearest',
      });
      created.push(sampler);
      return Object.freeze({
        sampler,
        targetSets: Object.freeze([first, second] as const),
      });
    } catch (cause) {
      const cleanupErrors = this.#destroyHandles(backend, created.reverse());
      if (cleanupErrors.length > 0) {
        throw new AggregateError(
          [cause, ...cleanupErrors],
          'Deferred TRAA History resource creation failed.',
          { cause },
        );
      }
      throw cause;
    }
  }

  #destroyResources(backend: GraphicsBackend, resources: DeferredTraaHistoryResources): unknown[] {
    const [first, second] = resources.targetSets;
    return this.#destroyHandles(backend, [
      resources.sampler,
      second.depthTexture,
      second.colorTexture,
      first.depthTexture,
      first.colorTexture,
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
    this.#prepared = undefined;
    this.#historyGeneration = undefined;
    this.#historyValid = false;
    this.#lastResetReason = 'device-lost';
    this.#readIndex = 0;
  }

  #size(): DeferredTraaHistorySize {
    return Object.freeze({ height: this.#height, width: this.#width });
  }

  #assertActive(): void {
    if (this.#disposed) {
      throw error('Deferred TRAA History is disposed.', 'ALREADY_DISPOSED');
    }
  }
}
