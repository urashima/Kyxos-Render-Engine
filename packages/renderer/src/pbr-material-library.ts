import { KyxosEngineError, TypedEventEmitter } from '@kyxos/render-core';
import { PbrMaterial } from '@kyxos/render-material-pbr';

import type { Disposable, EventListener, Unsubscribe } from '@kyxos/render-core';

export type PbrMaterialLibraryChangeKind =
  | 'fallback-updated'
  | 'material-removed'
  | 'material-replaced'
  | 'material-set'
  | 'material-updated';

export interface PbrMaterialLibraryChangeEvent {
  readonly key: string | null;
  readonly kind: PbrMaterialLibraryChangeKind;
  readonly materialRevision: number;
  readonly revision: number;
}

export interface PbrMaterialLibraryEvents {
  readonly changed: PbrMaterialLibraryChangeEvent;
}

export interface PbrMaterialLibraryOptions {
  /**
   * The caller retains ownership of a supplied fallback. When omitted, the
   * library creates and owns a neutral fallback material.
   */
  readonly fallbackMaterial?: PbrMaterial;
}

export interface PbrMaterialLibraryDiagnostics {
  readonly materialCount: number;
  readonly ownsFallbackMaterial: boolean;
  readonly revision: number;
}

/**
 * Keyed CPU material registry used by PBR Render Features.
 *
 * Registration never transfers ownership of a PbrMaterial. The library owns
 * only its subscriptions and, when no fallback is supplied, its internal
 * fallback instance.
 */
export class PbrMaterialLibrary implements Disposable {
  readonly #events = new TypedEventEmitter<PbrMaterialLibraryEvents>();
  readonly #fallbackMaterial: PbrMaterial;
  readonly #materials = new Map<string, PbrMaterial>();
  readonly #ownsFallbackMaterial: boolean;
  readonly #subscriptions = new Map<string, Unsubscribe>();
  #disposed = false;
  #fallbackSubscription: Unsubscribe;
  #revision = 0;

  constructor(options: PbrMaterialLibraryOptions = {}) {
    const fallback = options.fallbackMaterial ?? new PbrMaterial({ name: 'Kyxos PBR Fallback' });
    if (fallback.disposed) {
      throw this.#error('PBR fallback material must be active.', 'INVALID_ARGUMENT');
    }
    this.#fallbackMaterial = fallback;
    this.#ownsFallbackMaterial = options.fallbackMaterial === undefined;
    this.#fallbackSubscription = fallback.on('changed', ({ revision }) => {
      this.#emit('fallback-updated', null, revision);
    });
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  get fallbackMaterial(): PbrMaterial {
    this.#assertActive();
    return this.#fallbackMaterial;
  }

  get revision(): number {
    return this.#revision;
  }

  get size(): number {
    this.#assertActive();
    return this.#materials.size;
  }

  on<EventName extends keyof PbrMaterialLibraryEvents>(
    eventName: EventName,
    listener: EventListener<PbrMaterialLibraryEvents[EventName]>,
  ): Unsubscribe {
    this.#assertActive();
    return this.#events.on(eventName, listener);
  }

  set(key: string, material: PbrMaterial): PbrMaterial | null {
    this.#assertActive();
    const normalizedKey = this.#key(key);
    if (material.disposed) {
      throw this.#error('Registered PBR material must be active.', 'INVALID_ARGUMENT');
    }
    const previous = this.#materials.get(normalizedKey) ?? null;
    if (previous === material) return previous;

    this.#subscriptions.get(normalizedKey)?.();
    this.#materials.set(normalizedKey, material);
    this.#subscriptions.set(
      normalizedKey,
      material.on('changed', ({ revision }) => {
        this.#emit('material-updated', normalizedKey, revision);
      }),
    );
    this.#emit(
      previous === null ? 'material-set' : 'material-replaced',
      normalizedKey,
      material.revision,
    );
    return previous;
  }

  delete(key: string): PbrMaterial | null {
    this.#assertActive();
    const normalizedKey = this.#key(key);
    const material = this.#materials.get(normalizedKey);
    if (material === undefined) return null;
    this.#subscriptions.get(normalizedKey)?.();
    this.#subscriptions.delete(normalizedKey);
    this.#materials.delete(normalizedKey);
    this.#emit('material-removed', normalizedKey, material.revision);
    return material;
  }

  has(key: string): boolean {
    this.#assertActive();
    return this.#materials.has(this.#key(key));
  }

  resolve(key: string): PbrMaterial {
    this.#assertActive();
    const material = this.#materials.get(this.#key(key)) ?? this.#fallbackMaterial;
    if (material.disposed) {
      throw this.#error('Resolved PBR material has been disposed by its owner.', 'INVALID_STATE');
    }
    return material;
  }

  keys(): readonly string[] {
    this.#assertActive();
    return Object.freeze([...this.#materials.keys()].sort());
  }

  diagnostics(): PbrMaterialLibraryDiagnostics {
    this.#assertActive();
    return Object.freeze({
      materialCount: this.#materials.size,
      ownsFallbackMaterial: this.#ownsFallbackMaterial,
      revision: this.#revision,
    });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#fallbackSubscription();
    for (const unsubscribe of this.#subscriptions.values()) unsubscribe();
    this.#subscriptions.clear();
    this.#materials.clear();
    if (this.#ownsFallbackMaterial) this.#fallbackMaterial.dispose();
    this.#events.dispose();
  }

  #emit(kind: PbrMaterialLibraryChangeKind, key: string | null, materialRevision: number): void {
    this.#revision += 1;
    this.#events.emit(
      'changed',
      Object.freeze({ key, kind, materialRevision, revision: this.#revision }),
    );
  }

  #key(value: string): string {
    const result = value.trim();
    if (result.length === 0) {
      throw this.#error('PBR material key must not be empty.', 'INVALID_ARGUMENT');
    }
    return result;
  }

  #assertActive(): void {
    if (this.#disposed) {
      throw this.#error('PBR Material Library is disposed.', 'ALREADY_DISPOSED');
    }
  }

  #error(
    message: string,
    code: 'ALREADY_DISPOSED' | 'INVALID_ARGUMENT' | 'INVALID_STATE',
  ): KyxosEngineError {
    return new KyxosEngineError(message, { code, module: 'renderer', recoverable: false });
  }
}
