import type { BackendSamplerDescriptor } from '@kyxos/render-backend-api';
import { KyxosEngineError, TypedEventEmitter } from '@kyxos/render-core';

import type { Disposable, EventListener, Unsubscribe } from '@kyxos/render-core';
import type {
  MaterialTextureReference,
  TextureTransferFunction,
} from '@kyxos/render-material-core';

export type PbrNormalYDirection = 'down' | 'up';

export interface PbrTextureSourceDescriptor {
  readonly height: number;
  readonly id: string;
  /** Asset-boundary Normal convention metadata; ignored by non-Normal slots. */
  readonly normalYDirection?: PbrNormalYDirection;
  readonly pixels: Uint8Array | Uint8ClampedArray;
  readonly sampler?: BackendSamplerDescriptor;
  readonly transferFunction: TextureTransferFunction;
  readonly width: number;
}

export interface PbrTextureLibraryChangeEvent {
  readonly id: string;
  readonly kind: 'removed' | 'replaced' | 'set';
  readonly revision: number;
}

export interface PbrTextureLibraryEvents {
  readonly changed: PbrTextureLibraryChangeEvent;
}

export interface PbrTextureLibraryDiagnostics {
  readonly revision: number;
  readonly textureCount: number;
  readonly textureIds: readonly string[];
}

const DEFAULT_SAMPLER = Object.freeze({
  addressModeU: 'repeat',
  addressModeV: 'repeat',
  addressModeW: 'repeat',
  magFilter: 'linear',
  maxAnisotropy: 1,
  minFilter: 'linear',
  mipmapFilter: 'linear',
} satisfies BackendSamplerDescriptor);

function error(message: string, code: 'ALREADY_DISPOSED' | 'INVALID_ARGUMENT' | 'INVALID_STATE') {
  return new KyxosEngineError(message, { code, module: 'renderer', recoverable: false });
}

function positiveDimension(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw error(`${label} must be a positive safe integer.`, 'INVALID_ARGUMENT');
  }
  return value;
}

function normalizeSampler(
  descriptor: BackendSamplerDescriptor | undefined,
): BackendSamplerDescriptor {
  const result = { ...DEFAULT_SAMPLER, ...descriptor };
  if (
    !Number.isSafeInteger(result.maxAnisotropy) ||
    (result.maxAnisotropy ?? 0) < 1 ||
    (result.maxAnisotropy ?? 0) > 16
  ) {
    throw error(
      'PBR Texture maxAnisotropy must be an integer from 1 through 16.',
      'INVALID_ARGUMENT',
    );
  }
  return Object.freeze(result);
}

/** Immutable CPU-side RGBA8 source. GPU ownership remains with PbrRenderFeature. */
export class PbrTextureSource {
  readonly #pixels: Uint8Array;
  readonly byteLength: number;
  readonly height: number;
  readonly id: string;
  readonly normalYDirection: PbrNormalYDirection;
  readonly sampler: BackendSamplerDescriptor;
  readonly transferFunction: TextureTransferFunction;
  readonly width: number;

  constructor(descriptor: PbrTextureSourceDescriptor) {
    const id = descriptor.id.trim();
    if (id.length === 0) {
      throw error('PBR Texture source id must not be empty.', 'INVALID_ARGUMENT');
    }
    if (descriptor.transferFunction !== 'linear' && descriptor.transferFunction !== 'srgb') {
      throw error(
        'PBR Texture source transferFunction must be "linear" or "srgb".',
        'INVALID_ARGUMENT',
      );
    }
    const normalYDirection = descriptor.normalYDirection ?? 'up';
    if (normalYDirection !== 'down' && normalYDirection !== 'up') {
      throw error(
        'PBR Texture source normalYDirection must be "up" or "down".',
        'INVALID_ARGUMENT',
      );
    }
    const width = positiveDimension(descriptor.width, 'PBR Texture width');
    const height = positiveDimension(descriptor.height, 'PBR Texture height');
    const byteLength = width * height * 4;
    if (!Number.isSafeInteger(byteLength) || descriptor.pixels.byteLength !== byteLength) {
      throw error(
        `PBR Texture source must contain exactly ${byteLength} RGBA8 bytes.`,
        'INVALID_ARGUMENT',
      );
    }
    this.#pixels = new Uint8Array(descriptor.pixels);
    this.byteLength = byteLength;
    this.height = height;
    this.id = id;
    this.normalYDirection = normalYDirection;
    this.sampler = normalizeSampler(descriptor.sampler);
    this.transferFunction = descriptor.transferFunction;
    this.width = width;
    Object.freeze(this);
  }

  copyPixels(): Uint8Array {
    return this.#pixels.slice();
  }
}

/**
 * Caller-owned CPU Texture registry. Registering a source never transfers its
 * ownership; the Render Feature creates and owns all corresponding GPU Handles.
 */
export class PbrTextureLibrary implements Disposable {
  readonly #events = new TypedEventEmitter<PbrTextureLibraryEvents>();
  readonly #sources = new Map<string, PbrTextureSource>();
  #disposed = false;
  #revision = 0;

  get disposed(): boolean {
    return this.#disposed;
  }

  get revision(): number {
    this.#assertActive();
    return this.#revision;
  }

  get size(): number {
    this.#assertActive();
    return this.#sources.size;
  }

  on<EventName extends keyof PbrTextureLibraryEvents>(
    eventName: EventName,
    listener: EventListener<PbrTextureLibraryEvents[EventName]>,
  ): Unsubscribe {
    this.#assertActive();
    return this.#events.on(eventName, listener);
  }

  set(source: PbrTextureSource): PbrTextureSource | null {
    this.#assertActive();
    if (!(source instanceof PbrTextureSource)) {
      throw error(
        'PBR Texture Library accepts validated PbrTextureSource instances.',
        'INVALID_ARGUMENT',
      );
    }
    const previous = this.#sources.get(source.id) ?? null;
    if (previous === source) return previous;
    this.#sources.set(source.id, source);
    this.#emit(source.id, previous === null ? 'set' : 'replaced');
    return previous;
  }

  delete(id: string): PbrTextureSource | null {
    this.#assertActive();
    const normalized = this.#id(id);
    const previous = this.#sources.get(normalized) ?? null;
    if (previous === null) return null;
    this.#sources.delete(normalized);
    this.#emit(normalized, 'removed');
    return previous;
  }

  has(id: string): boolean {
    this.#assertActive();
    return this.#sources.has(this.#id(id));
  }

  resolve(reference: MaterialTextureReference): PbrTextureSource {
    this.#assertActive();
    const source = this.#sources.get(this.#id(reference.id));
    if (source === undefined) {
      throw error(`PBR Texture source "${reference.id}" is not registered.`, 'INVALID_STATE');
    }
    if (source.transferFunction !== reference.transferFunction) {
      throw error(
        `PBR Texture source "${reference.id}" uses ${source.transferFunction}, but the material requires ${reference.transferFunction}.`,
        'INVALID_ARGUMENT',
      );
    }
    return source;
  }

  diagnostics(): PbrTextureLibraryDiagnostics {
    this.#assertActive();
    return Object.freeze({
      revision: this.#revision,
      textureCount: this.#sources.size,
      textureIds: Object.freeze([...this.#sources.keys()].sort()),
    });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#sources.clear();
    this.#events.dispose();
  }

  #assertActive(): void {
    if (!this.#disposed) return;
    throw error('PBR Texture Library is disposed.', 'ALREADY_DISPOSED');
  }

  #emit(id: string, kind: PbrTextureLibraryChangeEvent['kind']): void {
    this.#revision += 1;
    this.#events.emit('changed', Object.freeze({ id, kind, revision: this.#revision }));
  }

  #id(value: string): string {
    const result = value.trim();
    if (result.length === 0) {
      throw error('PBR Texture source id must not be empty.', 'INVALID_ARGUMENT');
    }
    return result;
  }
}
