import { KyxosEngineError, TypedEventEmitter } from '@kyxos/render-core';
import type { EventListener, Unsubscribe } from '@kyxos/render-core';
import { TemporalConvergenceTracker } from '@kyxos/render-temporal';
import type {
  TemporalConvergenceOptions,
  TemporalConvergenceSnapshot,
} from '@kyxos/render-temporal';

import { DIRTY_FLAGS } from './scheduler.js';
import type {
  DirtyFlag,
  FrameRequestDriver,
  FrameRequestId,
  FrameSchedulerController,
  FrameSchedulerEvents,
  FrameSchedulerHistoryResetEvent,
  FrameSchedulerModeChangeEvent,
  RenderMode,
  TemporalFrameMetadata,
  TemporalScheduledFrame,
} from './scheduler.js';

export const FRAME_ACTIVITIES = [
  'animation',
  'interaction',
  'resource-upload',
  'shader-compilation',
] as const;

export type FrameActivity = (typeof FRAME_ACTIVITIES)[number];

export const DEFAULT_TEMPORAL_HISTORY_RESET_FLAGS = Object.freeze(
  DIRTY_FLAGS.filter((dirtyFlag) => dirtyFlag !== 'selection'),
);

export interface TemporalFrameSchedulerOptions {
  readonly convergence: TemporalConvergenceOptions;
  readonly driver: FrameRequestDriver;
  readonly historyResetFlags?: readonly DirtyFlag[];
  readonly onFrame?: (frame: TemporalScheduledFrame) => void;
  readonly stabilizationMs?: number;
}

export interface TemporalFrameSchedulerState {
  readonly activeActivities: readonly FrameActivity[];
  readonly convergence: TemporalConvergenceSnapshot;
  readonly historyGeneration: number;
  readonly historyResetPending: boolean;
  readonly mode: RenderMode;
  readonly pending: boolean;
  readonly stabilizationMs: number;
  readonly stabilizationStartedAt: number | null;
  readonly strategy: 'temporal';
}

function assertStabilizationMs(value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 10_000) {
    throw new KyxosEngineError('stabilizationMs must be a finite number from 0 through 10000.', {
      code: 'INVALID_ARGUMENT',
      module: 'scheduler',
      recoverable: false,
    });
  }
}

function assertFrameActivity(activity: FrameActivity): void {
  if (!(FRAME_ACTIVITIES as readonly string[]).includes(activity)) {
    throw new KyxosEngineError(`Unsupported frame activity "${String(activity)}".`, {
      code: 'INVALID_ARGUMENT',
      module: 'scheduler',
      recoverable: false,
    });
  }
}

/**
 * Deterministic ADR-005 state machine. It schedules policy frames only; TAA and
 * accumulation GPU resources remain separate Render Features.
 */
export class TemporalFrameScheduler implements FrameSchedulerController {
  readonly #activities = new Set<FrameActivity>();
  readonly #convergence: TemporalConvergenceTracker;
  readonly #dirtyFlags = new Set<DirtyFlag>();
  readonly #driver: FrameRequestDriver;
  readonly #events = new TypedEventEmitter<FrameSchedulerEvents>();
  readonly #historyResetFlags: ReadonlySet<DirtyFlag>;
  readonly #onFrame: ((frame: TemporalScheduledFrame) => void) | undefined;
  readonly #stabilizationMs: number;
  #disposed = false;
  #frameRunning = false;
  #historyGeneration = 0;
  #historyResetPending = false;
  #mode: RenderMode = 'sleeping';
  #pendingRequest: FrameRequestId | undefined;
  #reportedConvergenceError: number | undefined;
  #stabilizationStartedAt: number | undefined;

  constructor(options: TemporalFrameSchedulerOptions) {
    const stabilizationMs = options.stabilizationMs ?? 100;
    assertStabilizationMs(stabilizationMs);
    const resetFlags = options.historyResetFlags ?? DEFAULT_TEMPORAL_HISTORY_RESET_FLAGS;
    for (const dirtyFlag of resetFlags) {
      if (!(DIRTY_FLAGS as readonly string[]).includes(dirtyFlag)) {
        throw new KyxosEngineError(
          `Unsupported temporal reset dirty flag "${String(dirtyFlag)}".`,
          {
            code: 'INVALID_ARGUMENT',
            module: 'scheduler',
            recoverable: false,
          },
        );
      }
    }

    this.#convergence = new TemporalConvergenceTracker(options.convergence);
    this.#driver = options.driver;
    this.#historyResetFlags = new Set(resetFlags);
    this.#onFrame = options.onFrame;
    this.#stabilizationMs = stabilizationMs;
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  get mode(): RenderMode {
    return this.#mode;
  }

  get pending(): boolean {
    return this.#pendingRequest !== undefined || this.#frameRunning || this.#activities.size > 0;
  }

  getDiagnostics(): TemporalFrameSchedulerState {
    return Object.freeze({
      activeActivities: Object.freeze([...this.#activities].sort()),
      convergence: this.#convergence.snapshot(),
      historyGeneration: this.#historyGeneration,
      historyResetPending: this.#historyResetPending,
      mode: this.#mode,
      pending: this.pending,
      stabilizationMs: this.#stabilizationMs,
      stabilizationStartedAt: this.#stabilizationStartedAt ?? null,
      strategy: 'temporal',
    });
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
    if (this.#historyResetFlags.has(dirtyFlag)) this.#resetHistory(dirtyFlag);

    const wasSleeping = this.#mode === 'sleeping';
    this.#setMode('interactive');
    if (wasSleeping) this.#events.emit('wake', Object.freeze({ dirtyFlag }));
    this.#requestFrameIfNeeded();
  }

  setActivity(
    activity: FrameActivity,
    active: boolean,
    dirtyFlag: DirtyFlag = 'accumulation',
  ): void {
    this.#assertActive();
    assertFrameActivity(activity);
    if (active) {
      if (this.#activities.has(activity)) return;
      this.#activities.add(activity);
      this.invalidate(dirtyFlag);
      return;
    }

    if (!this.#activities.delete(activity)) return;
    if (this.#mode === 'interactive') this.#requestFrameIfNeeded();
  }

  reportConvergence(error: number): void {
    this.#assertActive();
    if (!this.#frameRunning || this.#mode !== 'accumulating') {
      throw new KyxosEngineError(
        'Convergence may be reported only while an accumulating frame is executing.',
        {
          code: 'INVALID_STATE',
          module: 'scheduler',
          recoverable: false,
        },
      );
    }
    if (!Number.isFinite(error) || error < 0) {
      throw new KyxosEngineError('Convergence error must be a finite non-negative number.', {
        code: 'INVALID_ARGUMENT',
        module: 'scheduler',
        recoverable: false,
      });
    }
    this.#reportedConvergenceError = error;
  }

  suspend(): void {
    if (this.#disposed) return;
    if (this.#pendingRequest !== undefined) {
      this.#driver.cancelFrame(this.#pendingRequest);
      this.#pendingRequest = undefined;
    }
    this.#activities.clear();
    this.#dirtyFlags.clear();
    this.#convergence.reset();
    if (!this.#historyResetPending) this.#historyGeneration += 1;
    this.#historyResetPending = true;
    this.#reportedConvergenceError = undefined;
    this.#stabilizationStartedAt = undefined;
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
      throw new KyxosEngineError('Cannot mutate a disposed temporal frame scheduler.', {
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

  #requestFrameIfNeeded(): void {
    if (this.#pendingRequest !== undefined) return;
    this.#pendingRequest = this.#driver.requestFrame((timestamp) => this.#runFrame(timestamp));
  }

  #resetHistory(dirtyFlag: DirtyFlag): void {
    if (!this.#historyResetPending) {
      this.#historyGeneration += 1;
      const event = Object.freeze({
        dirtyFlag,
        generation: this.#historyGeneration,
      }) satisfies FrameSchedulerHistoryResetEvent;
      this.#events.emit('history-reset', event);
    }
    this.#historyResetPending = true;
    this.#convergence.reset();
    this.#stabilizationStartedAt = undefined;
  }

  #runFrame(timestamp: number): void {
    this.#pendingRequest = undefined;
    if (this.#disposed) return;
    if (!Number.isFinite(timestamp) || timestamp < 0) {
      throw new KyxosEngineError('Frame timestamp must be a finite non-negative number.', {
        code: 'INVALID_ARGUMENT',
        module: 'scheduler',
        recoverable: false,
      });
    }

    const modeAtStart = this.#mode;
    if (modeAtStart === 'sleeping') return;
    const dirtyFlags = Object.freeze([...this.#dirtyFlags].sort());
    this.#dirtyFlags.clear();
    const convergence = this.#convergence.snapshot();
    const temporal = Object.freeze({
      historyGeneration: this.#historyGeneration,
      historyReset: this.#historyResetPending,
      mode: modeAtStart,
      sampleIndex: modeAtStart === 'accumulating' ? convergence.sampleCount + 1 : 0,
      targetSamples: convergence.targetSamples,
    }) satisfies TemporalFrameMetadata;
    this.#historyResetPending = false;
    const frame = Object.freeze({
      dirtyFlags,
      temporal,
      timestamp,
    }) satisfies TemporalScheduledFrame;

    let thrown: unknown;
    this.#frameRunning = true;
    this.#reportedConvergenceError = undefined;
    try {
      this.#onFrame?.(frame);
      this.#events.emit('frame', frame);
    } catch (error) {
      thrown = error;
    } finally {
      this.#frameRunning = false;
      this.#advanceAfterFrame(modeAtStart, timestamp);
    }

    if (thrown !== undefined) throw thrown;
  }

  #advanceAfterFrame(modeAtStart: Exclude<RenderMode, 'sleeping'>, timestamp: number): void {
    if (this.#disposed) return;
    if (this.#dirtyFlags.size > 0) {
      this.#requestFrameIfNeeded();
      return;
    }
    if (this.#activities.size > 0) {
      this.#setMode('interactive');
      this.#requestFrameIfNeeded();
      return;
    }
    if (this.#mode !== modeAtStart) {
      this.#requestFrameIfNeeded();
      return;
    }

    if (modeAtStart === 'interactive') {
      if (this.#convergence.snapshot().converged) {
        this.#enterSleep();
      } else {
        this.#stabilizationStartedAt = timestamp;
        this.#setMode('stabilizing');
        this.#requestFrameIfNeeded();
      }
      return;
    }

    if (modeAtStart === 'stabilizing') {
      const startedAt = this.#stabilizationStartedAt ?? timestamp;
      this.#stabilizationStartedAt = startedAt;
      if (timestamp - startedAt >= this.#stabilizationMs) {
        this.#setMode('accumulating');
      }
      this.#requestFrameIfNeeded();
      return;
    }

    const convergence = this.#convergence.recordSample(this.#reportedConvergenceError);
    if (convergence.converged) {
      this.#events.emit('converged', convergence);
      this.#enterSleep();
    } else {
      this.#requestFrameIfNeeded();
    }
  }

  #setMode(mode: RenderMode): void {
    if (this.#mode === mode) return;
    const event = Object.freeze({
      current: mode,
      previous: this.#mode,
    }) satisfies FrameSchedulerModeChangeEvent;
    this.#mode = mode;
    this.#events.emit('mode-change', event);
  }
}
