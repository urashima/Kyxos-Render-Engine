import { MockBackend } from '@kyxos/render-testing';
import { describe, expect, it, vi } from 'vitest';

import { DeferredGBuffer } from '../src/index.js';

describe('DeferredGBuffer', () => {
  it('owns a five-texture current-frame GBuffer without legacy History resources', async () => {
    const backend = new MockBackend();
    await backend.initialize();
    const gbuffer = new DeferredGBuffer({ height: 2, ownerId: 'viewport-a', width: 4 });
    const createTexture = vi.spyOn(backend, 'createTexture');

    expect(gbuffer.getDiagnostics()).toEqual({
      estimatedGpuBytes: 256,
      ownerId: 'viewport-a',
      resourceGeneration: 0,
      size: { height: 2, width: 4 },
      state: 'detached',
    });

    gbuffer.initialize(backend);
    gbuffer.initialize(backend);
    expect(createTexture).toHaveBeenCalledTimes(5);
    expect(createTexture).toHaveBeenNthCalledWith(1, {
      format: 'rgba16float',
      label: 'deferred-gbuffer-viewport-a-base-color-metallic',
      size: { height: 2, width: 4 },
      usage: ['render-attachment', 'sampled'],
    });
    expect(createTexture).toHaveBeenNthCalledWith(2, {
      format: 'depth32float',
      label: 'deferred-gbuffer-viewport-a-depth',
      size: { height: 2, width: 4 },
      usage: ['render-attachment', 'sampled'],
    });
    expect(createTexture).toHaveBeenNthCalledWith(3, {
      format: 'rgba16float',
      label: 'deferred-gbuffer-viewport-a-emissive-occlusion',
      size: { height: 2, width: 4 },
      usage: ['render-attachment', 'sampled'],
    });
    expect(createTexture).toHaveBeenNthCalledWith(4, {
      format: 'rgba16float',
      label: 'deferred-gbuffer-viewport-a-normal-roughness',
      size: { height: 2, width: 4 },
      usage: ['render-attachment', 'sampled'],
    });
    expect(createTexture).toHaveBeenNthCalledWith(5, {
      format: 'rg16float',
      label: 'deferred-gbuffer-viewport-a-velocity',
      size: { height: 2, width: 4 },
      usage: ['render-attachment', 'sampled'],
    });

    const frame = gbuffer.acquireFrame();
    expect(frame).toMatchObject({
      ownerId: 'viewport-a',
      resourceGeneration: 1,
      size: { height: 2, width: 4 },
    });
    expect(Object.isFrozen(frame)).toBe(true);
    expect(Object.isFrozen(frame.size)).toBe(true);
    expect(new Set([
      frame.baseColorMetallicTexture,
      frame.depthTexture,
      frame.emissiveOcclusionTexture,
      frame.normalRoughnessTexture,
      frame.velocityTexture,
    ]).size).toBe(5);
    expect(backend.getResourceStatistics()).toMatchObject({
      activeCount: 5,
      activeEstimatedBytes: 256,
      byKind: { texture: { activeCount: 5, activeEstimatedBytes: 256 } },
      createdTotal: 5,
    });

    gbuffer.dispose();
    expect(backend.getResourceStatistics().activeCount).toBe(0);
    backend.dispose();
  });

  it('atomically replaces the complete target set on Resize', async () => {
    const backend = new MockBackend();
    await backend.initialize();
    const gbuffer = new DeferredGBuffer({ height: 2, ownerId: 'viewport-b', width: 4 });
    gbuffer.initialize(backend);
    const before = gbuffer.acquireFrame();

    expect(gbuffer.resize(8, 4)).toEqual({
      estimatedGpuBytes: 1024,
      ownerId: 'viewport-b',
      resourceGeneration: 2,
      size: { height: 4, width: 8 },
      state: 'ready',
    });
    const after = gbuffer.acquireFrame();
    expect(after.baseColorMetallicTexture).not.toBe(before.baseColorMetallicTexture);
    expect(after.depthTexture).not.toBe(before.depthTexture);
    expect(after.emissiveOcclusionTexture).not.toBe(before.emissiveOcclusionTexture);
    expect(after.normalRoughnessTexture).not.toBe(before.normalRoughnessTexture);
    expect(after.velocityTexture).not.toBe(before.velocityTexture);
    expect(backend.getResourceStatistics()).toMatchObject({
      activeCount: 5,
      activeEstimatedBytes: 1024,
      createdTotal: 10,
      destroyedTotal: 5,
    });

    gbuffer.resize(8, 4);
    expect(gbuffer.getDiagnostics().resourceGeneration).toBe(2);
    gbuffer.dispose();
    backend.dispose();
  });

  it('detaches on Device Lost and recreates fresh targets after recovery', async () => {
    const backend = new MockBackend();
    await backend.initialize();
    const gbuffer = new DeferredGBuffer({ height: 3, ownerId: 'viewport-c', width: 5 });
    gbuffer.initialize(backend);
    const before = gbuffer.acquireFrame();

    backend.simulateLoss({ message: 'forced deferred loss' });
    expect(gbuffer.getDiagnostics()).toMatchObject({
      resourceGeneration: 1,
      state: 'detached',
    });
    expect(() => gbuffer.acquireFrame()).toThrowError(
      expect.objectContaining({ code: 'INVALID_STATE', recoverable: true }),
    );
    expect(backend.getResourceStatistics().activeCount).toBe(0);

    await backend.initialize();
    gbuffer.initialize(backend);
    const restored = gbuffer.acquireFrame();
    expect(restored.resourceGeneration).toBe(2);
    expect(restored.baseColorMetallicTexture).not.toBe(before.baseColorMetallicTexture);
    expect(restored.depthTexture).not.toBe(before.depthTexture);
    expect(restored.emissiveOcclusionTexture).not.toBe(before.emissiveOcclusionTexture);
    expect(restored.normalRoughnessTexture).not.toBe(before.normalRoughnessTexture);
    expect(restored.velocityTexture).not.toBe(before.velocityTexture);

    gbuffer.dispose();
    expect(backend.getResourceStatistics().activeCount).toBe(0);
    backend.dispose();
  });

  it('rolls back partial replacement allocation and keeps the prior target set usable', async () => {
    const backend = new MockBackend();
    await backend.initialize();
    const gbuffer = new DeferredGBuffer({ height: 2, ownerId: 'rollback', width: 2 });
    gbuffer.initialize(backend);
    const before = gbuffer.acquireFrame();
    const createTexture = backend.createTexture.bind(backend);
    let textureCalls = 0;
    vi.spyOn(backend, 'createTexture').mockImplementation((descriptor) => {
      textureCalls += 1;
      if (textureCalls === 3) throw new Error('forced third Texture failure');
      return createTexture(descriptor);
    });

    expect(() => gbuffer.resize(4, 4)).toThrow('forced third Texture failure');
    expect(gbuffer.getDiagnostics()).toEqual({
      estimatedGpuBytes: 128,
      ownerId: 'rollback',
      resourceGeneration: 1,
      size: { height: 2, width: 2 },
      state: 'ready',
    });
    const after = gbuffer.acquireFrame();
    expect(after.baseColorMetallicTexture).toBe(before.baseColorMetallicTexture);
    expect(after.depthTexture).toBe(before.depthTexture);
    expect(after.emissiveOcclusionTexture).toBe(before.emissiveOcclusionTexture);
    expect(after.normalRoughnessTexture).toBe(before.normalRoughnessTexture);
    expect(after.velocityTexture).toBe(before.velocityTexture);
    expect(backend.getResourceStatistics()).toMatchObject({
      activeCount: 5,
      createdTotal: 7,
      destroyedTotal: 2,
    });

    gbuffer.dispose();
    backend.dispose();
  });

  it('validates construction and disposal boundaries', async () => {
    expect(() => new DeferredGBuffer({ height: 1, ownerId: ' ', width: 1 })).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    );
    expect(() => new DeferredGBuffer({ height: 0, ownerId: 'viewport', width: 1 })).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    );

    const backend = new MockBackend();
    await backend.initialize();
    const gbuffer = new DeferredGBuffer({ height: 1, ownerId: 'viewport', width: 1 });
    gbuffer.initialize(backend);
    gbuffer.dispose();
    gbuffer.dispose();

    expect(gbuffer.getDiagnostics().state).toBe('disposed');
    expect(() => gbuffer.acquireFrame()).toThrowError(
      expect.objectContaining({ code: 'ALREADY_DISPOSED' }),
    );
    backend.dispose();
  });
});
