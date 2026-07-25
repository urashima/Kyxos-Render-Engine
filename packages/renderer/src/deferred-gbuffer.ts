import type {
  BackendResourceHandle,
  BackendTextureHandle,
  GraphicsBackend,
} from '@kyxos/render-backend-api';
import { KyxosEngineError } from '@kyxos/render-core';
import type { Disposable, Unsubscribe } from '@kyxos/render-core';

const BASE_COLOR_METALLIC_BYTES_PER_TEXEL = 8;
const NORMAL_ROUGHNESS_BYTES_PER_TEXEL = 8;
const EMISSIVE_OCCLUSION_BYTES_PER_TEXEL = 8;
const VELOCITY_BYTES_PER_TEXEL = 4;
const DEPTH_BYTES_PER_TEXEL = 4;
const DEFERRED_GBUFFER_BYTES_PER_TEXEL =
  BASE_COLOR_METALLIC_BYTES_PER_TEXEL +
  NORMAL_ROUGHNESS_BYTES_PER_TEXEL +
  EMISSIVE_OCCLUSION_BYTES_PER_TEXEL +
  VELOCITY_BYTES_PER_TEXEL +
  DEPTH_BYTES_PER_TEXEL;

export interface DeferredGBufferOptions {
  readonly height: number;
  readonly ownerId: string;
  readonly width: number;
}

export interface DeferredGBufferSize {
  readonly height: number;
  readonly width: number;
}

export interface DeferredGBufferFrame {
  readonly baseColorMetallicTexture: BackendTextureHandle;
  readonly depthTexture: BackendTextureHandle;
  readonly emissiveOcclusionTexture: BackendTextureHandle;
  readonly normalRoughnessTexture: BackendTextureHandle;
  readonly ownerId: string;
  readonly resourceGeneration: number;
  readonly size: DeferredGBufferSize;
  readonly velocityTexture: BackendTextureHandle;
}

export interface DeferredGBufferDiagnostics {
  readonly estimatedGpuBytes: number;
  readonly ownerId: string;
  readonly resourceGeneration: number;
  readonly size: DeferredGBufferSize;
  readonly state: 'detached' | 'disposed' | 'ready';
}

interface DeferredGBufferResources {
  readonly baseColorMetallicTexture: BackendTextureHandle;
  readonly depthTexture: BackendTextureHandle;
  readonly emissiveOcclusionTexture: BackendTextureHandle;
  readonly normalRoughnessTexture: BackendTextureHandle;
  readonly velocityTexture: BackendTextureHandle;
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

function validateOwnerId(value: string): string {
  const ownerId = value.trim();
  if (ownerId.length === 0) {
    throw error('Deferred GBuffer ownerId must not be empty.', 'INVALID_ARGUMENT');
  }
  return ownerId;
}

/**
 * Owner-scoped current-frame GBuffer attachments for the independent Deferred path.
 *
 * These resources are never shared with the legacy Dynamic TAA or Static Accumulation
 * owners. Deferred Lighting and TRAA may sample them, but only this object creates,
 * replaces, and destroys the attachment set.
 */
export class DeferredGBuffer implements Disposable {
  readonly #ownerId: string;
  #backend: GraphicsBackend | undefined;
  #disposed = false;
  #height: number;
  #resourceGeneration = 0;
  #resources: DeferredGBufferResources | undefined;
  #unsubscribeLost: Unsubscribe | undefined;
  #width: number;

  constructor(options: DeferredGBufferOptions) {
    this.#ownerId = validateOwnerId(options.ownerId);
    this.#width = validateExtent('Deferred GBuffer width', options.width);
    this.#height = validateExtent('Deferred GBuffer height', options.height);
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  initialize(backend: GraphicsBackend): void {
    this.#assertActive();
    if (backend.state !== 'ready') {
      throw error('Deferred GBuffer requires a ready Backend.', 'INVALID_STATE');
    }
    if (this.#backend === backend && this.#resources !== undefined) return;
    if (this.#backend !== undefined) {
      throw error('Deferred GBuffer is already attached to another Backend.', 'INVALID_STATE');
    }

    const resources = this.#createResources(backend, this.#width, this.#height);
    this.#backend = backend;
    this.#resources = resources;
    this.#resourceGeneration += 1;
    this.#unsubscribeLost = backend.on('lost', () => this.#onBackendLost(backend));
  }

  acquireFrame(): DeferredGBufferFrame {
    this.#assertActive();
    const backend = this.#backend;
    const resources = this.#resources;
    if (backend === undefined || backend.state !== 'ready' || resources === undefined) {
      throw error(
        'Deferred GBuffer resources are unavailable until the Backend is restored.',
        'INVALID_STATE',
        true,
      );
    }

    return Object.freeze({
      baseColorMetallicTexture: resources.baseColorMetallicTexture,
      depthTexture: resources.depthTexture,
      emissiveOcclusionTexture: resources.emissiveOcclusionTexture,
      normalRoughnessTexture: resources.normalRoughnessTexture,
      ownerId: this.#ownerId,
      resourceGeneration: this.#resourceGeneration,
      size: this.#size(),
      velocityTexture: resources.velocityTexture,
    });
  }

  resize(width: number, height: number): DeferredGBufferDiagnostics {
    this.#assertActive();
    const nextWidth = validateExtent('Deferred GBuffer width', width);
    const nextHeight = validateExtent('Deferred GBuffer height', height);
    if (nextWidth === this.#width && nextHeight === this.#height) return this.getDiagnostics();

    const backend = this.#backend;
    const previous = this.#resources;
    let replacement: DeferredGBufferResources | undefined;
    if (backend !== undefined) {
      if (backend.state !== 'ready' || previous === undefined) {
        throw error('Deferred GBuffer Backend is not ready.', 'INVALID_STATE', true);
      }
      replacement = this.#createResources(backend, nextWidth, nextHeight);
    }

    this.#width = nextWidth;
    this.#height = nextHeight;
    this.#resources = replacement;
    if (replacement !== undefined) this.#resourceGeneration += 1;

    if (backend !== undefined && previous !== undefined) {
      const errors = this.#destroyResources(backend, previous);
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) {
        throw new AggregateError(errors, 'Deferred GBuffer resize cleanup failed.');
      }
    }
    return this.getDiagnostics();
  }

  getDiagnostics(): DeferredGBufferDiagnostics {
    return Object.freeze({
      estimatedGpuBytes:
        this.#width * this.#height * DEFERRED_GBUFFER_BYTES_PER_TEXEL,
      ownerId: this.#ownerId,
      resourceGeneration: this.#resourceGeneration,
      size: this.#size(),
      state: this.#disposed ? 'disposed' : this.#resources === undefined ? 'detached' : 'ready',
    });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#unsubscribeLost?.();
    this.#unsubscribeLost = undefined;
    const backend = this.#backend;
    const resources = this.#resources;
    this.#backend = undefined;
    this.#resources = undefined;

    const errors =
      backend === undefined || resources === undefined
        ? []
        : this.#destroyResources(backend, resources);
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(errors, 'Deferred GBuffer disposal failed.');
    }
  }

  #createResources(
    backend: GraphicsBackend,
    width: number,
    height: number,
  ): DeferredGBufferResources {
    const created: BackendResourceHandle[] = [];
    try {
      const createTexture = (
        label: string,
        format: 'depth32float' | 'rg16float' | 'rgba16float',
      ): BackendTextureHandle => {
        const texture = backend.createTexture({
          format,
          label,
          size: { height, width },
          usage: ['render-attachment', 'sampled'],
        });
        created.push(texture);
        return texture;
      };

      return Object.freeze({
        baseColorMetallicTexture: createTexture(
          `deferred-gbuffer-${this.#ownerId}-base-color-metallic`,
          'rgba16float',
        ),
        depthTexture: createTexture(
          `deferred-gbuffer-${this.#ownerId}-depth`,
          'depth32float',
        ),
        emissiveOcclusionTexture: createTexture(
          `deferred-gbuffer-${this.#ownerId}-emissive-occlusion`,
          'rgba16float',
        ),
        normalRoughnessTexture: createTexture(
          `deferred-gbuffer-${this.#ownerId}-normal-roughness`,
          'rgba16float',
        ),
        velocityTexture: createTexture(
          `deferred-gbuffer-${this.#ownerId}-velocity`,
          'rg16float',
        ),
      });
    } catch (cause) {
      const cleanupErrors = this.#destroyHandles(backend, created.reverse());
      if (cleanupErrors.length > 0) {
        throw new AggregateError(
          [cause, ...cleanupErrors],
          'Deferred GBuffer resource creation failed.',
          { cause },
        );
      }
      throw cause;
    }
  }

  #destroyResources(backend: GraphicsBackend, resources: DeferredGBufferResources): unknown[] {
    return this.#destroyHandles(backend, [
      resources.velocityTexture,
      resources.normalRoughnessTexture,
      resources.emissiveOcclusionTexture,
      resources.depthTexture,
      resources.baseColorMetallicTexture,
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
  }

  #size(): DeferredGBufferSize {
    return Object.freeze({ height: this.#height, width: this.#width });
  }

  #assertActive(): void {
    if (this.#disposed) {
      throw error('Deferred GBuffer is disposed.', 'ALREADY_DISPOSED');
    }
  }
}
