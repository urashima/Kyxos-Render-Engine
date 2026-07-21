import { createBackendCapabilityReport } from '@kyxos/render-backend-api';
import { KyxosEngineError } from '@kyxos/render-core';
import { describe, expect, it, vi } from 'vitest';

import { MockBackend } from '../src/index.js';

describe('MockBackend', () => {
  it('reports explicit immutable capabilities and lifecycle transitions', async () => {
    const backend = new MockBackend({
      capabilities: createBackendCapabilityReport({
        backend: 'mock',
        features: { compute: true },
        limits: { maxTextureDimension2D: 4096 },
      }),
    });
    const transitions: string[] = [];
    backend.on('statechange', ({ current, previous }) =>
      transitions.push(`${previous}->${current}`),
    );

    await backend.initialize();
    await backend.initialize();

    expect(backend.state).toBe('ready');
    expect(backend.capabilities.features.compute).toBe(true);
    expect(backend.capabilities.features['shader-f16']).toBe(false);
    expect(backend.capabilities.limits.maxTextureDimension2D).toBe(4096);
    expect(Object.isFrozen(backend.capabilities.features)).toBe(true);
    expect(transitions).toEqual(['new->initializing', 'initializing->ready']);
  });

  it('accounts for resources and returns active counters to baseline', async () => {
    const backend = new MockBackend();
    await backend.initialize();
    const baseline = backend.getResourceStatistics();
    const texture = backend.createResource('texture', { estimatedBytes: 4096, label: 'albedo' });
    const buffer = backend.createResource('buffer', { estimatedBytes: 256 });

    const active = backend.getResourceStatistics();
    expect(active).toMatchObject({
      activeCount: 2,
      activeEstimatedBytes: 4352,
      createdTotal: 2,
      destroyedTotal: 0,
    });
    expect(active.byKind.texture).toEqual({ activeCount: 1, activeEstimatedBytes: 4096 });
    expect(backend.destroyResource(texture)).toBe(true);
    expect(backend.destroyResource(texture)).toBe(false);
    expect(backend.destroyResource(buffer)).toBe(true);

    const released = backend.getResourceStatistics();
    expect(released.activeCount).toBe(baseline.activeCount);
    expect(released.activeEstimatedBytes).toBe(baseline.activeEstimatedBytes);
    expect(released.createdTotal).toBe(2);
    expect(released.destroyedTotal).toBe(2);
  });

  it('never reuses handles after explicit resource destruction', async () => {
    const backend = new MockBackend();
    await backend.initialize();
    const first = backend.createResource('texture');
    backend.destroyResource(first);
    const second = backend.createResource('texture');

    expect(second.id).toBeGreaterThan(first.id);
    expect(second.kind).toBe('backend:texture');
  });

  it('rejects invalid creation states and resource byte estimates', async () => {
    const backend = new MockBackend();
    expect(() => backend.createResource('buffer')).toThrow(KyxosEngineError);
    await backend.initialize();
    expect(() => backend.createResource('buffer', { estimatedBytes: -1 })).toThrow(
      KyxosEngineError,
    );

    backend.dispose();
    await expect(backend.initialize()).rejects.toMatchObject({ code: 'ALREADY_DISPOSED' });
  });

  it('reports an unavailable capability result as a recoverable startup error', async () => {
    const backend = new MockBackend({
      capabilities: createBackendCapabilityReport({
        available: false,
        backend: 'mock',
        unavailableReason: 'test backend disabled',
      }),
    });

    await expect(backend.initialize()).rejects.toMatchObject({
      code: 'BACKEND_UNAVAILABLE',
      message: 'test backend disabled',
      recoverable: true,
    });
    expect(backend.state).toBe('new');
  });

  it('invalidates resources on loss, reports the cause, and can reinitialize', async () => {
    const backend = new MockBackend();
    const onLost = vi.fn();
    backend.on('lost', onLost);
    await backend.initialize();
    backend.createResource('pipeline', { estimatedBytes: 128 });

    backend.simulateLoss({ message: 'test loss', reason: 'destroyed' });

    expect(backend.state).toBe('lost');
    expect(backend.getResourceStatistics()).toMatchObject({
      activeCount: 0,
      activeEstimatedBytes: 0,
      createdTotal: 1,
      destroyedTotal: 1,
    });
    expect(onLost).toHaveBeenCalledExactlyOnceWith({
      message: 'test loss',
      reason: 'destroyed',
      recoverable: true,
    });

    await backend.initialize();
    expect(backend.state).toBe('ready');
  });

  it('releases every resource on idempotent disposal', async () => {
    const backend = new MockBackend();
    await backend.initialize();
    backend.createResource('texture', { estimatedBytes: 512 });
    backend.createResource('buffer', { estimatedBytes: 64 });

    backend.dispose();
    backend.dispose();

    expect(backend.disposed).toBe(true);
    expect(backend.getResourceStatistics()).toMatchObject({
      activeCount: 0,
      activeEstimatedBytes: 0,
      createdTotal: 2,
      destroyedTotal: 2,
    });
  });
});
