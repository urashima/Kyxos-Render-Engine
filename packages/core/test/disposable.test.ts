import { describe, expect, it, vi } from 'vitest';

import { DisposeBag } from '../src/index.js';

describe('DisposeBag', () => {
  it('disposes owned actions in reverse order exactly once', () => {
    const calls: number[] = [];
    const bag = new DisposeBag();
    bag.add(() => calls.push(1));
    bag.add(() => calls.push(2));

    bag.dispose();
    bag.dispose();

    expect(calls).toEqual([2, 1]);
    expect(bag.disposed).toBe(true);
  });

  it('immediately disposes ownership added after the bag is closed', () => {
    const dispose = vi.fn();
    const bag = new DisposeBag();
    bag.dispose();

    bag.add(dispose);

    expect(dispose).toHaveBeenCalledOnce();
  });

  it('attempts every cleanup before reporting aggregate failure', () => {
    const finalCleanup = vi.fn();
    const bag = new DisposeBag();
    bag.add(() => {
      throw new Error('first');
    });
    bag.add(finalCleanup);
    bag.add(() => {
      throw new Error('second');
    });

    expect(() => bag.dispose()).toThrow(AggregateError);
    expect(finalCleanup).toHaveBeenCalledOnce();
    expect(bag.disposed).toBe(true);
  });
});
