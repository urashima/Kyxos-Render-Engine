import { MockBackend, ManualFrameDriver } from '@kyxos/render-testing';
import { describe, expect, it } from 'vitest';

import { createCubeGeometry } from '../src/index.js';
import { createKyxosTemporalPbrRenderer } from '../src/temporal-pbr.js';

function createTarget() {
  return { getContext: () => ({}), height: 32, width: 64 };
}

describe('createKyxosTemporalPbrRenderer', () => {
  it('drives one Surface through interaction, accumulation, sleep, reset, and disposal', async () => {
    const backend = new MockBackend();
    const frameDriver = new ManualFrameDriver();
    const renderer = await createKyxosTemporalPbrRenderer({
      backend,
      canvas: createTarget(),
      cssHeight: 32,
      cssWidth: 64,
      devicePixelRatio: 1,
      frameDriver,
      frustumCulling: false,
      ownerId: 'sdk-temporal-pbr',
      stabilizationMs: 0,
      targetSamples: 2,
    });
    renderer.meshRenderers.attach(renderer.scene.createEntity(), { mesh: createCubeGeometry() });

    let timestamp = 0;
    let flushCount = 0;
    while (frameDriver.pendingCount > 0 && flushCount < 8) {
      frameDriver.flush(timestamp);
      timestamp += 1;
      flushCount += 1;
    }

    expect(flushCount).toBe(4);
    expect(renderer.getTemporalDiagnostics()).toMatchObject({
      feature: {
        pbr: { outputTarget: 'dynamic-taa', pipelineCount: 12 },
        pipeline: {
          dynamicHistory: { history: { sampleCount: 4, valid: true } },
          present: { executionCount: 4 },
          staticHistory: {
            convergence: { converged: true, sampleCount: 2 },
            history: { sampleCount: 2, valid: true },
          },
        },
      },
      renderer: { renderMode: 'sleeping', state: 'ready' },
      scheduler: { mode: 'sleeping', pending: false },
    });
    expect(backend.getResourceStatistics().byKind.surface?.activeCount).toBe(1);

    renderer.resetTemporalHistory('material');
    expect(frameDriver.pendingCount).toBe(1);
    expect(renderer.getTemporalDiagnostics().scheduler).toMatchObject({
      historyResetPending: true,
      mode: 'interactive',
    });

    renderer.setActivity('animation', true, 'animation');
    frameDriver.flush(timestamp);
    expect(renderer.getTemporalDiagnostics().scheduler.activeActivities).toEqual(['animation']);
    renderer.setActivity('animation', false);

    renderer.dispose();
    expect(renderer.disposed).toBe(true);
    expect(backend.getResourceStatistics().activeCount).toBe(0);
  });
});
