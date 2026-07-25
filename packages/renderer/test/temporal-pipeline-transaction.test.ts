import type { BackendRenderPassStatistics } from '@kyxos/render-backend-api';
import type { TemporalFrameMetadata } from '@kyxos/render-frame-scheduler';
import { identityMat4 } from '@kyxos/render-math';
import { MockBackend } from '@kyxos/render-testing';
import { describe, expect, it, vi } from 'vitest';

import { TemporalPipelineTransaction } from '../src/index.js';

const signature = {
  camera: 1,
  device: 1,
  environment: 1,
  geometry: 1,
  lighting: 1,
  materials: 1,
  postProcess: 1,
  scene: 1,
  viewport: 1,
} as const;

const currentStatistics: BackendRenderPassStatistics = Object.freeze({
  drawCalls: 1,
  instances: 1,
  triangles: 2,
  vertices: 6,
});

function createTarget() {
  return { getContext: () => ({}), height: 0, width: 0 };
}

function temporal(
  mode: TemporalFrameMetadata['mode'],
  sampleIndex: number,
  historyGeneration = 1,
  historyReset = false,
): TemporalFrameMetadata {
  return Object.freeze({
    historyGeneration,
    historyReset,
    mode,
    sampleIndex,
    targetSamples: 2,
  });
}

function createTransaction(): TemporalPipelineTransaction {
  return new TemporalPipelineTransaction({
    height: 2,
    output: { exposure: 0, toneMapping: 'none' },
    ownerId: 'temporal-pipeline',
    surface: {
      cssHeight: 2,
      cssWidth: 4,
      devicePixelRatio: 1,
      target: createTarget(),
    },
    targetSamples: 2,
    width: 4,
  });
}

describe('TemporalPipelineTransaction', () => {
  it('orders Dynamic TAA, optional Static Accumulation, Present, and atomic commits', async () => {
    const backend = new MockBackend();
    await backend.initialize();
    const transaction = createTransaction();
    await transaction.initialize(backend);
    await transaction.initialize(backend);
    const executeFrame = vi.spyOn(backend, 'executeFrame');

    const interactive = transaction.execute({
      currentInverseViewProjection: identityMat4(),
      dirtyFlags: ['camera'],
      previousViewProjection: identityMat4(),
      renderCurrent: () => currentStatistics,
      signature,
      temporal: temporal('interactive', 0, 1, true),
    });

    expect(interactive.presentedHistory).toBe('dynamic');
    expect(interactive.statistics).toEqual({
      drawCalls: 3,
      instances: 3,
      triangles: 4,
      vertices: 12,
    });
    expect(interactive.diagnostics).toMatchObject({
      dynamicHistory: { history: { sampleCount: 1, valid: true } },
      historyGeneration: 1,
      open: false,
      state: 'ready',
      staticHistory: { history: { sampleCount: 0, valid: false } },
    });

    const firstAccumulating = transaction.execute({
      currentInverseViewProjection: identityMat4(),
      dirtyFlags: [],
      previousViewProjection: identityMat4(),
      renderCurrent: () => currentStatistics,
      signature,
      temporal: temporal('accumulating', 1),
    });

    expect(firstAccumulating.presentedHistory).toBe('static');
    expect(firstAccumulating.statistics).toEqual({
      drawCalls: 4,
      instances: 4,
      triangles: 5,
      vertices: 15,
    });
    expect(firstAccumulating.diagnostics).toMatchObject({
      dynamicHistory: { history: { sampleCount: 2, valid: true } },
      staticHistory: {
        convergence: { converged: false, sampleCount: 1 },
        history: { sampleCount: 1, valid: true },
      },
    });

    const converged = transaction.execute({
      currentInverseViewProjection: identityMat4(),
      dirtyFlags: [],
      previousViewProjection: identityMat4(),
      renderCurrent: () => currentStatistics,
      signature,
      temporal: temporal('accumulating', 2),
    });

    expect(converged.diagnostics.staticHistory).toMatchObject({
      convergence: { converged: true, reason: 'sample-limit', sampleCount: 2 },
      history: { sampleCount: 2, valid: true },
    });

    const reset = transaction.execute({
      currentInverseViewProjection: identityMat4(),
      dirtyFlags: ['material'],
      previousViewProjection: identityMat4(),
      renderCurrent: () => currentStatistics,
      signature: { ...signature, materials: 2 },
      temporal: temporal('interactive', 0, 2, true),
    });

    expect(reset.presentedHistory).toBe('dynamic');
    expect(reset.diagnostics).toMatchObject({
      dynamicHistory: {
        history: { lastInvalidation: 'material', sampleCount: 1, valid: true },
      },
      historyGeneration: 2,
      staticHistory: {
        convergence: { converged: false, sampleCount: 0 },
        history: { lastInvalidation: 'material', sampleCount: 0, valid: false },
      },
    });

    const labels = executeFrame.mock.calls.map(
      ([submission]) => submission.renderPasses[0]?.label ?? 'missing',
    );
    expect(labels).toEqual([
      'taa-resolve-temporal-pipeline-pass',
      'taa-present-temporal-pipeline-pass',
      'taa-resolve-temporal-pipeline-pass',
      'static-accumulation-temporal-pipeline-pass',
      'taa-present-temporal-pipeline-pass',
      'taa-resolve-temporal-pipeline-pass',
      'static-accumulation-temporal-pipeline-pass',
      'taa-present-temporal-pipeline-pass',
      'taa-resolve-temporal-pipeline-pass',
      'taa-present-temporal-pipeline-pass',
    ]);

    expect(backend.getResourceStatistics().activeCount).toBeGreaterThan(0);
    transaction.dispose();
    transaction.dispose();
    expect(transaction.getDiagnostics().state).toBe('disposed');
    expect(backend.getResourceStatistics().activeCount).toBe(0);
    backend.dispose();
  });

  it('reuses canonical Bind Groups when History becomes non-reusable by signature only', async () => {
    const backend = new MockBackend();
    await backend.initialize();
    const transaction = createTransaction();
    await transaction.initialize(backend);

    transaction.execute({
      currentInverseViewProjection: identityMat4(),
      dirtyFlags: [],
      previousViewProjection: identityMat4(),
      renderCurrent: () => currentStatistics,
      signature,
      temporal: temporal('interactive', 0),
    });
    transaction.execute({
      currentInverseViewProjection: identityMat4(),
      dirtyFlags: [],
      previousViewProjection: identityMat4(),
      renderCurrent: () => currentStatistics,
      signature,
      temporal: temporal('accumulating', 1),
    });

    const baseline = backend.getResourceStatistics();
    expect(transaction.getDiagnostics()).toMatchObject({
      resolve: { activeBindGroupCount: 2 },
      staticPass: { activeBindGroupCount: 1 },
    });

    const changedSignature = { ...signature, postProcess: 2 };
    transaction.execute({
      currentInverseViewProjection: identityMat4(),
      dirtyFlags: [],
      previousViewProjection: identityMat4(),
      renderCurrent: () => currentStatistics,
      signature: changedSignature,
      temporal: temporal('interactive', 0),
    });
    transaction.execute({
      currentInverseViewProjection: identityMat4(),
      dirtyFlags: [],
      previousViewProjection: identityMat4(),
      renderCurrent: () => currentStatistics,
      signature: changedSignature,
      temporal: temporal('accumulating', 1),
    });

    expect(backend.getResourceStatistics().activeCount).toBe(baseline.activeCount);
    expect(transaction.getDiagnostics()).toMatchObject({
      resolve: { activeBindGroupCount: 2 },
      staticPass: { activeBindGroupCount: 1 },
    });

    transaction.dispose();
    expect(backend.getResourceStatistics().activeCount).toBe(0);
    backend.dispose();
  });

  it('coordinates canonical Bind Groups when History resets directly in accumulation', async () => {
    const backend = new MockBackend();
    await backend.initialize();
    const transaction = createTransaction();
    await transaction.initialize(backend);

    transaction.execute({
      currentInverseViewProjection: identityMat4(),
      dirtyFlags: [],
      previousViewProjection: identityMat4(),
      renderCurrent: () => currentStatistics,
      signature,
      temporal: temporal('interactive', 0),
    });
    transaction.execute({
      currentInverseViewProjection: identityMat4(),
      dirtyFlags: [],
      previousViewProjection: identityMat4(),
      renderCurrent: () => currentStatistics,
      signature,
      temporal: temporal('accumulating', 1),
    });
    transaction.execute({
      currentInverseViewProjection: identityMat4(),
      dirtyFlags: [],
      previousViewProjection: identityMat4(),
      renderCurrent: () => currentStatistics,
      signature,
      temporal: temporal('accumulating', 2),
    });

    const baselineActiveResources = backend.getResourceStatistics().activeCount;
    expect(transaction.getDiagnostics()).toMatchObject({
      resolve: { activeBindGroupCount: 2 },
      staticPass: { activeBindGroupCount: 2 },
    });

    const changedSignature = { ...signature, postProcess: 2 };
    transaction.execute({
      currentInverseViewProjection: identityMat4(),
      dirtyFlags: [],
      previousViewProjection: identityMat4(),
      renderCurrent: () => currentStatistics,
      signature: changedSignature,
      temporal: temporal('accumulating', 1),
    });
    transaction.execute({
      currentInverseViewProjection: identityMat4(),
      dirtyFlags: [],
      previousViewProjection: identityMat4(),
      renderCurrent: () => currentStatistics,
      signature: changedSignature,
      temporal: temporal('accumulating', 2),
    });

    expect(backend.getResourceStatistics().activeCount).toBe(baselineActiveResources);
    expect(transaction.getDiagnostics()).toMatchObject({
      resolve: { activeBindGroupCount: 2 },
      staticPass: { activeBindGroupCount: 2 },
    });

    transaction.dispose();
    expect(backend.getResourceStatistics().activeCount).toBe(0);
    backend.dispose();
  });

  it('reuses the same Bind Groups across repeated History resets', async () => {
    const backend = new MockBackend();
    await backend.initialize();
    const transaction = createTransaction();
    await transaction.initialize(backend);

    const executeCycle = (generation: number): void => {
      const cycleSignature = { ...signature, postProcess: generation };
      transaction.execute({
        currentInverseViewProjection: identityMat4(),
        dirtyFlags: ['post-process'],
        previousViewProjection: identityMat4(),
        renderCurrent: () => currentStatistics,
        signature: cycleSignature,
        temporal: temporal('interactive', 0, generation, true),
      });
      transaction.execute({
        currentInverseViewProjection: identityMat4(),
        dirtyFlags: [],
        previousViewProjection: identityMat4(),
        renderCurrent: () => currentStatistics,
        signature: cycleSignature,
        temporal: temporal('accumulating', 1, generation),
      });
      transaction.execute({
        currentInverseViewProjection: identityMat4(),
        dirtyFlags: [],
        previousViewProjection: identityMat4(),
        renderCurrent: () => currentStatistics,
        signature: cycleSignature,
        temporal: temporal('accumulating', 2, generation),
      });
    };

    executeCycle(1);
    const baselineActiveResources = backend.getResourceStatistics().activeCount;
    expect(transaction.getDiagnostics()).toMatchObject({
      resolve: { activeBindGroupCount: 2 },
      staticPass: { activeBindGroupCount: 2 },
    });

    executeCycle(2);
    expect(backend.getResourceStatistics().activeCount).toBe(baselineActiveResources);
    expect(transaction.getDiagnostics()).toMatchObject({
      resolve: { activeBindGroupCount: 2 },
      staticPass: { activeBindGroupCount: 2 },
    });

    executeCycle(3);
    expect(backend.getResourceStatistics().activeCount).toBe(baselineActiveResources);
    expect(transaction.getDiagnostics()).toMatchObject({
      resolve: { activeBindGroupCount: 2 },
      staticPass: { activeBindGroupCount: 2 },
    });

    transaction.dispose();
    expect(backend.getResourceStatistics().activeCount).toBe(0);
    backend.dispose();
  });

  it('cancels every open History role when current rendering fails and remains reusable', async () => {
    const backend = new MockBackend();
    await backend.initialize();
    const transaction = createTransaction();
    await transaction.initialize(backend);

    expect(() =>
      transaction.execute({
        currentInverseViewProjection: identityMat4(),
        dirtyFlags: ['geometry'],
        previousViewProjection: identityMat4(),
        renderCurrent: () => {
          throw new Error('forced current-frame failure');
        },
        signature,
        temporal: temporal('accumulating', 1, 1, true),
      }),
    ).toThrow('forced current-frame failure');
    expect(transaction.getDiagnostics()).toMatchObject({
      dynamicHistory: { frameOpen: false, history: { sampleCount: 0 } },
      open: false,
      staticHistory: { frameOpen: false, history: { sampleCount: 0 } },
    });

    const recovered = transaction.execute({
      currentInverseViewProjection: identityMat4(),
      dirtyFlags: [],
      previousViewProjection: identityMat4(),
      renderCurrent: () => currentStatistics,
      signature,
      temporal: temporal('interactive', 0),
    });
    expect(recovered.diagnostics.dynamicHistory.history.sampleCount).toBe(1);

    transaction.dispose();
    expect(backend.getResourceStatistics().activeCount).toBe(0);
    backend.dispose();
  });

  it('rejects scheduler policy mismatches before opening GPU History', async () => {
    const backend = new MockBackend();
    await backend.initialize();
    const transaction = createTransaction();
    await transaction.initialize(backend);

    expect(() =>
      transaction.execute({
        convergenceError: -1,
        currentInverseViewProjection: identityMat4(),
        dirtyFlags: [],
        previousViewProjection: identityMat4(),
        renderCurrent: () => currentStatistics,
        signature,
        temporal: temporal('accumulating', 1),
      }),
    ).toThrow('finite and non-negative');
    expect(() =>
      transaction.execute({
        currentInverseViewProjection: identityMat4(),
        dirtyFlags: [],
        previousViewProjection: identityMat4(),
        renderCurrent: () => currentStatistics,
        signature,
        temporal: { ...temporal('accumulating', 1), targetSamples: 3 },
      }),
    ).toThrow('targetSamples');
    expect(transaction.getDiagnostics()).toMatchObject({
      dynamicHistory: { frameOpen: false, history: { sampleCount: 0 } },
      open: false,
      staticHistory: { frameOpen: false, history: { sampleCount: 0 } },
    });

    transaction.dispose();
    expect(backend.getResourceStatistics().activeCount).toBe(0);
    backend.dispose();
  });
});
