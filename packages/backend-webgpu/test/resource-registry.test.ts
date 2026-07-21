import type { BackendResourceHandle } from '@kyxos/render-backend-api';
import { describe, expect, it, vi } from 'vitest';

import { WebGpuResourceRegistry } from '../src/resource-registry.js';

describe('WebGpuResourceRegistry', () => {
  it('tracks native resources by opaque handle identity and exact byte counts', () => {
    const registry = new WebGpuResourceRegistry();
    const buffer = registry.register('buffer', { estimatedBytes: 256, label: 'vertices' }, {});
    const texture = registry.register('texture', { estimatedBytes: 4096 }, {});

    expect(registry.getStatistics()).toMatchObject({
      activeCount: 2,
      activeEstimatedBytes: 4352,
      createdTotal: 2,
      destroyedTotal: 0,
      byKind: {
        buffer: { activeCount: 1, activeEstimatedBytes: 256 },
        texture: { activeCount: 1, activeEstimatedBytes: 4096 },
      },
    });
    expect(registry.resolve(buffer, 'buffer')).toEqual({});
    expect(registry.resolve(texture, 'texture')).toEqual({});
  });

  it('does not accept an equal-looking handle owned by another backend instance', () => {
    const first = new WebGpuResourceRegistry();
    const second = new WebGpuResourceRegistry();
    const firstHandle = first.register('buffer', {}, { owner: 'first' });
    const secondHandle = second.register('buffer', {}, { owner: 'second' });

    expect(firstHandle).toEqual(secondHandle);
    expect(firstHandle).not.toBe(secondHandle);
    expect(first.destroy(secondHandle)).toBe(false);
    expect(first.getStatistics().activeCount).toBe(1);
    expect(first.resolve(firstHandle, 'buffer')).toEqual({ owner: 'first' });
  });

  it('destroys a native resource exactly once and rejects stale resolution', () => {
    const registry = new WebGpuResourceRegistry();
    const destroyNative = vi.fn();
    const handle = registry.register('buffer', { estimatedBytes: 64 }, {}, destroyNative);

    expect(registry.destroy(handle)).toBe(true);
    expect(registry.destroy(handle)).toBe(false);
    expect(destroyNative).toHaveBeenCalledTimes(1);
    expect(() => registry.resolve(handle, 'buffer')).toThrow(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    );
    expect(registry.getStatistics()).toMatchObject({
      activeCount: 0,
      activeEstimatedBytes: 0,
      createdTotal: 1,
      destroyedTotal: 1,
    });
  });

  it('clears lost-device records without invoking invalid native destroy methods', () => {
    const registry = new WebGpuResourceRegistry();
    const destroyNative = vi.fn();
    registry.register('texture', { estimatedBytes: 128 }, {}, destroyNative);
    registry.register('pipeline', {}, {});

    registry.releaseAll(false);

    expect(destroyNative).not.toHaveBeenCalled();
    expect(registry.getStatistics()).toMatchObject({
      activeCount: 0,
      activeEstimatedBytes: 0,
      createdTotal: 2,
      destroyedTotal: 2,
    });
  });

  it('retains failed resources for a later explicit disposal retry', () => {
    const registry = new WebGpuResourceRegistry();
    const failure = new Error('native destroy failure');
    const destroyNative = vi.fn(() => {
      throw failure;
    });
    const handle = registry.register(
      'buffer',
      { estimatedBytes: 32, label: 'failed' },
      {},
      destroyNative,
    );

    expect(() => registry.destroy(handle)).toThrow(
      expect.objectContaining({ code: 'RESOURCE_DISPOSE_FAILED', cause: failure }),
    );
    expect(registry.getStatistics()).toMatchObject({
      activeCount: 1,
      activeEstimatedBytes: 32,
      destroyedTotal: 0,
    });
  });

  it('rejects invalid byte estimates and mismatched resource kinds', () => {
    const registry = new WebGpuResourceRegistry();
    expect(() => registry.register('buffer', { estimatedBytes: -1 }, {})).toThrow(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    );
    const handle = registry.register('buffer', {}, {});
    expect(() =>
      registry.resolve(handle as unknown as BackendResourceHandle<'texture'>, 'texture'),
    ).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  });
});
