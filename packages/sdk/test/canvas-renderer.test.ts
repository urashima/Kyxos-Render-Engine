import { ManualFrameDriver, MockBackend } from '@kyxos/render-testing';
import { describe, expect, it } from 'vitest';

import { KyxosCanvasRenderer, createKyxosRenderer } from '../src/index.js';

describe('public Canvas renderer SDK', () => {
  it('returns a stable fallback error when automatic WebGPU selection is unavailable', async () => {
    await expect(
      createKyxosRenderer({
        backend: 'auto',
        canvas: { getContext: () => null, height: 180, width: 320 },
        devicePixelRatio: 1,
        frameDriver: new ManualFrameDriver(),
      }),
    ).rejects.toMatchObject({
      code: 'BACKEND_UNAVAILABLE',
      recoverable: true,
      suggestedAction: expect.stringContaining('WebGL2'),
    });
  });

  it('owns basic geometry, Resize, primitive changes, recovery, and disposal', async () => {
    const backend = new MockBackend();
    const frameDriver = new ManualFrameDriver();
    const canvas = {
      getContext: () => ({}),
      height: 180,
      width: 320,
    };
    const renderer = await createKyxosRenderer({
      backend,
      canvas,
      devicePixelRatio: 2,
      frameDriver,
      primitive: 'triangle',
    });

    expect(renderer).toBeInstanceOf(KyxosCanvasRenderer);
    expect(renderer.getSurfaceInfo()).toMatchObject({
      size: { physicalHeight: 360, physicalWidth: 640, suspended: false },
    });
    expect(frameDriver.pendingCount).toBe(1);
    frameDriver.flush(10);
    expect(renderer.getDiagnostics().lastFrameStatistics).toEqual({
      drawCalls: 1,
      instances: 1,
      triangles: 1,
      vertices: 3,
    });

    renderer.setPrimitive('sphere');
    frameDriver.flush(20);
    expect(renderer.primitive).toBe('sphere');
    expect(renderer.getDiagnostics().lastFrameStatistics).toMatchObject({
      drawCalls: 1,
      triangles: 1024,
      vertices: 3072,
    });

    const hidden = renderer.resize({
      cssHeight: 0,
      cssWidth: 320,
      devicePixelRatio: 2,
    });
    expect(hidden.size.suspended).toBe(true);
    frameDriver.flush(30);
    expect(renderer.getDiagnostics().lastFrameStatistics.drawCalls).toBe(0);

    backend.simulateLoss({ message: 'sdk recovery' });
    expect(renderer.state).toBe('lost');
    await renderer.recover();
    expect(renderer.state).toBe('ready');
    expect(backend.getResourceStatistics().activeCount).toBe(6);
    frameDriver.flush(40);

    renderer.dispose();
    expect(frameDriver.pendingCount).toBe(0);
    expect(backend.getResourceStatistics()).toMatchObject({
      activeCount: 0,
      activeEstimatedBytes: 0,
    });
  });
});
