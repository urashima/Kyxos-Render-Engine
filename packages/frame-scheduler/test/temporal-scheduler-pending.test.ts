import { describe, expect, it, vi } from 'vitest';

import { TemporalFrameScheduler } from '../src/index.js';
import type { FrameRequestDriver, FrameRequestId } from '../src/index.js';

class TestFrameDriver implements FrameRequestDriver {
  readonly callbacks = new Map<FrameRequestId, (timestamp: number) => void>();
  #nextId = 1;

  cancelFrame(requestId: FrameRequestId): void {
    this.callbacks.delete(requestId);
  }

  requestFrame(callback: (timestamp: number) => void): FrameRequestId {
    const requestId = this.#nextId;
    this.#nextId += 1;
    this.callbacks.set(requestId, callback);
    return requestId;
  }

  flush(timestamp: number): void {
    const callbacks = [...this.callbacks.values()];
    this.callbacks.clear();
    callbacks.forEach((callback) => callback(timestamp));
  }
}

describe('TemporalFrameScheduler pending diagnostics', () => {
  it('stays active while a frame executes or a continuous activity remains registered', () => {
    const driver = new TestFrameDriver();
    const scheduler = new TemporalFrameScheduler({
      convergence: { targetSamples: 1 },
      driver,
      stabilizationMs: 0,
    });
    const pendingDuringFrames: boolean[] = [];
    const pendingAtSleep = vi.fn();
    scheduler.on('frame', () => pendingDuringFrames.push(scheduler.pending));
    scheduler.on('sleep', () => pendingAtSleep(scheduler.pending));

    scheduler.setActivity('animation', true, 'animation');
    expect(scheduler.pending).toBe(true);
    driver.flush(0);
    driver.flush(16);
    expect(pendingDuringFrames).toEqual([true, true]);
    expect(scheduler.getDiagnostics()).toMatchObject({
      activeActivities: ['animation'],
      mode: 'interactive',
      pending: true,
    });

    scheduler.setActivity('animation', false);
    driver.flush(32);
    driver.flush(48);
    driver.flush(64);
    expect(pendingDuringFrames.every(Boolean)).toBe(true);
    expect(pendingAtSleep).toHaveBeenLastCalledWith(false);
    expect(scheduler.getDiagnostics()).toMatchObject({ mode: 'sleeping', pending: false });
  });
});
