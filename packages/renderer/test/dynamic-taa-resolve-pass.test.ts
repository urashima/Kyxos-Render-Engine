import type { Mat4 } from '@kyxos/render-math';
import { identityMat4 } from '@kyxos/render-math';
import { TEMPORAL_TAA_DEFAULT_OPTIONS } from '@kyxos/render-temporal';
import { MockBackend } from '@kyxos/render-testing';
import { describe, expect, it, vi } from 'vitest';

import {
  DYNAMIC_TAA_RESOLVE_UNIFORM_LAYOUT,
  DynamicTaaGpuHistory,
  DynamicTaaResolvePass,
  packDynamicTaaResolveUniforms,
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

describe('DynamicTaaResolvePass', () => {
  it('packs the two matrices, viewport, History state, responsive mask, and frozen options', async () => {
    const backend = new MockBackend();
    await backend.initialize();
    const history = new DynamicTaaGpuHistory({ height: 3, ownerId: 'uniforms', width: 5 });
    history.initialize(backend);
    const frame = history.prepareFrame(signature);
    const currentInverseViewProjection = identityMat4();
    const previousViewProjection = Object.freeze([
      2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 0.25, -0.5, 0.75, 1,
    ]) as Mat4;
    const packed = packDynamicTaaResolveUniforms({
      currentInverseViewProjection,
      frame,
      previousViewProjection,
      responsiveMask: 0.25,
    });

    expect(DYNAMIC_TAA_RESOLVE_UNIFORM_LAYOUT).toEqual({
      byteLength: 176,
      currentInverseViewProjectionOffset: 0,
      options0Offset: 144,
      options1Offset: 160,
      previousViewProjectionOffset: 64,
      viewportHistoryResponsiveOffset: 128,
    });
    expect(packed.byteLength).toBe(176);
    expect(Array.from(packed.slice(0, 16))).toEqual(currentInverseViewProjection);
    expect(Array.from(packed.slice(16, 32))).toEqual(previousViewProjection);
    expect(Array.from(packed.slice(32, 36))).toEqual([5, 3, 0, 0.25]);
    expect(Array.from(packed.slice(36, 41))).toEqual([
      Math.fround(TEMPORAL_TAA_DEFAULT_OPTIONS.baseHistoryWeight),
      Math.fround(TEMPORAL_TAA_DEFAULT_OPTIONS.depthAbsoluteThreshold),
      Math.fround(TEMPORAL_TAA_DEFAULT_OPTIONS.depthRelativeThreshold),
      Math.fround(TEMPORAL_TAA_DEFAULT_OPTIONS.normalRejectionCosine),
      Math.fround(TEMPORAL_TAA_DEFAULT_OPTIONS.responsiveHistoryReduction),
    ]);
    expect(Array.from(packed.slice(41))).toEqual([0, 0, 0]);
    expect(() =>
      packDynamicTaaResolveUniforms({
        currentInverseViewProjection,
        frame,
        previousViewProjection,
        responsiveMask: 1.01,
      }),
    ).toThrow('responsive mask');
    expect(() =>
      packDynamicTaaResolveUniforms({
        currentInverseViewProjection: Object.freeze([
          ...currentInverseViewProjection.slice(0, 15),
        ]) as unknown as Mat4,
        frame,
        previousViewProjection,
      }),
    ).toThrow('must contain 16 values');

    history.cancelFrame();
    history.dispose();
    backend.dispose();
  });

  it('caches two role Bind Groups, clears them on Resize, and releases every owned Handle', async () => {
    const backend = new MockBackend();
    await backend.initialize();
    const history = new DynamicTaaGpuHistory({ height: 2, ownerId: 'resolve', width: 4 });
    const resolve = new DynamicTaaResolvePass({ ownerId: 'resolve' });
    history.initialize(backend);
    const createBindGroup = vi.spyOn(backend, 'createBindGroup');
    const writeBuffer = vi.spyOn(backend, 'writeBuffer');
    await resolve.initialize(backend);
    await resolve.initialize(backend);
    expect(resolve.getDiagnostics()).toEqual({
      activeBindGroupCount: 0,
      executionCount: 0,
      ownerId: 'resolve',
      resourceGeneration: 1,
      state: 'ready',
    });

    const first = history.prepareFrame(signature);
    expect(
      resolve.execute({
        currentInverseViewProjection: identityMat4(),
        frame: first,
        previousViewProjection: identityMat4(),
      }),
    ).toEqual({ drawCalls: 1, instances: 1, triangles: 1, vertices: 3 });
    resolve.execute({
      currentInverseViewProjection: identityMat4(),
      frame: first,
      previousViewProjection: identityMat4(),
      responsiveMask: 0.5,
    });
    expect(createBindGroup).toHaveBeenCalledTimes(1);
    expect(writeBuffer).toHaveBeenCalledTimes(2);
    expect(createBindGroup).toHaveBeenLastCalledWith(
      expect.objectContaining({
        entries: [
          { binding: 0, resource: { buffer: expect.any(Object) } },
          { binding: 1, resource: { texture: first.currentColorTexture } },
          { binding: 2, resource: { texture: first.writeDepthTexture } },
          { binding: 3, resource: { texture: first.writeNormalTexture } },
          { binding: 4, resource: { texture: first.readColorTexture } },
          { binding: 5, resource: { texture: first.readDepthTexture } },
          { binding: 6, resource: { texture: first.readNormalTexture } },
          { binding: 7, resource: { sampler: first.sampler } },
        ],
        group: 0,
      }),
    );

    history.commitFrame();
    const second = history.prepareFrame(signature);
    resolve.execute({
      currentInverseViewProjection: identityMat4(),
      frame: second,
      previousViewProjection: identityMat4(),
    });
    expect(createBindGroup).toHaveBeenCalledTimes(2);
    expect(resolve.getDiagnostics()).toMatchObject({
      activeBindGroupCount: 2,
      executionCount: 3,
    });
    history.cancelFrame();

    history.resize(8, 3);
    const resized = history.prepareFrame({ ...signature, viewport: 2 });
    resolve.execute({
      currentInverseViewProjection: identityMat4(),
      frame: resized,
      previousViewProjection: identityMat4(),
    });
    expect(createBindGroup).toHaveBeenCalledTimes(3);
    expect(resolve.getDiagnostics()).toMatchObject({
      activeBindGroupCount: 1,
      executionCount: 4,
    });
    expect(backend.getResourceStatistics()).toMatchObject({
      activeCount: 12,
      byKind: {
        'bind-group': { activeCount: 1 },
        buffer: { activeCount: 1, activeEstimatedBytes: 176 },
        pipeline: { activeCount: 1 },
        sampler: { activeCount: 1 },
        'shader-module': { activeCount: 1 },
        texture: { activeCount: 7, activeEstimatedBytes: 1152 },
      },
    });
    history.cancelFrame();
    resolve.dispose();
    resolve.dispose();
    history.dispose();
    expect(backend.getResourceStatistics()).toMatchObject({ activeCount: 0 });
    expect(() => resolve.execute({} as never)).toThrowError(
      expect.objectContaining({ code: 'ALREADY_DISPOSED' }),
    );
    backend.dispose();
  });

  it('detaches on Device Lost, restores fresh Pass resources, and rejects another owner', async () => {
    const backend = new MockBackend();
    await backend.initialize();
    const history = new DynamicTaaGpuHistory({ height: 2, ownerId: 'device', width: 2 });
    const resolve = new DynamicTaaResolvePass({ ownerId: 'device' });
    history.initialize(backend);
    await resolve.initialize(backend);
    const first = history.prepareFrame(signature);
    const otherHistory = new DynamicTaaGpuHistory({ height: 2, ownerId: 'other', width: 2 });
    otherHistory.initialize(backend);
    const other = otherHistory.prepareFrame(signature);
    expect(() =>
      resolve.execute({
        currentInverseViewProjection: identityMat4(),
        frame: other,
        previousViewProjection: identityMat4(),
      }),
    ).toThrow('another owner');
    otherHistory.cancelFrame();
    otherHistory.dispose();
    history.commitFrame();

    backend.simulateLoss({ message: 'forced P4-07 loss' });
    expect(resolve.getDiagnostics()).toMatchObject({
      activeBindGroupCount: 0,
      resourceGeneration: 1,
      state: 'detached',
    });
    expect(() =>
      resolve.execute({
        currentInverseViewProjection: identityMat4(),
        frame: first,
        previousViewProjection: identityMat4(),
      }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_STATE', recoverable: true }));

    await backend.initialize();
    history.initialize(backend);
    await resolve.initialize(backend);
    const restored = history.prepareFrame({ ...signature, device: 2 });
    resolve.execute({
      currentInverseViewProjection: identityMat4(),
      frame: restored,
      previousViewProjection: identityMat4(),
    });
    expect(resolve.getDiagnostics()).toMatchObject({
      activeBindGroupCount: 1,
      executionCount: 1,
      resourceGeneration: 2,
      state: 'ready',
    });
    history.cancelFrame();
    resolve.dispose();
    history.dispose();
    expect(backend.getResourceStatistics().activeCount).toBe(0);
    backend.dispose();
  });

  it('rolls back Shader compilation failure without leaking a partial Pass', async () => {
    const backend = new MockBackend();
    await backend.initialize();
    vi.spyOn(backend, 'getShaderCompilationInfo').mockResolvedValueOnce({
      messages: Object.freeze([
        Object.freeze({
          length: 1,
          lineNumber: 1,
          linePosition: 1,
          message: 'forced compile error',
          offset: 0,
          type: 'error' as const,
        }),
      ]),
      valid: false,
    });
    const resolve = new DynamicTaaResolvePass({ ownerId: 'compile-failure' });
    await expect(resolve.initialize(backend)).rejects.toThrow('forced compile error');
    expect(resolve.getDiagnostics()).toMatchObject({ resourceGeneration: 0, state: 'detached' });
    expect(backend.getResourceStatistics()).toMatchObject({
      activeCount: 0,
      createdTotal: 1,
      destroyedTotal: 1,
    });
    resolve.dispose();
    backend.dispose();
  });
});
