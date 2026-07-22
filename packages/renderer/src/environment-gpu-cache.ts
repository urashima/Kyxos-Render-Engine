import type {
  BackendResourceHandle,
  BackendSamplerHandle,
  BackendTextureHandle,
  BackendTextureViewDescriptor,
  GraphicsBackend,
} from '@kyxos/render-backend-api';
import { KyxosEngineError } from '@kyxos/render-core';
import type { Disposable, Unsubscribe } from '@kyxos/render-core';
import type { EnvironmentSource } from '@kyxos/render-environment';

export interface EnvironmentGpuResources {
  readonly brdfLutSampler: BackendSamplerHandle;
  readonly brdfLutTexture: BackendTextureHandle;
  readonly brdfLutView: BackendTextureViewDescriptor;
  readonly cubeSampler: BackendSamplerHandle;
  readonly diffuseIrradianceTexture: BackendTextureHandle;
  readonly diffuseIrradianceView: BackendTextureViewDescriptor;
  readonly identityKey: string;
  readonly specularMipLevelCount: number;
  readonly specularPrefilterTexture: BackendTextureHandle;
  readonly specularPrefilterView: BackendTextureViewDescriptor;
}

export interface EnvironmentGpuCacheDiagnostics {
  readonly activeLeaseCount: number;
  readonly cachedEnvironmentCount: number;
  readonly estimatedGpuBytes: number;
  readonly generation: number;
  readonly gpuReadyEnvironmentCount: number;
  readonly identities: readonly string[];
  readonly state: 'detached' | 'disposed' | 'ready';
}

interface CacheEntry {
  leases: number;
  resources: EnvironmentGpuResources | undefined;
  readonly source: EnvironmentSource;
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

export class EnvironmentGpuLease implements Disposable {
  readonly #cache: EnvironmentGpuCache;
  readonly identityKey: string;
  #disposed = false;

  constructor(cache: EnvironmentGpuCache, identityKey: string) {
    this.#cache = cache;
    this.identityKey = identityKey;
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  get resources(): EnvironmentGpuResources {
    if (this.#disposed) throw error('Environment GPU Lease is disposed.', 'ALREADY_DISPOSED');
    return this.#cache.resourcesFor(this.identityKey);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#cache.release(this.identityKey);
  }
}

/**
 * Reference-counted owner of prefiltered environment GPU resources.
 * EnvironmentSource remains caller-owned; every Backend Handle remains cache-owned.
 */
export class EnvironmentGpuCache implements Disposable {
  readonly #entries = new Map<string, CacheEntry>();
  #backend: GraphicsBackend | undefined;
  #disposed = false;
  #generation = 0;
  #unsubscribeLost: Unsubscribe | undefined;

  get disposed(): boolean {
    return this.#disposed;
  }

  initialize(backend: GraphicsBackend): void {
    this.#assertActive();
    if (backend.state !== 'ready') {
      throw error('Environment GPU Cache requires a ready Backend.', 'INVALID_STATE');
    }
    if (this.#backend === backend) return;
    if (this.#backend !== undefined) {
      throw error('Environment GPU Cache is already attached to another Backend.', 'INVALID_STATE');
    }

    const restored = new Map<CacheEntry, EnvironmentGpuResources>();
    try {
      for (const entry of this.#entries.values()) {
        restored.set(entry, this.#createResources(backend, entry.source));
      }
    } catch (cause) {
      const cleanupErrors = [...restored.values()].flatMap((resources) =>
        this.#destroyResources(backend, resources),
      );
      if (cleanupErrors.length > 0) {
        throw new AggregateError(
          [cause, ...cleanupErrors],
          'Environment GPU Cache restoration failed.',
          { cause },
        );
      }
      throw cause;
    }

    this.#backend = backend;
    this.#generation += 1;
    for (const [entry, resources] of restored) entry.resources = resources;
    this.#unsubscribeLost = backend.on('lost', () => this.#onBackendLost(backend));
  }

  acquire(source: EnvironmentSource): EnvironmentGpuLease {
    this.#assertActive();
    const backend = this.#requireBackend();
    const existing = this.#entries.get(source.identityKey);
    if (existing !== undefined) {
      existing.leases += 1;
      return new EnvironmentGpuLease(this, source.identityKey);
    }

    const resources = this.#createResources(backend, source);
    this.#entries.set(source.identityKey, { leases: 1, resources, source });
    return new EnvironmentGpuLease(this, source.identityKey);
  }

  resourcesFor(identityKey: string): EnvironmentGpuResources {
    this.#assertActive();
    const entry = this.#entries.get(identityKey);
    if (entry === undefined) {
      throw error('Environment GPU Lease does not belong to this cache.', 'INVALID_ARGUMENT');
    }
    if (entry.resources === undefined || this.#backend === undefined) {
      throw error(
        'Environment GPU resources are unavailable until the Backend is restored.',
        'INVALID_STATE',
        true,
      );
    }
    return entry.resources;
  }

  diagnostics(): EnvironmentGpuCacheDiagnostics {
    const identities = [...this.#entries.keys()].sort();
    return Object.freeze({
      activeLeaseCount: [...this.#entries.values()].reduce((sum, entry) => sum + entry.leases, 0),
      cachedEnvironmentCount: this.#entries.size,
      estimatedGpuBytes: [...this.#entries.values()].reduce(
        (sum, entry) => sum + entry.source.estimatedGpuBytes,
        0,
      ),
      generation: this.#generation,
      gpuReadyEnvironmentCount: [...this.#entries.values()].filter(
        (entry) => entry.resources !== undefined,
      ).length,
      identities: Object.freeze(identities),
      state: this.#disposed ? 'disposed' : this.#backend === undefined ? 'detached' : 'ready',
    });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#unsubscribeLost?.();
    this.#unsubscribeLost = undefined;
    const backend = this.#backend;
    this.#backend = undefined;
    const errors =
      backend === undefined
        ? []
        : [...this.#entries.values()].flatMap((entry) =>
            entry.resources === undefined ? [] : this.#destroyResources(backend, entry.resources),
          );
    this.#entries.clear();
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(errors, 'Environment GPU Cache disposal failed.');
    }
  }

  release(identityKey: string): void {
    if (this.#disposed) return;
    const entry = this.#entries.get(identityKey);
    if (entry === undefined) return;
    entry.leases -= 1;
    if (entry.leases > 0) return;
    this.#entries.delete(identityKey);
    const backend = this.#backend;
    if (backend === undefined || entry.resources === undefined) return;
    const errors = this.#destroyResources(backend, entry.resources);
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(errors, 'Environment GPU resource release failed.');
    }
  }

  #createResources(backend: GraphicsBackend, source: EnvironmentSource): EnvironmentGpuResources {
    const created: BackendResourceHandle[] = [];
    try {
      const cubeSampler = backend.createSampler({
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
        addressModeW: 'clamp-to-edge',
        label: `environment-cube-sampler-${source.id}`,
        magFilter: 'linear',
        minFilter: 'linear',
        mipmapFilter: 'linear',
      });
      created.push(cubeSampler);
      const brdfLutSampler = backend.createSampler({
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
        addressModeW: 'clamp-to-edge',
        label: `environment-brdf-lut-sampler-${source.id}`,
        magFilter: 'linear',
        minFilter: 'linear',
        mipmapFilter: 'nearest',
      });
      created.push(brdfLutSampler);

      const diffuseIrradianceTexture = backend.createTexture({
        format: 'rgba16float',
        label: `environment-diffuse-${source.id}`,
        size: {
          depthOrArrayLayers: 6,
          height: source.diffuseFaceSize,
          width: source.diffuseFaceSize,
        },
        usage: ['copy-dst', 'sampled'],
      });
      created.push(diffuseIrradianceTexture);
      backend.writeTexture(diffuseIrradianceTexture, source.copyDiffuseLevel(), {
        bytesPerRow: source.diffuseFaceSize * 8,
        rowsPerImage: source.diffuseFaceSize,
        size: {
          depthOrArrayLayers: 6,
          height: source.diffuseFaceSize,
          width: source.diffuseFaceSize,
        },
      });

      const specularPrefilterTexture = backend.createTexture({
        format: 'rgba16float',
        label: `environment-specular-${source.id}`,
        mipLevelCount: source.specularMipLevelCount,
        size: {
          depthOrArrayLayers: 6,
          height: source.specularFaceSize,
          width: source.specularFaceSize,
        },
        usage: ['copy-dst', 'sampled'],
      });
      created.push(specularPrefilterTexture);
      for (let mipLevel = 0; mipLevel < source.specularMipLevelCount; mipLevel += 1) {
        const size = Math.max(1, Math.floor(source.specularFaceSize / 2 ** mipLevel));
        backend.writeTexture(specularPrefilterTexture, source.copySpecularLevel(mipLevel), {
          bytesPerRow: size * 8,
          mipLevel,
          rowsPerImage: size,
          size: { depthOrArrayLayers: 6, height: size, width: size },
        });
      }

      const brdfLutTexture = backend.createTexture({
        format: 'rg16float',
        label: `environment-brdf-lut-${source.id}`,
        size: { height: source.brdfLutHeight, width: source.brdfLutWidth },
        usage: ['copy-dst', 'sampled'],
      });
      created.push(brdfLutTexture);
      backend.writeTexture(brdfLutTexture, source.copyBrdfLut(), {
        bytesPerRow: source.brdfLutWidth * 4,
        rowsPerImage: source.brdfLutHeight,
        size: { height: source.brdfLutHeight, width: source.brdfLutWidth },
      });

      return Object.freeze({
        brdfLutSampler,
        brdfLutTexture,
        brdfLutView: Object.freeze({ dimension: '2d' }),
        cubeSampler,
        diffuseIrradianceTexture,
        diffuseIrradianceView: Object.freeze({
          arrayLayerCount: 6,
          dimension: 'cube',
          mipLevelCount: 1,
        }),
        identityKey: source.identityKey,
        specularMipLevelCount: source.specularMipLevelCount,
        specularPrefilterTexture,
        specularPrefilterView: Object.freeze({
          arrayLayerCount: 6,
          dimension: 'cube',
          mipLevelCount: source.specularMipLevelCount,
        }),
      });
    } catch (cause) {
      const cleanupErrors = this.#destroyHandles(backend, created.reverse());
      if (cleanupErrors.length > 0) {
        throw new AggregateError(
          [cause, ...cleanupErrors],
          'Environment GPU resource creation failed.',
          { cause },
        );
      }
      throw cause;
    }
  }

  #destroyResources(backend: GraphicsBackend, resources: EnvironmentGpuResources): unknown[] {
    return this.#destroyHandles(backend, [
      resources.brdfLutTexture,
      resources.specularPrefilterTexture,
      resources.diffuseIrradianceTexture,
      resources.brdfLutSampler,
      resources.cubeSampler,
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
    if (backend !== this.#backend) return;
    this.#unsubscribeLost?.();
    this.#unsubscribeLost = undefined;
    this.#backend = undefined;
    for (const entry of this.#entries.values()) entry.resources = undefined;
  }

  #requireBackend(): GraphicsBackend {
    const backend = this.#backend;
    if (backend === undefined || backend.state !== 'ready') {
      throw error('Environment GPU Cache is not attached to a ready Backend.', 'INVALID_STATE');
    }
    return backend;
  }

  #assertActive(): void {
    if (this.#disposed) throw error('Environment GPU Cache is disposed.', 'ALREADY_DISPOSED');
  }
}
