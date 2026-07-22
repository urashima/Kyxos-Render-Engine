import { describe, expect, it, vi } from 'vitest';

import { TemporalFrameScheduler } from '../src/index.js';
import type { FrameRequestDriver, FrameRequestId, ScheduledFrame } from '../src/index.js';

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

describe('TemporalFrameScheduler', () => {
  it('follows Interactive → Stabilizing → Accumulating → Sleeping deterministically', () => {
    const driver = new TestFrameDriver();
    const frames: ScheduledFrame[] = [];
    const modes: string[] = [];
    const scheduler = new TemporalFrameScheduler({
      convergence: { targetSamples: 3 },
      driver,
      onFrame: (frame) => frames.push(frame),
      stabilizationMs: 20,
    });
    scheduler.on('mode-change', ({ current }) => modes.push(current));

    scheduler.invalidate('material');
    expect(scheduler.getDiagnostics()).toMatchObject({
      historyGeneration: 1,
      historyResetPending: true,
      mode: 'interactive',
      pending: true,
    });

    driver.flush(0);
    driver.flush(10);
    driver.flush(20);
    driver.flush(36);
    driver.flush(52);
    driver.flush(68);

    expect(frames.map(({ temporal }) => temporal)).toEqual([
      {
        historyGeneration: 1,
        historyReset: true,
        mode: 'interactive',
        sampleIndex: 0,
        targetSamples: 3,
      },
      {
        historyGeneration: 1,
        historyReset: false,
        mode: 'stabilizing',
        sampleIndex: 0,
        targetSamples: 3,
      },
      {
        historyGeneration: 1,
        historyReset: false,
        mode: 'stabilizing',
        sampleIndex: 0,
        targetSamples: 3,
      },
      {
        historyGeneration: 1,
        historyReset: false,
        mode: 'accumulating',
        sampleIndex: 1,
        targetSamples: 3,
      },
      {
        historyGeneration: 1,
        historyReset: false,
        mode: 'accumulating',
        sampleIndex: 2,
        targetSamples: 3,
      },
      {
        historyGeneration: 1,
        historyReset: false,
        mode: 'accumulating',
        sampleIndex: 3,
        targetSamples: 3,
      },
    ]);
    expect(modes).toEqual(['interactive', 'stabilizing', 'accumulating', 'sleeping']);
    expect(scheduler.getDiagnostics()).toMatchObject({
      convergence: { converged: true, reason: 'sample-limit', sampleCount: 3 },
      mode: 'sleeping',
      pending: false,
    });
  });

  it('keeps active work interactive and stabilizes only after it ends', () => {
    const driver = new TestFrameDriver();
    const scheduler = new TemporalFrameScheduler({
      convergence: { targetSamples: 1 },
      driver,
      stabilizationMs: 0,
    });

    scheduler.setActivity('interaction', true, 'camera');
    driver.flush(0);
    driver.flush(16);
    driver.flush(32);
    expect(scheduler.getDiagnostics()).toMatchObject({
      activeActivities: ['interaction'],
      convergence: { sampleCount: 0 },
      mode: 'interactive',
    });

    scheduler.setActivity('interaction', false);
    driver.flush(48);
    expect(scheduler.mode).toBe('stabilizing');
    driver.flush(64);
    expect(scheduler.mode).toBe('accumulating');
    driver.flush(80);
    expect(scheduler.mode).toBe('sleeping');
  });

  it('resets an in-flight accumulation exactly once per coalesced dirty batch', () => {
    const driver = new TestFrameDriver();
    const resets = vi.fn();
    const scheduler = new TemporalFrameScheduler({
      convergence: { targetSamples: 4 },
      driver,
      onFrame: ({ temporal }) => {
        if (temporal?.mode === 'accumulating' && temporal.sampleIndex === 1) {
          scheduler.invalidate('texture');
          scheduler.invalidate('material');
        }
      },
      stabilizationMs: 0,
    });
    scheduler.on('history-reset', resets);

    scheduler.invalidate('geometry');
    driver.flush(0);
    driver.flush(16);
    driver.flush(32);
    expect(scheduler.mode).toBe('interactive');
    expect(scheduler.getDiagnostics()).toMatchObject({
      convergence: { sampleCount: 0 },
      historyGeneration: 2,
      historyResetPending: true,
    });
    expect(resets).toHaveBeenCalledTimes(2);
    expect(resets.mock.calls.map(([event]) => event)).toEqual([
      { dirtyFlag: 'geometry', generation: 1 },
      { dirtyFlag: 'texture', generation: 2 },
    ]);
  });

  it('renders a non-reset selection overlay once after convergence and preserves samples', () => {
    const driver = new TestFrameDriver();
    const scheduler = new TemporalFrameScheduler({
      convergence: { targetSamples: 1 },
      driver,
      stabilizationMs: 0,
    });
    scheduler.invalidate('geometry');
    driver.flush(0);
    driver.flush(16);
    driver.flush(32);
    expect(scheduler.getDiagnostics()).toMatchObject({
      convergence: { sampleCount: 1 },
      historyGeneration: 1,
      mode: 'sleeping',
    });

    scheduler.invalidate('selection');
    driver.flush(48);
    expect(scheduler.getDiagnostics()).toMatchObject({
      convergence: { sampleCount: 1 },
      historyGeneration: 1,
      mode: 'sleeping',
      pending: false,
    });
  });

  it('accepts an error report only inside accumulation and converges by threshold', () => {
    const driver = new TestFrameDriver();
    const scheduler = new TemporalFrameScheduler({
      convergence: {
        errorThreshold: 0.01,
        minimumSamples: 2,
        stableSamples: 2,
        targetSamples: 8,
      },
      driver,
      onFrame: ({ temporal }) => {
        if (temporal?.mode === 'accumulating') scheduler.reportConvergence(0.005);
      },
      stabilizationMs: 0,
    });

    expect(() => scheduler.reportConvergence(0)).toThrowError(
      expect.objectContaining({ code: 'INVALID_STATE' }),
    );
    scheduler.invalidate('camera');
    driver.flush(0);
    driver.flush(16);
    driver.flush(32);
    driver.flush(48);

    expect(scheduler.getDiagnostics()).toMatchObject({
      convergence: { converged: true, reason: 'error-threshold', sampleCount: 2 },
      mode: 'sleeping',
    });
  });

  it('cancels, invalidates history, and rejects work after disposal', () => {
    const driver = new TestFrameDriver();
    const scheduler = new TemporalFrameScheduler({
      convergence: { targetSamples: 4 },
      driver,
    });
    scheduler.invalidate('viewport');
    scheduler.suspend();
    scheduler.suspend();
    expect(driver.callbacks.size).toBe(0);
    expect(scheduler.getDiagnostics()).toMatchObject({
      historyGeneration: 1,
      historyResetPending: true,
      mode: 'sleeping',
    });

    scheduler.dispose();
    scheduler.dispose();
    expect(() => scheduler.invalidate('camera')).toThrowError(
      expect.objectContaining({ code: 'ALREADY_DISPOSED' }),
    );
  });
});
