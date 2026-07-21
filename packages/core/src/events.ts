import type { Disposable } from './disposable.js';

export type EventListener<Payload> = (payload: Payload) => void;
export type Unsubscribe = () => void;

type ErasedListener = EventListener<unknown>;

/**
 * Small synchronous event primitive with deterministic unsubscribe semantics.
 *
 * Emission uses a listener snapshot so listeners may subscribe or unsubscribe
 * while an event is being delivered without corrupting the current iteration.
 */
export class TypedEventEmitter<Events extends object> implements Disposable {
  readonly #listeners = new Map<keyof Events, Set<ErasedListener>>();
  #disposed = false;

  get disposed(): boolean {
    return this.#disposed;
  }

  on<EventName extends keyof Events>(
    eventName: EventName,
    listener: EventListener<Events[EventName]>,
  ): Unsubscribe {
    if (this.#disposed) {
      throw new Error('Cannot subscribe to a disposed event emitter.');
    }

    // A wrapper gives every subscription its own identity, even when the same
    // callback is registered more than once.
    const erasedListener: ErasedListener = (payload) => listener(payload as Events[EventName]);
    const listeners = this.#listeners.get(eventName) ?? new Set<ErasedListener>();
    listeners.add(erasedListener);
    this.#listeners.set(eventName, listeners);

    let active = true;
    return () => {
      if (!active) {
        return;
      }

      active = false;
      listeners.delete(erasedListener);
      if (listeners.size === 0) {
        this.#listeners.delete(eventName);
      }
    };
  }

  once<EventName extends keyof Events>(
    eventName: EventName,
    listener: EventListener<Events[EventName]>,
  ): Unsubscribe {
    let unsubscribe: Unsubscribe = () => undefined;
    unsubscribe = this.on(eventName, (payload) => {
      unsubscribe();
      listener(payload);
    });
    return unsubscribe;
  }

  emit<EventName extends keyof Events>(eventName: EventName, payload: Events[EventName]): void {
    if (this.#disposed) {
      return;
    }

    const listeners = this.#listeners.get(eventName);
    if (listeners === undefined) {
      return;
    }

    const errors: unknown[] = [];
    for (const listener of [...listeners]) {
      try {
        listener(payload);
      } catch (error) {
        errors.push(error);
      }
    }

    if (errors.length === 1) {
      throw errors[0];
    }

    if (errors.length > 1) {
      throw new AggregateError(errors, `Multiple listeners for "${String(eventName)}" failed.`);
    }
  }

  listenerCount<EventName extends keyof Events>(eventName: EventName): number {
    return this.#listeners.get(eventName)?.size ?? 0;
  }

  clear<EventName extends keyof Events>(eventName?: EventName): void {
    if (eventName === undefined) {
      this.#listeners.clear();
      return;
    }

    this.#listeners.delete(eventName);
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }

    this.#disposed = true;
    this.#listeners.clear();
  }
}
