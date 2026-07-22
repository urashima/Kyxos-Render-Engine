import type {
  TemporalHistoryInvalidationReason,
  TemporalHistorySignatureDescriptor,
} from '@kyxos/render-temporal';
import { MockBackend } from '@kyxos/render-testing';
import { describe, expect, it, vi } from 'vitest';

import { StaticAccumulationGpuHistory } from '../src/index.js';

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

const dirtyInvalidations: readonly TemporalHistoryInvalidationReason[] = [
  'accumulation',
  'animation',
  'camera',
  'environment',
  'geometry',
  'light',
  'material',
  'post-process',
  'texture',
  'transform',
  'viewport',
];

describe('StaticAccumulationGpuHistory', () => {
  it('owns two HDR targets, commits atomically, converges at the sample limit, and restarts on signature change', async () => {
    const backend = new MockBackend();
    await backend.initialize();
    const history = new StaticAccumulationGpuHistory({
      height: 2,
      ownerId: 'static-a',
      targetSamples: 3,
      width: 4,
    });
    const createTexture = vi.spyOn(backend, 'createTexture');
    const createSampler = vi.spyOn(backend, 'createSampler');
    expect(history.getDiagnostics()).toMatchObject({
      convergence: { converged: false, sampleCount: 0, targetSamples: 3 },
      estimatedGpuBytes: 128,
      frameOpen: false,
      history: { kind: 'static', sampleCount: 0, valid: false },
      ownerId: 'static-a',
      resourceGeneration: 0,
      state: 'detached',
    });

    history.initialize(backend);
    history.initialize(backend);
    expect(createTexture).toHaveBeenCalledTimes(2);
    expect(createTexture).toHaveBeenNthCalledWith(1, {
      format: 'rgba16float',
      label: 'static-accumulation-static-a-0-color',
      size: { height: 2, width: 4 },
      usage: ['render-attachment', 'sampled'],
    });
    expect(createTexture).toHaveBeenNthCalledWith(2, {
      format: 'rgba16float',
      label: 'static-accumulation-static-a-1-color',
      size: { height: 2, width: 4 },
      usage: ['render-attachment', 'sampled'],
    });
    expect(createSampler).toHaveBeenCalledExactlyOnceWith({
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
      addressModeW: 'clamp-to-edge',
      label: 'static-accumulation-static-a-sampler',
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
      ownerId: 'static-a',
      previousSampleCount: 0,
      resourceGeneration: 1,
      size: { height: 2, width: 4 },
    });
    expect(first.readColorTexture).not.toBe(first.writeColorTexture);
    expect(() => history.getAccumulatedColorTexture()).toThrow('no committed Color');
    expect(() => history.prepareFrame(signature())).toThrow('already has an open frame');
    expect(history.commitFrame()).toMatchObject({
      convergence: { converged: false, sampleCount: 1 },
      frameOpen: false,
      history: { generation: 0, sampleCount: 1, valid: true },
    });
    expect(history.getAccumulatedColorTexture()).toBe(first.writeColorTexture);

    const second = history.prepareFrame(signature());
    expect(second).toMatchObject({ historyValid: true, previousSampleCount: 1 });
    expect(second.readColorTexture).toBe(first.writeColorTexture);
    expect(second.writeColorTexture).toBe(first.readColorTexture);
    history.commitFrame();
    const third = history.prepareFrame(signature());
    expect(third).toMatchObject({ historyValid: true, previousSampleCount: 2 });
    expect(history.commitFrame()).toMatchObject({
      convergence: { converged: true, reason: 'sample-limit', sampleCount: 3 },
      history: { sampleCount: 3 },
    });
    expect(history.getAccumulatedColorTexture()).toBe(third.writeColorTexture);
    expect(() => history.prepareFrame(signature())).toThrow('has converged');

    const changed = history.prepareFrame(signature({ materials: 2 }));
    expect(changed).toMatchObject({ historyValid: false, previousSampleCount: 0 });
    expect(history.commitFrame()).toMatchObject({
      convergence: { converged: false, sampleCount: 1 },
      history: {
        generation: 1,
        lastInvalidation: 'signature-mismatch',
        sampleCount: 1,
        valid: true,
      },
    });

    history.dispose();
    history.dispose();
    expect(backend.getResourceStatistics()).toMatchObject({
      activeCount: 0,
      createdTotal: 3,
      destroyedTotal: 3,
    });
    expect(backend.state).toBe('ready');
    backend.dispose();
  });

  it('converges only after the configured consecutive stable errors', async () => {
    const backend = new MockBackend();
    await backend.initialize();
    const history = new StaticAccumulationGpuHistory({
      errorThreshold: 0.01,
      height: 1,
      minimumSamples: 3,
      ownerId: 'static-threshold',
      stableSamples: 2,
      targetSamples: 8,
      width: 1,
    });
    history.initialize(backend);

    for (const value of [0.2, 0.005, 0.02, 0.01]) {
      history.prepareFrame(signature());
      expect(history.commitFrame(value).convergence.converged).toBe(false);
    }
    history.prepareFrame(signature());
    expect(history.commitFrame(0.001)).toMatchObject({
      convergence: {
        consecutiveStableSamples: 2,
        converged: true,
        lastError: 0.001,
        reason: 'error-threshold',
        sampleCount: 5,
      },
      history: { sampleCount: 5 },
    });
    expect(() => history.prepareFrame(signature())).toThrow('error-threshold');
    expect(() => history.commitFrame()).toThrow('no prepared frame');

    history.dispose();
    expect(backend.getResourceStatistics().activeCount).toBe(0);
    backend.dispose();
  });

  it('resets both History and convergence for every render-affecting Dirty invalidation', async () => {
    const backend = new MockBackend();
    await backend.initialize();
    const history = new StaticAccumulationGpuHistory({
      height: 1,
      ownerId: 'static-dirty',
      targetSamples: 2,
      width: 1,
    });
    history.initialize(backend);

    let revision = 1;
    for (const reason of dirtyInvalidations) {
      history.prepareFrame(signature({ scene: revision }));
      history.commitFrame();
      expect(history.invalidate(reason)).toMatchObject({
        convergence: { consecutiveStableSamples: 0, converged: false, sampleCount: 0 },
        frameOpen: false,
        history: { lastInvalidation: reason, sampleCount: 0, valid: false },
      });
      revision += 1;
    }

    history.dispose();
    expect(backend.getResourceStatistics().activeCount).toBe(0);
    backend.dispose();
  });

  it('atomically resizes, detaches on Device Lost, restores fresh resources, and rolls back allocation failure', async () => {
    const backend = new MockBackend();
    await backend.initialize();
    const history = new StaticAccumulationGpuHistory({
      height: 2,
      ownerId: 'static-lifecycle',
      targetSamples: 4,
      width: 2,
    });
    history.initialize(backend);
    const before = history.prepareFrame(signature());
    history.commitFrame();

    expect(history.resize(4, 3)).toMatchObject({
      convergence: { sampleCount: 0 },
      estimatedGpuBytes: 192,
      history: {
        generation: 1,
        lastInvalidation: 'viewport',
        sampleCount: 0,
        valid: false,
      },
      resourceGeneration: 2,
      size: { height: 3, width: 4 },
    });
    expect(backend.getResourceStatistics()).toMatchObject({
      activeCount: 3,
      activeEstimatedBytes: 192,
      createdTotal: 6,
      destroyedTotal: 3,
    });
    const resized = history.prepareFrame(signature({ viewport: 2 }));
    expect(resized.historyValid).toBe(false);
    expect(resized.readColorTexture).not.toBe(before.readColorTexture);
    expect(resized.writeColorTexture).not.toBe(before.writeColorTexture);
    expect(() => history.resize(8, 8)).toThrow('during an open frame');
    history.cancelFrame();

    const createTexture = backend.createTexture.bind(backend);
    let textureCalls = 0;
    vi.spyOn(backend, 'createTexture').mockImplementation((descriptor) => {
      textureCalls += 1;
      if (textureCalls === 2) throw new Error('forced Static second Texture failure');
      return createTexture(descriptor);
    });
    expect(() => history.resize(8, 8)).toThrow('forced Static second Texture failure');
    expect(history.getDiagnostics()).toMatchObject({
      resourceGeneration: 2,
      size: { height: 3, width: 4 },
      state: 'ready',
    });
    expect(backend.getResourceStatistics()).toMatchObject({
      activeCount: 3,
      createdTotal: 7,
      destroyedTotal: 4,
    });
    vi.restoreAllMocks();

    history.prepareFrame(signature({ viewport: 2 }));
    history.commitFrame();
    backend.simulateLoss({ message: 'forced Static accumulation loss' });
    expect(history.getDiagnostics()).toMatchObject({
      convergence: { sampleCount: 0 },
      history: { lastInvalidation: 'device', sampleCount: 0, valid: false },
      resourceGeneration: 2,
      state: 'detached',
    });
    expect(() => history.prepareFrame(signature())).toThrowError(
      expect.objectContaining({ code: 'INVALID_STATE', recoverable: true }),
    );
    expect(backend.getResourceStatistics().activeCount).toBe(0);

    await backend.initialize();
    history.initialize(backend);
    const restored = history.prepareFrame(signature({ device: 2, viewport: 2 }));
    expect(restored).toMatchObject({
      historyValid: false,
      previousSampleCount: 0,
      resourceGeneration: 3,
    });
    expect(restored.readColorTexture).not.toBe(resized.readColorTexture);
    expect(restored.writeColorTexture).not.toBe(resized.writeColorTexture);
    history.cancelFrame();
    expect(backend.getResourceStatistics()).toMatchObject({
      activeCount: 3,
      createdTotal: 10,
      destroyedTotal: 7,
    });

    history.dispose();
    expect(backend.getResourceStatistics()).toMatchObject({
      activeCount: 0,
      createdTotal: 10,
      destroyedTotal: 10,
    });
    expect(() => history.prepareFrame(signature())).toThrowError(
      expect.objectContaining({ code: 'ALREADY_DISPOSED' }),
    );
    backend.dispose();
  });
});
