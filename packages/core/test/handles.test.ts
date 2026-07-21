import { describe, expect, it } from 'vitest';

import { HandleAllocator, KyxosEngineError, handleKey, isHandle } from '../src/index.js';

describe('HandleAllocator', () => {
  it('creates immutable monotonic handles without ID reuse', () => {
    const allocator = new HandleAllocator('texture');
    const first = allocator.create();
    const second = allocator.create();

    expect(first).toEqual({ id: 1, kind: 'texture' });
    expect(second).toEqual({ id: 2, kind: 'texture' });
    expect(Object.isFrozen(first)).toBe(true);
    expect(handleKey(second)).toBe('texture:2');
  });

  it('validates runtime handle shape and kind', () => {
    expect(isHandle({ id: 3, kind: 'mesh' })).toBe(true);
    expect(isHandle({ id: 3, kind: 'mesh' }, 'texture')).toBe(false);
    expect(isHandle({ id: 0.5, kind: 'mesh' })).toBe(false);
    expect(isHandle({ id: 0, kind: 'mesh' })).toBe(false);
    expect(isHandle({ id: -1, kind: 'mesh' })).toBe(false);
    expect(isHandle(null)).toBe(false);
  });

  it('rejects an empty handle kind with a stable engine error', () => {
    expect(() => new HandleAllocator('')).toThrow(KyxosEngineError);
    try {
      new HandleAllocator('');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'INVALID_ARGUMENT',
        module: 'core',
        recoverable: false,
      });
    }
  });
});
