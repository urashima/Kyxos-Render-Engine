import { describe, expect, it, vi } from 'vitest';

import {
  DEFERRED_TRAA_PASS_ORDER,
  DeferredTraaFrameScheduler,
} from '../src/deferred-traa-scheduler.js';
import type {
  DeferredTraaScheduledFrame,
  FrameRequestDriver,
  FrameRequestId,
} from '../src/index.js';

class TestFrameDriver implements FrameRequestDriver {
  readonly callbacks = new Map<FrameRequestId, (timestamp: number) => void>();
  nextId = 1;

  cancelFrame(requestId: FrameRequestId): void {
    this.callbacks.delete(requestId);
  }

  requestFrame(callback: (timestamp: number) => void): FrameRequestId {
    const id = this.nextId++;
    this.callbacks.set(id, callback);
    return id;
  }

  flush(timestamp: number): number {
    const callbacks = [...this.callbacks.values()];
    this.callbacks.clear();
    callbacks.forEach((callback) => callback(timestamp));
    return callbacks.length;
  }
}

describe('DeferredTraaFrameScheduler', () => {
  it('emits the independent GBuffer -> lighting -> TRAA -> post -> present graph', () => {
    const driver = new TestFrameDriver();
    const frames: DeferredTraaScheduledFrame[] = [];
    const modes: string[] = [];
    const scheduler = new DeferredTraaFrameScheduler({
      driver,
      onFrame: (frame) => frames.push(frame),
      settleFrames: 2,
    });
    scheduler.on('mode-change', ({ current }) => modes.push(current));

    scheduler.invalidate('camera');
    driver.flush(0);
    driver.flush(16);
    driver.flush(32);

    expect(frames).toHaveLength(3);
    expect(
      frames.map(({ historyAction, jitterSampleIndex, mode }) => ({
        historyAction,
        jitterSampleIndex,
        mode,
      })),
    ).toEqual([
      { historyAction: 'reset', jitterSampleIndex: 1, mode: 'interactive' },
      { historyAction: 'advance', jitterSampleIndex: 2, mode: 'resolving' },
      { historyAction: 'advance', jitterSampleIndex: 3, mode: 'resolving' },
    ]);
    expect(frames.every(({ passes }) => passes === DEFERRED_TRAA_PASS_ORDER)).toBe(true);
    expect(modes).toEqual(['interactive', 'resolving', 'sleeping']);
    expect(scheduler.getDiagnostics()).toMatchObject({
      historyGeneration: 1,
      jitterSampleIndex: 3,
      mode: 'sleeping',
      pending: false,
      remainingResolveFrames: 0,
    });
  });

  it('coalesces one dirty batch into one History generation', () => {
    const driver = new TestFrameDriver();
    const resets = vi.fn();
    const frames: DeferredTraaScheduledFrame[] = [];
    const scheduler = new DeferredTraaFrameScheduler({
      driver,
      onFrame: (frame) => frames.push(frame),
      settleFrames: 0,
    });
    scheduler.on('history-reset', resets);

    scheduler.invalidate('material');
    scheduler.invalidate('texture');
    driver.flush(0);

    expect(resets).toHaveBeenCalledTimes(1);
    expect(resets).toHaveBeenCalledWith({ dirtyFlag: 'material', generation: 1 });
    expect(frames[0]).toMatchObject({
      dirtyFlags: ['material', 'texture'],
      historyAction: 'reset',
      historyGeneration: 1,
      jitterSampleIndex: 1,
    });
    expect(scheduler.mode).toBe('sleeping');
  });

  it('reuses resolved History for selection and post-process-only frames', () => {
    const driver = new TestFrameDriver();
    const frames: DeferredTraaScheduledFrame[] = [];
    const scheduler = new DeferredTraaFrameScheduler({
      driver,
      onFrame: (frame) => frames.push(frame),
      settleFrames: 0,
    });

    scheduler.invalidate('geometry');
    driver.flush(0);
    scheduler.invalidate('selection');
    driver.flush(16);
    scheduler.invalidate('post-process');
    driver.flush(32);

    expect(
      frames.map(({ historyAction, historyGeneration, jitterSampleIndex }) => ({
        historyAction,
        historyGeneration,
        jitterSampleIndex,
      })),
    ).toEqual([
      { historyAction: 'reset', historyGeneration: 1, jitterSampleIndex: 1 },
      { historyAction: 'reuse', historyGeneration: 1, jitterSampleIndex: 1 },
      { historyAction: 'reuse', historyGeneration: 1, jitterSampleIndex: 1 },
    ]);
  });

  it('restarts the bounded resolve tail when scene work arrives during resolve', () => {
    const driver = new TestFrameDriver();
    const frames: DeferredTraaScheduledFrame[] = [];
    const scheduler = new DeferredTraaFrameScheduler({
      driver,
      onFrame: (frame) => {
        frames.push(frame);
        if (frame.mode === 'resolving' && frame.historyGeneration === 1) {
          scheduler.invalidate('transform');
        }
      },
      settleFrames: 1,
    });

    scheduler.invalidate('camera');
    driver.flush(0);
    driver.flush(16);
    driver.flush(32);
    driver.flush(48);

    expect(
      frames.map(({ historyAction, historyGeneration, mode }) => ({
        historyAction,
        historyGeneration,
        mode,
      })),
    ).toEqual([
      { historyAction: 'reset', historyGeneration: 1, mode: 'interactive' },
      { historyAction: 'advance', historyGeneration: 1, mode: 'resolving' },
      { historyAction: 'reset', historyGeneration: 2, mode: 'interactive' },
      { historyAction: 'advance', historyGeneration: 2, mode: 'resolving' },
    ]);
    expect(scheduler.mode).toBe('sleeping');
  });

  it('cancels pending work and rejects invalidation after disposal', () => {
    const driver = new TestFrameDriver();
    const scheduler = new DeferredTraaFrameScheduler({ driver });

    scheduler.invalidate('viewport');
    scheduler.suspend();
    expect(driver.callbacks.size).toBe(0);
    expect(scheduler.mode).toBe('sleeping');

    scheduler.dispose();
    scheduler.dispose();
    expect(() => scheduler.invalidate('camera')).toThrowError(
      expect.objectContaining({ code: 'ALREADY_DISPOSED' }),
    );
  });
});
