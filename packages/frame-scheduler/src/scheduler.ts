import { KyxosEngineError, TypedEventEmitter } from '@kyxos/render-core';
import type { Disposable, EventListener, Unsubscribe } from '@kyxos/render-core';

export const DIRTY_FLAGS = [
  'accumulation',
  'animation',
  'camera',
  'environment',
  'geometry',
  'light',
  'material',
  'post-process',
  'selection',
  'texture',
  'transform',
  'viewport',
] as const;

export type DirtyFlag = (typeof DIRTY_FLAGS)[number];
export type RenderMode = 'accumulating' | 'interactive' | 'sleeping' | 'stabilizing';
export type FrameRequestId = number;

export interface FrameRequestDriver {
  cancelFrame(requestId: FrameRequestId): void;
  requestFrame(callback: (timestamp: number) => void): FrameRequestId;
}

export interface ScheduledFrame {
  readonly dirtyFlags: readonly DirtyFlag[];
  readonly timestamp: number;
}

export interface FrameSchedulerEvents {
  readonly frame: ScheduledFrame;
  readonly sleep: undefined;
  readonly wake: { readonly dirtyFlag: DirtyFlag };
}

export interface FrameSchedulerOptions {
  readonly driver: FrameRequestDriver;
  readonly onFrame?: (frame: ScheduledFrame) => void;
}

/**
 * Dirty-driven Phase 0 scheduler shell.
 *
 * It coalesces invalidations into one requested frame and returns to sleep when
 * no new invalidation was raised during that frame. Stabilization and temporal
 * accumulation policies are intentionally deferred to Phase 4.
 */
export class FrameScheduler implements Disposable {
  readonly #dirtyFlags = new Set<DirtyFlag>();
  readonly #driver: FrameRequestDriver;
  readonly #events = new TypedEventEmitter<FrameSchedulerEvents>();
  readonly #onFrame: ((frame: ScheduledFrame) => void) | undefined;
  #disposed = false;
  #mode: RenderMode = 'sleeping';
  #pendingRequest: FrameRequestId | undefined;

  constructor(options: FrameSchedulerOptions) {
    this.#driver = options.driver;
    this.#onFrame = options.onFrame;
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  get mode(): RenderMode {
    return this.#mode;
  }

  get pending(): boolean {
    return this.#pendingRequest !== undefined;
  }

  on<EventName extends keyof FrameSchedulerEvents>(
    eventName: EventName,
    listener: EventListener<FrameSchedulerEvents[EventName]>,
  ): Unsubscribe {
    return this.#events.on(eventName, listener);
  }

  invalidate(dirtyFlag: DirtyFlag): void {
    this.#assertActive();
    this.#dirtyFlags.add(dirtyFlag);

    if (this.#mode === 'sleeping') {
      this.#mode = 'interactive';
      this.#events.emit('wake', Object.freeze({ dirtyFlag }));
    }

    this.#requestFrameIfNeeded();
  }

  suspend(): void {
    if (this.#disposed) {
      return;
    }

    if (this.#pendingRequest !== undefined) {
      this.#driver.cancelFrame(this.#pendingRequest);
      this.#pendingRequest = undefined;
    }

    this.#dirtyFlags.clear();
    this.#enterSleep();
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }

    this.suspend();
    this.#disposed = true;
    this.#events.dispose();
  }

  #assertActive(): void {
    if (this.#disposed) {
      throw new KyxosEngineError('Cannot invalidate a disposed frame scheduler.', {
        code: 'ALREADY_DISPOSED',
        module: 'scheduler',
        recoverable: false,
      });
    }
  }

  #enterSleep(): void {
    if (this.#mode === 'sleeping') {
      return;
    }

    this.#mode = 'sleeping';
    this.#events.emit('sleep', undefined);
  }

  #requestFrameIfNeeded(): void {
    if (this.#pendingRequest !== undefined) {
      return;
    }

    this.#pendingRequest = this.#driver.requestFrame((timestamp) => this.#runFrame(timestamp));
  }

  #runFrame(timestamp: number): void {
    this.#pendingRequest = undefined;
    if (this.#disposed) {
      return;
    }

    const dirtyFlags = Object.freeze([...this.#dirtyFlags].sort());
    this.#dirtyFlags.clear();
    const frame = Object.freeze({ dirtyFlags, timestamp }) satisfies ScheduledFrame;

    let thrown: unknown;
    try {
      this.#onFrame?.(frame);
      this.#events.emit('frame', frame);
    } catch (error) {
      thrown = error;
    } finally {
      if (this.#dirtyFlags.size > 0) {
        this.#requestFrameIfNeeded();
      } else {
        this.#enterSleep();
      }
    }

    if (thrown !== undefined) {
      throw thrown;
    }
  }
}

export function isDirtyFlag(value: unknown): value is DirtyFlag {
  return typeof value === 'string' && (DIRTY_FLAGS as readonly string[]).includes(value);
}
