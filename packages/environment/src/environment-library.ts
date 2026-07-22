import { KyxosEngineError, TypedEventEmitter } from '@kyxos/render-core';

import type { Disposable, EventListener, Unsubscribe } from '@kyxos/render-core';

import { EnvironmentSource } from './environment-source.js';

export interface EnvironmentReference {
  readonly id: string;
  readonly version?: string;
}

export interface EnvironmentLibraryChangeEvent {
  readonly id: string;
  readonly kind: 'removed' | 'replaced' | 'set';
  readonly revision: number;
}

export interface EnvironmentLibraryEvents {
  readonly changed: EnvironmentLibraryChangeEvent;
}

export interface EnvironmentLibraryDiagnostics {
  readonly identities: readonly string[];
  readonly revision: number;
  readonly sourceCount: number;
}

function error(message: string, code: 'ALREADY_DISPOSED' | 'INVALID_ARGUMENT' | 'INVALID_STATE') {
  return new KyxosEngineError(message, {
    code,
    module: 'environment',
    recoverable: false,
  });
}

function id(value: string): string {
  const result = value.trim();
  if (result.length === 0)
    throw error('Environment source id must not be empty.', 'INVALID_ARGUMENT');
  return result;
}

/** Caller-owned registry. Sources remain immutable and are never disposed by the registry. */
export class EnvironmentLibrary implements Disposable {
  readonly #events = new TypedEventEmitter<EnvironmentLibraryEvents>();
  readonly #sources = new Map<string, EnvironmentSource>();
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

  on<EventName extends keyof EnvironmentLibraryEvents>(
    eventName: EventName,
    listener: EventListener<EnvironmentLibraryEvents[EventName]>,
  ): Unsubscribe {
    this.#assertActive();
    return this.#events.on(eventName, listener);
  }

  set(source: EnvironmentSource): EnvironmentSource | null {
    this.#assertActive();
    if (!(source instanceof EnvironmentSource)) {
      throw error(
        'Environment Library accepts validated EnvironmentSource instances.',
        'INVALID_ARGUMENT',
      );
    }
    const previous = this.#sources.get(source.id) ?? null;
    if (previous === source) return previous;
    this.#sources.set(source.id, source);
    this.#emit(source.id, previous === null ? 'set' : 'replaced');
    return previous;
  }

  delete(sourceId: string): EnvironmentSource | null {
    this.#assertActive();
    const normalized = id(sourceId);
    const previous = this.#sources.get(normalized) ?? null;
    if (previous === null) return null;
    this.#sources.delete(normalized);
    this.#emit(normalized, 'removed');
    return previous;
  }

  has(sourceId: string): boolean {
    this.#assertActive();
    return this.#sources.has(id(sourceId));
  }

  resolve(reference: EnvironmentReference | string): EnvironmentSource {
    this.#assertActive();
    const normalized = typeof reference === 'string' ? { id: reference } : reference;
    const source = this.#sources.get(id(normalized.id));
    if (source === undefined) {
      throw error(`Environment source "${normalized.id}" is not registered.`, 'INVALID_STATE');
    }
    if (normalized.version !== undefined && normalized.version.trim() !== source.version) {
      throw error(
        `Environment source "${source.id}" is version ${source.version}, not ${normalized.version.trim()}.`,
        'INVALID_STATE',
      );
    }
    return source;
  }

  diagnostics(): EnvironmentLibraryDiagnostics {
    this.#assertActive();
    return Object.freeze({
      identities: Object.freeze(
        [...this.#sources.values()].map((source) => source.identityKey).sort(),
      ),
      revision: this.#revision,
      sourceCount: this.#sources.size,
    });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#sources.clear();
    this.#events.dispose();
  }

  #assertActive(): void {
    if (this.#disposed) throw error('Environment Library is disposed.', 'ALREADY_DISPOSED');
  }

  #emit(sourceId: string, kind: EnvironmentLibraryChangeEvent['kind']): void {
    this.#revision += 1;
    this.#events.emit('changed', Object.freeze({ id: sourceId, kind, revision: this.#revision }));
  }
}
