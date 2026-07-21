import { ManualFrameDriver, MockBackend } from '@kyxos/render-testing';
import { describe, expect, it, vi } from 'vitest';

import { KyxosRenderer } from '../src/index.js';

describe('KyxosRenderer foundation shell', () => {
  it('creates, coalesces invalidation, emits one frame, sleeps, and disposes resources', async () => {
    const backend = new MockBackend();
    const frameDriver = new ManualFrameDriver();
    const renderer = new KyxosRenderer({ backend, frameDriver });
    const onFrame = vi.fn();
    const onWake = vi.fn();
    const onSleep = vi.fn();
    renderer.on('frame', onFrame);
    renderer.on('wake', onWake);
    renderer.on('sleep', onSleep);

    await renderer.initialize();
    backend.createResource('texture', { estimatedBytes: 1024 });
    renderer.invalidate('material');
    renderer.invalidate('camera');

    expect(frameDriver.pendingCount).toBe(1);
    frameDriver.flush(20);

    expect(onWake).toHaveBeenCalledOnce();
    expect(onFrame).toHaveBeenCalledExactlyOnceWith({
      dirtyFlags: ['camera', 'material'],
      frameIndex: 1,
      statistics: { drawCalls: 0, instances: 0, triangles: 0, vertices: 0 },
      timestamp: 20,
    });
    expect(onSleep).toHaveBeenCalledOnce();
    expect(renderer.getDiagnostics()).toMatchObject({
      backend: {
        resources: { activeCount: 1, activeEstimatedBytes: 1024 },
        type: 'mock',
      },
      frameIndex: 1,
      renderMode: 'sleeping',
      state: 'ready',
    });

    renderer.dispose();
    renderer.dispose();
    expect(frameDriver.pendingCount).toBe(0);
    expect(backend.getResourceStatistics()).toMatchObject({
      activeCount: 0,
      activeEstimatedBytes: 0,
    });
  });

  it('registers all extension categories and owns their disposal', async () => {
    const renderer = new KyxosRenderer({
      backend: new MockBackend(),
      frameDriver: new ManualFrameDriver(),
    });
    await renderer.initialize();
    const disposeFeature = vi.fn();
    const unregisterFeature = renderer.registerRenderFeature({
      dispose: disposeFeature,
      id: 'ssdo',
    });
    renderer.registerMaterialExtension({ id: 'clearcoat' });
    renderer.registerAssetDecoder({ id: 'ktx2' });
    renderer.registerPreviewPreset({ id: 'material-sphere' });

    expect(renderer.getDiagnostics().registrations).toEqual({
      assetDecoders: 1,
      materialExtensions: 1,
      previewPresets: 1,
      renderFeatures: 1,
    });
    expect(() => renderer.registerRenderFeature({ id: 'ssdo' })).toThrowError(
      expect.objectContaining({ code: 'EXTENSION_REGISTRATION_FAILED' }),
    );

    unregisterFeature();
    unregisterFeature();
    expect(disposeFeature).toHaveBeenCalledOnce();
    expect(renderer.getDiagnostics().registrations.renderFeatures).toBe(0);

    renderer.dispose();
  });

  it('cancels pending frames on backend loss and supports explicit reinitialization', async () => {
    const backend = new MockBackend();
    const frameDriver = new ManualFrameDriver();
    const renderer = new KyxosRenderer({ backend, frameDriver });
    const onLost = vi.fn();
    renderer.on('device-lost', onLost);
    await renderer.initialize();
    renderer.invalidate('geometry');

    backend.simulateLoss({ message: 'forced loss' });

    expect(renderer.state).toBe('lost');
    expect(frameDriver.pendingCount).toBe(0);
    expect(onLost).toHaveBeenCalledExactlyOnceWith({
      message: 'forced loss',
      reason: 'unknown',
      recoverable: true,
    });

    await renderer.initialize();
    expect(renderer.state).toBe('ready');
    renderer.dispose();
  });
});
