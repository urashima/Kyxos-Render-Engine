import { describe, expect, it, vi } from 'vitest';

import { FrameScheduler } from '../src/index.js';
import type { FrameRequestDriver, FrameRequestId } from '../src/index.js';

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

  flush(timestamp = 0): number {
    const callbacks = [...this.callbacks.values()];
    this.callbacks.clear();
    callbacks.forEach((callback) => callback(timestamp));
    return callbacks.length;
  }
}

describe('FrameScheduler', () => {
  it('coalesces dirty flags into one frame and returns to sleep', () => {
    const driver = new TestFrameDriver();
    const onFrame = vi.fn();
    const onWake = vi.fn();
    const onSleep = vi.fn();
    const scheduler = new FrameScheduler({ driver, onFrame });
    scheduler.on('wake', onWake);
    scheduler.on('sleep', onSleep);

    scheduler.invalidate('material');
    scheduler.invalidate('camera');

    expect(driver.callbacks.size).toBe(1);
    expect(scheduler.mode).toBe('interactive');
    expect(onWake).toHaveBeenCalledExactlyOnceWith({ dirtyFlag: 'material' });

    expect(driver.flush(16)).toBe(1);
    expect(onFrame).toHaveBeenCalledExactlyOnceWith({
      dirtyFlags: ['camera', 'material'],
      timestamp: 16,
    });
    expect(scheduler.mode).toBe('sleeping');
    expect(scheduler.pending).toBe(false);
    expect(onSleep).toHaveBeenCalledOnce();
  });

  it('requests another frame only when invalidated during frame processing', () => {
    const driver = new TestFrameDriver();
    const onFrame = vi.fn();
    const scheduler = new FrameScheduler({
      driver,
      onFrame: (frame) => {
        onFrame(frame);
        if (onFrame.mock.calls.length === 1) {
          scheduler.invalidate('texture');
        }
      },
    });

    scheduler.invalidate('material');
    driver.flush(1);

    expect(driver.callbacks.size).toBe(1);
    expect(scheduler.mode).toBe('interactive');
    driver.flush(2);

    expect(onFrame.mock.calls).toEqual([
      [{ dirtyFlags: ['material'], timestamp: 1 }],
      [{ dirtyFlags: ['texture'], timestamp: 2 }],
    ]);
    expect(scheduler.mode).toBe('sleeping');
  });

  it('cancels pending work on suspension and rejects invalidation after disposal', () => {
    const driver = new TestFrameDriver();
    const scheduler = new FrameScheduler({ driver });
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
