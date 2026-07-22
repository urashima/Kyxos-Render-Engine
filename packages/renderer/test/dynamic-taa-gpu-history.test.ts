import type { TemporalHistorySignatureDescriptor } from '@kyxos/render-temporal';
import { MockBackend } from '@kyxos/render-testing';
import { describe, expect, it, vi } from 'vitest';

import { DynamicTaaGpuHistory } from '../src/index.js';

function signature(
  overrides: Partial<TemporalHistorySignatureDescriptor> = {},
): TemporalHistorySignatureDescriptor {
  return {
    camera: 1,
    device: 1,
    environment: 1,
    geometry: 1,
    lighting: 1,
    materials: 1,
    postProcess: 1,
    scene: 1,
    viewport: 1,
    ...overrides,
  };
}

describe('DynamicTaaGpuHistory', () => {
  it('owns one rgba16float ping-pong pair and commits only prepared signatures', async () => {
    const backend = new MockBackend();
    await backend.initialize();
    const history = new DynamicTaaGpuHistory({ height: 2, ownerId: 'viewport-a', width: 4 });
    const createTexture = vi.spyOn(backend, 'createTexture');
    const createSampler = vi.spyOn(backend, 'createSampler');
    expect(history.getDiagnostics()).toMatchObject({
      estimatedGpuBytes: 128,
      frameOpen: false,
      history: { sampleCount: 0, valid: false },
      ownerId: 'viewport-a',
      resourceGeneration: 0,
      state: 'detached',
    });

    history.initialize(backend);
    history.initialize(backend);
    expect(createTexture).toHaveBeenCalledTimes(2);
    expect(createTexture).toHaveBeenNthCalledWith(1, {
      format: 'rgba16float',
      label: 'taa-history-viewport-a-0',
      size: { height: 2, width: 4 },
      usage: ['render-attachment', 'sampled'],
    });
    expect(createTexture).toHaveBeenNthCalledWith(2, {
      format: 'rgba16float',
      label: 'taa-history-viewport-a-1',
      size: { height: 2, width: 4 },
      usage: ['render-attachment', 'sampled'],
    });
    expect(createSampler).toHaveBeenCalledExactlyOnceWith({
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
      addressModeW: 'clamp-to-edge',
      label: 'taa-history-viewport-a-sampler',
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'nearest',
    });
    expect(backend.getResourceStatistics()).toMatchObject({
      activeCount: 3,
      activeEstimatedBytes: 128,
      byKind: {
        sampler: { activeCount: 1 },
        texture: { activeCount: 2, activeEstimatedBytes: 128 },
      },
      createdTotal: 3,
    });

    const first = history.prepareFrame(signature());
    expect(first).toMatchObject({
      historyValid: false,
      ownerId: 'viewport-a',
      resourceGeneration: 1,
      size: { height: 2, width: 4 },
    });
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.size)).toBe(true);
    expect(first.readTexture).not.toBe(first.writeTexture);
    expect(history.getDiagnostics().frameOpen).toBe(true);
    expect(() => history.prepareFrame(signature())).toThrow('already has an open frame');

    expect(history.commitFrame()).toMatchObject({
      frameOpen: false,
      history: { generation: 0, sampleCount: 1, valid: true },
    });
    const second = history.prepareFrame(signature());
    expect(second.historyValid).toBe(true);
    expect(second.readTexture).toBe(first.writeTexture);
    expect(second.writeTexture).toBe(first.readTexture);
    history.cancelFrame();

    const changed = history.prepareFrame(signature({ materials: 2 }));
    expect(changed.historyValid).toBe(false);
    expect(history.commitFrame()).toMatchObject({
      history: {
        generation: 1,
        lastInvalidation: 'signature-mismatch',
        sampleCount: 1,
        valid: true,
      },
    });

    history.dispose();
    backend.dispose();
  });

  it('atomically resizes, invalidates Viewport history, and disposes without owning Backend', async () => {
    const backend = new MockBackend();
    await backend.initialize();
    const history = new DynamicTaaGpuHistory({ height: 2, ownerId: 'viewport-b', width: 4 });
    history.initialize(backend);
    const before = history.prepareFrame(signature());
    history.commitFrame();

    expect(history.resize(8, 4)).toMatchObject({
      estimatedGpuBytes: 512,
      history: {
        generation: 1,
        lastInvalidation: 'viewport',
        sampleCount: 0,
        valid: false,
      },
      resourceGeneration: 2,
      size: { height: 4, width: 8 },
      state: 'ready',
    });
    expect(backend.getResourceStatistics()).toMatchObject({
      activeCount: 3,
      activeEstimatedBytes: 512,
      createdTotal: 6,
      destroyedTotal: 3,
    });
    const after = history.prepareFrame(signature({ viewport: 2 }));
    expect(after.historyValid).toBe(false);
    expect(after.readTexture).not.toBe(before.readTexture);
    expect(after.writeTexture).not.toBe(before.writeTexture);
    expect(() => history.resize(16, 8)).toThrow('during an open frame');
    history.cancelFrame();
    history.resize(8, 4);
    expect(history.getDiagnostics().resourceGeneration).toBe(2);

    history.dispose();
    history.dispose();
    expect(history.getDiagnostics()).toMatchObject({
      history: { disposed: true, lastInvalidation: 'disposed' },
      state: 'disposed',
    });
    expect(backend.state).toBe('ready');
    expect(backend.getResourceStatistics()).toMatchObject({ activeCount: 0 });
    expect(() => history.prepareFrame(signature())).toThrowError(
      expect.objectContaining({ code: 'ALREADY_DISPOSED' }),
    );
    backend.dispose();
  });

  it('detaches on Device Lost and restores fresh owner resources after Backend recovery', async () => {
    const backend = new MockBackend();
    await backend.initialize();
    const history = new DynamicTaaGpuHistory({ height: 3, ownerId: 'viewport-c', width: 5 });
    history.initialize(backend);
    const before = history.prepareFrame(signature());
    history.commitFrame();

    backend.simulateLoss({ message: 'forced temporal loss' });
    expect(history.getDiagnostics()).toMatchObject({
      history: { lastInvalidation: 'device', sampleCount: 0, valid: false },
      resourceGeneration: 1,
      state: 'detached',
    });
    expect(() => history.prepareFrame(signature())).toThrowError(
      expect.objectContaining({ code: 'INVALID_STATE', recoverable: true }),
    );
    expect(backend.getResourceStatistics().activeCount).toBe(0);

    await backend.initialize();
    history.initialize(backend);
    const restored = history.prepareFrame(signature({ device: 2 }));
    expect(restored.historyValid).toBe(false);
    expect(restored.resourceGeneration).toBe(2);
    expect(restored.readTexture).not.toBe(before.readTexture);
    expect(restored.writeTexture).not.toBe(before.writeTexture);
    history.cancelFrame();
    expect(backend.getResourceStatistics()).toMatchObject({
      activeCount: 3,
      createdTotal: 6,
      destroyedTotal: 3,
    });

    history.dispose();
    backend.dispose();
  });

  it('rolls back a partial Resize allocation and keeps the prior History usable', async () => {
    const backend = new MockBackend();
    await backend.initialize();
    const history = new DynamicTaaGpuHistory({ height: 2, ownerId: 'rollback', width: 2 });
    history.initialize(backend);
    const before = history.prepareFrame(signature());
    history.commitFrame();
    const createTexture = backend.createTexture.bind(backend);
    let textureCalls = 0;
    vi.spyOn(backend, 'createTexture').mockImplementation((descriptor) => {
      textureCalls += 1;
      if (textureCalls === 2) throw new Error('forced second Texture failure');
      return createTexture(descriptor);
    });

    expect(() => history.resize(4, 4)).toThrow('forced second Texture failure');
    expect(history.getDiagnostics()).toMatchObject({
      history: { sampleCount: 1, valid: true },
      resourceGeneration: 1,
      size: { height: 2, width: 2 },
      state: 'ready',
    });
    expect(backend.getResourceStatistics()).toMatchObject({
      activeCount: 3,
      createdTotal: 4,
      destroyedTotal: 1,
    });
    const after = history.prepareFrame(signature());
    expect(after.historyValid).toBe(true);
    expect(after.readTexture).toBe(before.writeTexture);
    expect(after.writeTexture).toBe(before.readTexture);
    history.cancelFrame();

    history.dispose();
    expect(backend.getResourceStatistics()).toMatchObject({
      activeCount: 0,
      createdTotal: 4,
      destroyedTotal: 4,
    });
    backend.dispose();
  });
});
