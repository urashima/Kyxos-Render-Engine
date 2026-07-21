import { describe, expect, it, vi } from 'vitest';

import { TypedEventEmitter } from '../src/index.js';

interface TestEvents {
  ready: { readonly backend: string };
  tick: number;
}

describe('TypedEventEmitter', () => {
  it('supports typed delivery, once, and idempotent unsubscribe', () => {
    const emitter = new TypedEventEmitter<TestEvents>();
    const persistent = vi.fn();
    const once = vi.fn();
    const unsubscribe = emitter.on('tick', persistent);
    emitter.once('tick', once);

    emitter.emit('tick', 1);
    emitter.emit('tick', 2);
    unsubscribe();
    unsubscribe();
    emitter.emit('tick', 3);

    expect(persistent.mock.calls).toEqual([[1], [2]]);
    expect(once).toHaveBeenCalledExactlyOnceWith(1);
    expect(emitter.listenerCount('tick')).toBe(0);
  });

  it('uses a stable snapshot when listeners mutate subscriptions', () => {
    const emitter = new TypedEventEmitter<TestEvents>();
    const calls: string[] = [];
    let unsubscribeSecond: () => void = () => undefined;

    emitter.on('ready', () => {
      calls.push('first');
      unsubscribeSecond();
    });
    unsubscribeSecond = emitter.on('ready', () => calls.push('second'));

    emitter.emit('ready', { backend: 'mock' });
    emitter.emit('ready', { backend: 'mock' });

    expect(calls).toEqual(['first', 'second', 'first']);
  });

  it('treats duplicate callback subscriptions as independent ownership', () => {
    const emitter = new TypedEventEmitter<TestEvents>();
    const listener = vi.fn();
    const unsubscribeFirst = emitter.on('tick', listener);
    emitter.on('tick', listener);

    unsubscribeFirst();
    emitter.emit('tick', 1);

    expect(listener).toHaveBeenCalledExactlyOnceWith(1);
    expect(emitter.listenerCount('tick')).toBe(1);
  });

  it('clears all listeners and rejects subscriptions after disposal', () => {
    const emitter = new TypedEventEmitter<TestEvents>();
    emitter.on('tick', () => undefined);

    emitter.dispose();
    emitter.dispose();

    expect(emitter.listenerCount('tick')).toBe(0);
    expect(() => emitter.on('tick', () => undefined)).toThrow(/disposed/);
  });
});
