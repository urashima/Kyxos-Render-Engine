import { KyxosEngineError, TypedEventEmitter } from '@kyxos/render-core';
import type { Disposable, EventListener, Unsubscribe } from '@kyxos/render-core';

import type { DirtyFlag, FrameRequestDriver, FrameRequestId } from './scheduler.js';

export const DEFERRED_TRAA_PASS_ORDER = Object.freeze([
  'gbuffer',
  'deferred-lighting',
  'traa-resolve',
  'post-process',
  'present',
] as const);

export const DEFERRED_TRAA_HISTORY_RESET_FLAGS = Object.freeze([
  'animation',
  'camera',
  'environment',
  'geometry',
  'light',
  'material',
  'texture',
  'transform',
  'viewport',
] as const satisfies readonly DirtyFlag[]);

export type DeferredTraaPass = (typeof DEFERRED_TRAA_PASS_ORDER)[number];
export type DeferredTraaMode = 'interactive' | 'resolving' | 'sleeping';
export type DeferredTraaHistoryAction = 'advance' | 'reset' | 'reuse';

export interface DeferredTraaScheduledFrame {
  readonly dirtyFlags: readonly DirtyFlag[];
  readonly historyAction: DeferredTraaHistoryAction;
  readonly historyGeneration: number;
  readonly jitterSampleIndex: number;
  readonly mode: Exclude<DeferredTraaMode, 'sleeping'>;
  readonly passes: readonly DeferredTraaPass[];
  readonly timestamp: number;
}

export interface DeferredTraaSchedulerModeChangeEvent {
  readonly current: DeferredTraaMode;
  readonly previous: DeferredTraaMode;
}

export interface DeferredTraaSchedulerHistoryResetEvent {
  readonly dirtyFlag: DirtyFlag;
  readonly generation: number;
}

export interface DeferredTraaSchedulerEvents {
  readonly frame: DeferredTraaScheduledFrame;
  readonly 'history-reset': DeferredTraaSchedulerHistoryResetEvent;
  readonly 'mode-change': DeferredTraaSchedulerModeChangeEvent;
  readonly sleep: undefined;
  readonly wake: { readonly dirtyFlag: DirtyFlag };
}

export interface DeferredTraaSchedulerDiagnostics {
  readonly historyGeneration: number;
  readonly historyResetPending: boolean;
  readonly jitterSampleIndex: number;
  readonly mode: DeferredTraaMode;
  readonly passOrder: readonly DeferredTraaPass[];
  readonly pending: boolean;
  readonly remainingResolveFrames: number;
  readonly settleFrames: number;
}

export interface DeferredTraaFrameSchedulerOptions {
  readonly driver: FrameRequestDriver;
  readonly onFrame?: (frame: DeferredTraaScheduledFrame) => void;
  /** Number of clean TRAA resolve frames emitted after a History-resetting interactive frame. */
  readonly settleFrames?: number;
}

const JITTER_SEQUENCE_LENGTH = 256;
const DEFAULT_SETTLE_FRAMES = 8;
const RESET_FLAGS = new Set<DirtyFlag>(DEFERRED_TRAA_HISTORY_RESET_FLAGS);

function validateSettleFrames(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new KyxosEngineError('Deferred TRAA settleFrames must be a non-negative safe integer.', {
      code: 'INVALID_ARGUMENT',
      module: 'scheduler',
      recoverable: false,
    });
  }
  return value;
}

/**
 * Dedicated Deferred + TRAA scheduler.
 *
 * This scheduler deliberately does not expose the legacy
 * Interactive -> Stabilizing -> Accumulating transaction. It emits one fixed
 * render graph and owns only TRAA History generation, Jitter progression, and
 * the bounded resolve tail required after scene changes.
 */
export class DeferredTraaFrameScheduler implements Disposable {
  readonly #dirtyFlags = new Set<DirtyFlag>();
  readonly #driver: FrameRequestDriver;
  readonly #events = new TypedEventEmitter<DeferredTraaSchedulerEvents>();
  readonly #onFrame: ((frame: DeferredTraaScheduledFrame) => void) | undefined;
  readonly #settleFrames: number;
  #disposed = false;
  #historyGeneration = 0;
  #historyResetPending = false;
  #jitterSampleIndex = 0;
  #mode: DeferredTraaMode = 'sleeping';
  #pendingRequest: FrameRequestId | undefined;
  #remainingResolveFrames = 0;

  constructor(options: DeferredTraaFrameSchedulerOptions) {
    this.#driver = options.driver;
    this.#onFrame = options.onFrame;
    this.#settleFrames = validateSettleFrames(options.settleFrames ?? DEFAULT_SETTLE_FRAMES);
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  get mode(): DeferredTraaMode {
    return this.#mode;
  }

  get pending(): boolean {
    return this.#pendingRequest !== undefined;
  }

  getDiagnostics(): DeferredTraaSchedulerDiagnostics {
    return Object.freeze({
      historyGeneration: this.#historyGeneration,
      historyResetPending: this.#historyResetPending,
      jitterSampleIndex: this.#jitterSampleIndex,
      mode: this.#mode,
      passOrder: DEFERRED_TRAA_PASS_ORDER,
      pending: this.pending,
      remainingResolveFrames: this.#remainingResolveFrames,
      settleFrames: this.#settleFrames,
    });
  }

  on<EventName extends keyof DeferredTraaSchedulerEvents>(
    eventName: EventName,
    listener: EventListener<DeferredTraaSchedulerEvents[EventName]>,
  ): Unsubscribe {
    return this.#events.on(eventName, listener);
  }

  invalidate(dirtyFlag: DirtyFlag): void {
    this.#assertActive();
    this.#dirtyFlags.add(dirtyFlag);

    const firstFrame = this.#historyGeneration === 0;
    if ((firstFrame || RESET_FLAGS.has(dirtyFlag)) && !this.#historyResetPending) {
      this.#historyGeneration += 1;
      this.#historyResetPending = true;
      this.#jitterSampleIndex = 0;
      this.#remainingResolveFrames = this.#settleFrames;
      this.#events.emit(
        'history-reset',
        Object.freeze({ dirtyFlag, generation: this.#historyGeneration }),
      );
    }

    if (this.#mode === 'sleeping') {
      this.#setMode('interactive');
      this.#events.emit('wake', Object.freeze({ dirtyFlag }));
    } else if (this.#mode === 'resolving') {
      this.#setMode('interactive');
    }

    this.#requestFrameIfNeeded();
  }

  suspend(): void {
    if (this.#disposed) return;
    if (this.#pendingRequest !== undefined) {
      this.#driver.cancelFrame(this.#pendingRequest);
      this.#pendingRequest = undefined;
    }
    this.#dirtyFlags.clear();
    this.#remainingResolveFrames = 0;
    this.#enterSleep();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.suspend();
    this.#disposed = true;
    this.#events.dispose();
  }

  #assertActive(): void {
    if (this.#disposed) {
      throw new KyxosEngineError('Cannot invalidate a disposed Deferred TRAA scheduler.', {
        code: 'ALREADY_DISPOSED',
        module: 'scheduler',
        recoverable: false,
      });
    }
  }

  #enterSleep(): void {
    if (this.#mode === 'sleeping') return;
    this.#setMode('sleeping');
    this.#events.emit('sleep', undefined);
  }

  #nextJitterSample(): number {
    this.#jitterSampleIndex = (this.#jitterSampleIndex % JITTER_SEQUENCE_LENGTH) + 1;
    return this.#jitterSampleIndex;
  }

  #requestFrameIfNeeded(): void {
    if (this.#pendingRequest !== undefined) return;
    this.#pendingRequest = this.#driver.requestFrame((timestamp) => this.#runFrame(timestamp));
  }

  #runFrame(timestamp: number): void {
    this.#pendingRequest = undefined;
    if (this.#disposed) return;

    const dirtyFlags = Object.freeze([...this.#dirtyFlags].sort());
    this.#dirtyFlags.clear();
    const historyReset = this.#historyResetPending;
    this.#historyResetPending = false;
    const mode: DeferredTraaScheduledFrame['mode'] =
      dirtyFlags.length > 0 ? 'interactive' : 'resolving';
    this.#setMode(mode);

    const historyAction: DeferredTraaHistoryAction = historyReset
      ? 'reset'
      : mode === 'resolving'
        ? 'advance'
        : 'reuse';
    const jitterSampleIndex =
      historyAction === 'reuse' ? this.#jitterSampleIndex : this.#nextJitterSample();
    const frame = Object.freeze({
      dirtyFlags,
      historyAction,
      historyGeneration: this.#historyGeneration,
      jitterSampleIndex,
      mode,
      passes: DEFERRED_TRAA_PASS_ORDER,
      timestamp,
    }) satisfies DeferredTraaScheduledFrame;

    let thrown: unknown;
    try {
      this.#onFrame?.(frame);
      this.#events.emit('frame', frame);
    } catch (error) {
      thrown = error;
    } finally {
      if (this.#dirtyFlags.size > 0 || this.#historyResetPending) {
        this.#setMode('interactive');
        this.#requestFrameIfNeeded();
      } else if (historyReset && this.#remainingResolveFrames > 0) {
        this.#setMode('resolving');
        this.#requestFrameIfNeeded();
      } else if (mode === 'resolving') {
        this.#remainingResolveFrames = Math.max(0, this.#remainingResolveFrames - 1);
        if (this.#remainingResolveFrames > 0) {
          this.#requestFrameIfNeeded();
        } else {
          this.#enterSleep();
        }
      } else {
        this.#enterSleep();
      }
    }

    if (thrown !== undefined) throw thrown;
  }

  #setMode(next: DeferredTraaMode): void {
    const previous = this.#mode;
    if (previous === next) return;
    this.#mode = next;
    this.#events.emit('mode-change', Object.freeze({ current: next, previous }));
  }
}
