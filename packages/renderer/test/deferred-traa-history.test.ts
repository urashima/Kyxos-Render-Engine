import { MockBackend } from '@kyxos/render-testing';
import { describe, expect, it, vi } from 'vitest';

import { DeferredTraaHistory } from '../src/index.js';

describe('DeferredTraaHistory', () => {
  it('owns only two linear-HDR Color/Depth sets and one sampler', async () => {
    const backend = new MockBackend();
    await backend.initialize();
    const history = new DeferredTraaHistory({ height: 2, ownerId: 'viewport-a', width: 4 });
    const createSampler = vi.spyOn(backend, 'createSampler');
    const createTexture = vi.spyOn(backend, 'createTexture');

    expect(history.getDiagnostics()).toEqual({
      estimatedGpuBytes: 192,
      frameOpen: false,
      historyGeneration: null,
      historyValid: false,
      lastResetReason: null,
      ownerId: 'viewport-a',
      readIndex: 0,
      resourceGeneration: 0,
      size: { height: 2, width: 4 },
      state: 'detached',
    });

    history.initialize(backend);
    history.initialize(backend);
    expect(createTexture).toHaveBeenCalledTimes(4);
    expect(createTexture).toHaveBeenNthCalledWith(1, {
      format: 'rgba16float',
      label: 'deferred-traa-history-viewport-a-0-color',
      size: { height: 2, width: 4 },
      usage: ['render-attachment', 'sampled'],
    });
    expect(createTexture).toHaveBeenNthCalledWith(2, {
      format: 'depth32float',
      label: 'deferred-traa-history-viewport-a-0-depth',
      size: { height: 2, width: 4 },
      usage: ['render-attachment', 'sampled'],
    });
    expect(createTexture).toHaveBeenNthCalledWith(3, {
      format: 'rgba16float',
      label: 'deferred-traa-history-viewport-a-1-color',
      size: { height: 2, width: 4 },
      usage: ['render-attachment', 'sampled'],
    });
    expect(createTexture).toHaveBeenNthCalledWith(4, {
      format: 'depth32float',
      label: 'deferred-traa-history-viewport-a-1-depth',
      size: { height: 2, width: 4 },
      usage: ['render-attachment', 'sampled'],
    });
    expect(createSampler).toHaveBeenCalledWith({
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
      addressModeW: 'clamp-to-edge',
      label: 'deferred-traa-history-viewport-a-sampler',
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'nearest',
    });
    expect(backend.getResourceStatistics()).toMatchObject({
      activeCount: 5,
      activeEstimatedBytes: 192,
      createdTotal: 5,
    });

    history.dispose();
    expect(backend.getResourceStatistics().activeCount).toBe(0);
    backend.dispose();
  });

  it('publishes atomic prepare, commit, cancel, reset, and reuse roles', async () => {
    const backend = new MockBackend();
    await backend.initialize();
    const history = new DeferredTraaHistory({ height: 2, ownerId: 'viewport-b', width: 3 });
    history.initialize(backend);

    expect(() => history.acquireResolvedFrame()).toThrowError(
      expect.objectContaining({ code: 'INVALID_STATE', recoverable: true }),
    );
    const first = history.prepareFrame({ historyGeneration: 0 });
    expect(first).toMatchObject({
      historyGeneration: 0,
      historyValid: false,
      ownerId: 'viewport-b',
      resourceGeneration: 1,
      size: { height: 2, width: 3 },
    });
    expect(first.readColorTexture).not.toBe(first.writeColorTexture);
    expect(first.readDepthTexture).not.toBe(first.writeDepthTexture);
    expect(() => history.prepareFrame({ historyGeneration: 0 })).toThrow('open frame');
    history.commitFrame();

    const resolvedFirst = history.acquireResolvedFrame();
    expect(resolvedFirst.colorTexture).toBe(first.writeColorTexture);
    expect(resolvedFirst.depthTexture).toBe(first.writeDepthTexture);
    expect(history.getDiagnostics()).toMatchObject({
      frameOpen: false,
      historyGeneration: 0,
      historyValid: true,
      lastResetReason: 'manual',
      readIndex: 1,
    });

    const second = history.prepareFrame({ historyGeneration: 0 });
    expect(second.historyValid).toBe(true);
    expect(second.readColorTexture).toBe(resolvedFirst.colorTexture);
    expect(second.writeColorTexture).toBe(first.readColorTexture);
    history.cancelFrame();
    expect(history.acquireResolvedFrame().colorTexture).toBe(resolvedFirst.colorTexture);

    const reset = history.prepareFrame({
      historyGeneration: 0,
      reset: true,
      resetReason: 'camera',
    });
    expect(reset.historyValid).toBe(false);
    history.commitFrame();
    expect(history.getDiagnostics()).toMatchObject({
      historyGeneration: 0,
      historyValid: true,
      lastResetReason: 'camera',
      readIndex: 1,
    });

    const nextGeneration = history.prepareFrame({ historyGeneration: 1 });
    expect(nextGeneration.historyValid).toBe(false);
    history.commitFrame();
    expect(history.getDiagnostics()).toMatchObject({
      historyGeneration: 1,
      lastResetReason: 'scene',
    });

    history.invalidate('settings');
    expect(history.getDiagnostics()).toMatchObject({
      historyValid: false,
      lastResetReason: 'settings',
      readIndex: 0,
    });
    expect(() => history.acquireResolvedFrame()).toThrowError(
      expect.objectContaining({ code: 'INVALID_STATE', recoverable: true }),
    );

    history.dispose();
    backend.dispose();
  });

  it('atomically replaces both History sets on Resize and rejects open-frame Resize', async () => {
    const backend = new MockBackend();
    await backend.initialize();
    const history = new DeferredTraaHistory({ height: 2, ownerId: 'viewport-c', width: 2 });
    history.initialize(backend);
    const first = history.prepareFrame({ historyGeneration: 0 });
    expect(() => history.resize(4, 3)).toThrow('open frame');
    history.commitFrame();
    const before = history.acquireResolvedFrame();

    expect(history.resize(4, 3)).toEqual({
      estimatedGpuBytes: 288,
      frameOpen: false,
      historyGeneration: null,
      historyValid: false,
      lastResetReason: 'viewport',
      ownerId: 'viewport-c',
      readIndex: 0,
      resourceGeneration: 2,
      size: { height: 3, width: 4 },
      state: 'ready',
    });
    const resized = history.prepareFrame({ historyGeneration: 1 });
    expect(resized.readColorTexture).not.toBe(first.readColorTexture);
    expect(resized.readColorTexture).not.toBe(before.colorTexture);
    expect(resized.writeColorTexture).not.toBe(first.writeColorTexture);
    expect(resized.historyValid).toBe(false);
    history.cancelFrame();
    expect(backend.getResourceStatistics()).toMatchObject({
      activeCount: 5,
      activeEstimatedBytes: 288,
      createdTotal: 10,
      destroyedTotal: 5,
    });

    history.resize(4, 3);
    expect(history.getDiagnostics().resourceGeneration).toBe(2);
    history.dispose();
    backend.dispose();
  });

  it('rolls back partial Resize allocation and keeps the committed History reusable', async () => {
    const backend = new MockBackend();
    await backend.initialize();
    const history = new DeferredTraaHistory({ height: 2, ownerId: 'rollback', width: 2 });
    history.initialize(backend);
    history.prepareFrame({ historyGeneration: 0 });
    history.commitFrame();
    const before = history.acquireResolvedFrame();
    const createTexture = backend.createTexture.bind(backend);
    let textureCalls = 0;
    vi.spyOn(backend, 'createTexture').mockImplementation((descriptor) => {
      textureCalls += 1;
      if (textureCalls === 3) throw new Error('forced third History Texture failure');
      return createTexture(descriptor);
    });

    expect(() => history.resize(4, 4)).toThrow('forced third History Texture failure');
    expect(history.getDiagnostics()).toMatchObject({
      estimatedGpuBytes: 96,
      historyGeneration: 0,
      historyValid: true,
      resourceGeneration: 1,
      size: { height: 2, width: 2 },
      state: 'ready',
    });
    const after = history.acquireResolvedFrame();
    expect(after.colorTexture).toBe(before.colorTexture);
    expect(after.depthTexture).toBe(before.depthTexture);
    expect(backend.getResourceStatistics()).toMatchObject({
      activeCount: 5,
      createdTotal: 7,
      destroyedTotal: 2,
    });

    history.dispose();
    backend.dispose();
  });

  it('detaches invalid History on Device Lost and restores a fresh resource generation', async () => {
    const backend = new MockBackend();
    await backend.initialize();
    const history = new DeferredTraaHistory({ height: 3, ownerId: 'viewport-d', width: 5 });
    history.initialize(backend);
    history.prepareFrame({ historyGeneration: 2 });
    history.commitFrame();
    const before = history.acquireResolvedFrame();

    backend.simulateLoss({ message: 'forced Deferred TRAA History loss' });
    expect(history.getDiagnostics()).toMatchObject({
      frameOpen: false,
      historyGeneration: null,
      historyValid: false,
      lastResetReason: 'device-lost',
      readIndex: 0,
      resourceGeneration: 1,
      state: 'detached',
    });
    expect(() => history.acquireResolvedFrame()).toThrowError(
      expect.objectContaining({ code: 'INVALID_STATE', recoverable: true }),
    );
    expect(backend.getResourceStatistics().activeCount).toBe(0);

    await backend.initialize();
    history.initialize(backend);
    const restored = history.prepareFrame({ historyGeneration: 3 });
    expect(restored.resourceGeneration).toBe(2);
    expect(restored.historyValid).toBe(false);
    expect(restored.writeColorTexture).not.toBe(before.colorTexture);
    history.cancelFrame();

    history.dispose();
    expect(backend.getResourceStatistics().activeCount).toBe(0);
    backend.dispose();
  });

  it('validates owner, extent, generation, commit, and disposal boundaries', async () => {
    expect(() => new DeferredTraaHistory({ height: 1, ownerId: ' ', width: 1 })).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    );
    expect(
      () => new DeferredTraaHistory({ height: 0, ownerId: 'viewport', width: 1 }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));

    const backend = new MockBackend();
    await backend.initialize();
    const history = new DeferredTraaHistory({ height: 1, ownerId: 'viewport', width: 1 });
    history.initialize(backend);
    expect(() => history.prepareFrame({ historyGeneration: -1 })).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    );
    expect(() => history.commitFrame()).toThrowError(
      expect.objectContaining({ code: 'INVALID_STATE' }),
    );
    history.dispose();
    history.dispose();
    expect(history.getDiagnostics().state).toBe('disposed');
    expect(() => history.prepareFrame({ historyGeneration: 0 })).toThrowError(
      expect.objectContaining({ code: 'ALREADY_DISPOSED' }),
    );
    backend.dispose();
  });
});
