import { MockBackend } from '@kyxos/render-testing';
import { describe, expect, it, vi } from 'vitest';

import {
  DYNAMIC_TAA_PRESENT_UNIFORM_LAYOUT,
  DynamicTaaGpuHistory,
  DynamicTaaPresentPass,
  packDynamicTaaPresentUniforms,
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

function createTarget() {
  return { getContext: () => ({}), height: 0, width: 0 };
}

describe('DynamicTaaPresentPass', () => {
  it('packs the stable display transform uniform and rejects invalid exposure', () => {
    expect(DYNAMIC_TAA_PRESENT_UNIFORM_LAYOUT).toEqual({
      byteLength: 16,
      exposureMultiplierOffset: 0,
      toneMappingEnabledOffset: 4,
    });
    expect(Array.from(packDynamicTaaPresentUniforms({ exposure: 2, toneMapping: 'none' }))).toEqual(
      [4, 0, 0, 0],
    );
    expect(
      Array.from(
        packDynamicTaaPresentUniforms({ exposure: -1, toneMapping: 'khronos-pbr-neutral' }),
      ),
    ).toEqual([0.5, 1, 0, 0]);
    expect(() => packDynamicTaaPresentUniforms({ exposure: 33 })).toThrow('exposure');
  });

  it('presents the open frame write Color, validates Resize, and releases only owned Handles', async () => {
    const backend = new MockBackend();
    await backend.initialize();
    const history = new DynamicTaaGpuHistory({ height: 2, ownerId: 'present', width: 4 });
    const present = new DynamicTaaPresentPass({
      output: { exposure: 0, toneMapping: 'none' },
      ownerId: 'present',
      surface: {
        cssHeight: 2,
        cssWidth: 4,
        devicePixelRatio: 1,
        target: createTarget(),
      },
    });
    history.initialize(backend);
    const createBindGroup = vi.spyOn(backend, 'createBindGroup');
    const createPipeline = vi.spyOn(backend, 'createRenderPipeline');
    const executeFrame = vi.spyOn(backend, 'executeFrame');
    const writeBuffer = vi.spyOn(backend, 'writeBuffer');
    await present.initialize(backend);
    await present.initialize(backend);
    expect(createPipeline).toHaveBeenCalledWith(
      expect.objectContaining({
        fragment: expect.objectContaining({ targets: [{ format: 'bgra8unorm' }] }),
      }),
    );

    const first = history.prepareFrame(signature);
    expect(present.execute({ frame: first })).toEqual({
      drawCalls: 1,
      instances: 1,
      triangles: 1,
      vertices: 3,
    });
    present.execute({ frame: first });
    expect(createBindGroup).toHaveBeenCalledTimes(1);
    expect(createBindGroup).toHaveBeenLastCalledWith(
      expect.objectContaining({
        entries: [
          { binding: 0, resource: { buffer: expect.any(Object) } },
          { binding: 1, resource: { texture: first.writeColorTexture } },
        ],
        group: 0,
      }),
    );
    expect(executeFrame.mock.calls[0]?.[0].renderPasses[0]).toMatchObject({
      draws: [{ vertexCount: 3 }],
      label: 'taa-present-present-pass',
      surface: expect.any(Object),
    });
    expect(writeBuffer).toHaveBeenCalledTimes(2);

    present.setOutput({ exposure: -1, toneMapping: 'khronos-pbr-neutral' });
    present.execute({ frame: first });
    expect(Array.from(writeBuffer.mock.calls.at(-1)?.[1] as Float32Array)).toEqual([0.5, 1, 0, 0]);
    expect(present.getDiagnostics()).toMatchObject({
      activeBindGroupCount: 1,
      executionCount: 3,
      outputExposure: -1,
      outputExposureMultiplier: 0.5,
      outputToneMapping: 'khronos-pbr-neutral',
      ownerId: 'present',
      resourceGeneration: 1,
      state: 'ready',
      surface: { size: { physicalHeight: 2, physicalWidth: 4 } },
    });

    present.resize({ cssHeight: 3, cssWidth: 8, devicePixelRatio: 1 });
    expect(() => present.execute({ frame: first })).toThrow('does not match Surface');
    history.cancelFrame();
    history.resize(8, 3);
    const resized = history.prepareFrame({ ...signature, viewport: 2 });
    present.execute({ frame: resized });
    expect(createBindGroup).toHaveBeenCalledTimes(2);
    expect(present.getDiagnostics()).toMatchObject({ activeBindGroupCount: 1, executionCount: 4 });
    expect(backend.getResourceStatistics()).toMatchObject({
      activeCount: 14,
      byKind: {
        'bind-group': { activeCount: 1 },
        buffer: { activeCount: 1, activeEstimatedBytes: 16 },
        pipeline: { activeCount: 1 },
        sampler: { activeCount: 1 },
        'shader-module': { activeCount: 1 },
        surface: { activeCount: 1 },
        texture: { activeCount: 8, activeEstimatedBytes: 1248 },
      },
    });

    history.cancelFrame();
    present.dispose();
    present.dispose();
    expect(backend.getResourceStatistics().activeCount).toBe(9);
    history.dispose();
    expect(backend.getResourceStatistics().activeCount).toBe(0);
    expect(() => present.execute({ frame: resized })).toThrowError(
      expect.objectContaining({ code: 'ALREADY_DISPOSED' }),
    );
    backend.dispose();
  });

  it('suspends without a Draw, rejects another owner, restores after Device Lost, and rolls back compilation failure', async () => {
    const backend = new MockBackend();
    await backend.initialize();
    const history = new DynamicTaaGpuHistory({ height: 2, ownerId: 'device', width: 2 });
    const otherHistory = new DynamicTaaGpuHistory({ height: 2, ownerId: 'other', width: 2 });
    const present = new DynamicTaaPresentPass({
      ownerId: 'device',
      surface: {
        cssHeight: 2,
        cssWidth: 2,
        devicePixelRatio: 1,
        target: createTarget(),
      },
    });
    history.initialize(backend);
    otherHistory.initialize(backend);
    await present.initialize(backend);
    const frame = history.prepareFrame(signature);
    const other = otherHistory.prepareFrame(signature);
    expect(() => present.execute({ frame: other })).toThrow('another owner');
    present.resize({ cssHeight: 0, cssWidth: 0, devicePixelRatio: 1 });
    expect(present.execute({ frame })).toEqual({
      drawCalls: 0,
      instances: 0,
      triangles: 0,
      vertices: 0,
    });
    expect(present.getDiagnostics().executionCount).toBe(0);
    history.cancelFrame();
    otherHistory.cancelFrame();
    otherHistory.dispose();

    backend.simulateLoss({ message: 'forced P4-09 loss' });
    expect(present.getDiagnostics()).toMatchObject({
      activeBindGroupCount: 0,
      resourceGeneration: 1,
      state: 'detached',
      surface: null,
    });
    expect(() => present.execute({ frame })).toThrowError(
      expect.objectContaining({ code: 'INVALID_STATE', recoverable: true }),
    );

    await backend.initialize();
    history.initialize(backend);
    await present.initialize(backend);
    present.resize({ cssHeight: 2, cssWidth: 2, devicePixelRatio: 1 });
    const restored = history.prepareFrame({ ...signature, device: 2 });
    present.execute({ frame: restored });
    expect(present.getDiagnostics()).toMatchObject({
      activeBindGroupCount: 1,
      executionCount: 1,
      resourceGeneration: 2,
      state: 'ready',
    });
    history.cancelFrame();
    present.dispose();
    history.dispose();
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
          message: 'forced present compile error',
          offset: 0,
          type: 'error' as const,
        }),
      ]),
      valid: false,
    });
    const failed = new DynamicTaaPresentPass({
      ownerId: 'compile-failure',
      surface: {
        cssHeight: 1,
        cssWidth: 1,
        devicePixelRatio: 1,
        target: createTarget(),
      },
    });
    await expect(failed.initialize(failedBackend)).rejects.toThrow('forced present compile error');
    expect(failed.getDiagnostics()).toMatchObject({ resourceGeneration: 0, state: 'detached' });
    expect(failedBackend.getResourceStatistics()).toMatchObject({
      activeCount: 0,
      createdTotal: 2,
      destroyedTotal: 2,
    });
    failed.dispose();
    failedBackend.dispose();
  });
});
