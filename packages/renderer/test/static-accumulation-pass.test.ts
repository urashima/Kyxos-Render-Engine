import type { BackendTextureHandle } from '@kyxos/render-backend-api';
import { MockBackend } from '@kyxos/render-testing';
import { describe, expect, it, vi } from 'vitest';

import {
  STATIC_ACCUMULATION_UNIFORM_LAYOUT,
  StaticAccumulationGpuHistory,
  StaticAccumulationPass,
  packStaticAccumulationUniforms,
  type StaticAccumulationGpuFrame,
} from '../src/index.js';

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

function currentTexture(backend: MockBackend, width = 2, height = 2): BackendTextureHandle {
  return backend.createTexture({
    format: 'rgba16float',
    label: 'static-current-color',
    size: { height, width },
    usage: ['render-attachment', 'sampled'],
  });
}

describe('StaticAccumulationPass', () => {
  it('packs first-sample and running-mean weights with strict frame validation', async () => {
    const backend = new MockBackend();
    await backend.initialize();
    const history = new StaticAccumulationGpuHistory({
      height: 1,
      ownerId: 'weights',
      targetSamples: 4,
      width: 1,
    });
    history.initialize(backend);
    const first = history.prepareFrame(signature);
    expect(STATIC_ACCUMULATION_UNIFORM_LAYOUT).toEqual({
      byteLength: 16,
      currentWeightOffset: 4,
      historyValidOffset: 8,
      historyWeightOffset: 0,
      previousSampleCountOffset: 12,
    });
    expect(Array.from(packStaticAccumulationUniforms(first))).toEqual([0, 1, 0, 0]);
    history.commitFrame();
    const second = history.prepareFrame(signature);
    expect(Array.from(packStaticAccumulationUniforms(second))).toEqual([0.5, 0.5, 1, 1]);
    history.cancelFrame();

    const invalid = {
      ...first,
      historyValid: true,
      previousSampleCount: 0,
    } as StaticAccumulationGpuFrame;
    expect(() => packStaticAccumulationUniforms(invalid)).toThrow('at least one prior sample');
    expect(() =>
      packStaticAccumulationUniforms({
        ...first,
        historyValid: false,
        previousSampleCount: 1,
      }),
    ).toThrow('restart with zero prior samples');
    expect(() =>
      packStaticAccumulationUniforms({
        ...first,
        size: { height: 0, width: 1 },
      }),
    ).toThrow('frame size is invalid');

    history.dispose();
    backend.dispose();
  });

  it('submits one full-screen accumulation Draw and refreshes role Bind Groups after swap and Resize', async () => {
    const backend = new MockBackend();
    await backend.initialize();
    const history = new StaticAccumulationGpuHistory({
      height: 2,
      ownerId: 'pass',
      targetSamples: 4,
      width: 2,
    });
    const pass = new StaticAccumulationPass({ ownerId: 'pass' });
    history.initialize(backend);
    const current = currentTexture(backend);
    const createBindGroup = vi.spyOn(backend, 'createBindGroup');
    const executeFrame = vi.spyOn(backend, 'executeFrame');
    const writeBuffer = vi.spyOn(backend, 'writeBuffer');
    await pass.initialize(backend);
    await pass.initialize(backend);

    const first = history.prepareFrame(signature);
    expect(pass.execute({ currentColorTexture: current, frame: first })).toEqual({
      drawCalls: 1,
      instances: 1,
      triangles: 1,
      vertices: 3,
    });
    expect(Array.from(writeBuffer.mock.calls[0]?.[1] as Float32Array)).toEqual([0, 1, 0, 0]);
    expect(executeFrame.mock.calls[0]?.[0].renderPasses[0]).toMatchObject({
      colorAttachments: [{ texture: first.writeColorTexture }],
      draws: [{ vertexCount: 3 }],
      label: 'static-accumulation-pass-pass',
    });
    expect(createBindGroup).toHaveBeenLastCalledWith(
      expect.objectContaining({
        entries: [
          { binding: 0, resource: { buffer: expect.any(Object) } },
          { binding: 1, resource: { texture: current } },
          { binding: 2, resource: { texture: first.readColorTexture } },
        ],
        group: 0,
      }),
    );
    pass.execute({ currentColorTexture: current, frame: first });
    expect(createBindGroup).toHaveBeenCalledTimes(1);
    history.commitFrame();

    const second = history.prepareFrame(signature);
    pass.execute({ currentColorTexture: current, frame: second });
    expect(Array.from(writeBuffer.mock.calls.at(-1)?.[1] as Float32Array)).toEqual([
      0.5, 0.5, 1, 1,
    ]);
    expect(createBindGroup).toHaveBeenCalledTimes(2);
    history.cancelFrame();
    expect(pass.getDiagnostics()).toMatchObject({
      activeBindGroupCount: 2,
      executionCount: 3,
      ownerId: 'pass',
      resourceGeneration: 1,
      state: 'ready',
    });

    history.resize(3, 2);
    backend.destroyResource(current);
    const resizedCurrent = currentTexture(backend, 3, 2);
    const resized = history.prepareFrame({ ...signature, viewport: 2 });
    pass.execute({ currentColorTexture: resizedCurrent, frame: resized });
    expect(createBindGroup).toHaveBeenCalledTimes(3);
    expect(pass.getDiagnostics()).toMatchObject({
      activeBindGroupCount: 1,
      executionCount: 4,
    });
    history.cancelFrame();

    pass.dispose();
    pass.dispose();
    history.dispose();
    backend.destroyResource(resizedCurrent);
    expect(backend.getResourceStatistics().activeCount).toBe(0);
    expect(() =>
      pass.execute({ currentColorTexture: resizedCurrent, frame: resized }),
    ).toThrowError(expect.objectContaining({ code: 'ALREADY_DISPOSED' }));
    backend.dispose();
  });

  it('rejects another owner, detaches on Device Lost, restores, and rolls back compilation failure', async () => {
    const backend = new MockBackend();
    await backend.initialize();
    const history = new StaticAccumulationGpuHistory({
      height: 1,
      ownerId: 'device-pass',
      targetSamples: 2,
      width: 1,
    });
    const otherHistory = new StaticAccumulationGpuHistory({
      height: 1,
      ownerId: 'other-pass',
      targetSamples: 2,
      width: 1,
    });
    const pass = new StaticAccumulationPass({ ownerId: 'device-pass' });
    history.initialize(backend);
    otherHistory.initialize(backend);
    const current = currentTexture(backend, 1, 1);
    await pass.initialize(backend);
    const frame = history.prepareFrame(signature);
    const other = otherHistory.prepareFrame(signature);
    expect(() => pass.execute({ currentColorTexture: current, frame: other })).toThrow(
      'another owner',
    );
    pass.execute({ currentColorTexture: current, frame });
    history.cancelFrame();
    otherHistory.cancelFrame();
    otherHistory.dispose();

    backend.simulateLoss({ message: 'forced Static pass loss' });
    expect(pass.getDiagnostics()).toMatchObject({
      activeBindGroupCount: 0,
      resourceGeneration: 1,
      state: 'detached',
    });
    expect(() => pass.execute({ currentColorTexture: current, frame })).toThrowError(
      expect.objectContaining({ code: 'INVALID_STATE', recoverable: true }),
    );

    await backend.initialize();
    history.initialize(backend);
    const restoredCurrent = currentTexture(backend, 1, 1);
    await pass.initialize(backend);
    const restored = history.prepareFrame({ ...signature, device: 2 });
    pass.execute({ currentColorTexture: restoredCurrent, frame: restored });
    expect(pass.getDiagnostics()).toMatchObject({
      activeBindGroupCount: 1,
      executionCount: 2,
      resourceGeneration: 2,
      state: 'ready',
    });
    history.cancelFrame();
    pass.dispose();
    history.dispose();
    backend.destroyResource(restoredCurrent);
    expect(backend.getResourceStatistics().activeCount).toBe(0);
    backend.dispose();

    const failedBackend = new MockBackend();
    await failedBackend.initialize();
    vi.spyOn(failedBackend, 'getShaderCompilationInfo').mockResolvedValueOnce({
      messages: Object.freeze([
        Object.freeze({
          length: 1,
          lineNumber: 1,
          linePosition: 1,
          message: 'forced Static accumulation compile error',
          offset: 0,
          type: 'error' as const,
        }),
      ]),
      valid: false,
    });
    const failed = new StaticAccumulationPass({ ownerId: 'compile-failure' });
    await expect(failed.initialize(failedBackend)).rejects.toThrow(
      'forced Static accumulation compile error',
    );
    expect(failed.getDiagnostics()).toMatchObject({ resourceGeneration: 0, state: 'detached' });
    expect(failedBackend.getResourceStatistics()).toMatchObject({
      activeCount: 0,
      createdTotal: 1,
      destroyedTotal: 1,
    });
    failed.dispose();
    failedBackend.dispose();
  });
});
