import { identityMat4 } from '@kyxos/render-math';
import { MockBackend } from '@kyxos/render-testing';
import { describe, expect, it, vi } from 'vitest';

import {
  DEFERRED_TRAA_DEFAULT_SETTINGS,
  DEFERRED_TRAA_RESOLVE_UNIFORM_LAYOUT,
  DeferredGBuffer,
  type DeferredLightingParameters,
  DeferredLightingPass,
  DeferredTraaHistory,
  DeferredTraaResolvePass,
  createDeferredTraaResolveSettings,
  packDeferredTraaResolveUniforms,
} from '../src/index.js';

const PARAMETERS: DeferredLightingParameters = Object.freeze({
  ambientIntensity: 0.125,
  cameraPosition: [1, 2, 3] as const,
  inverseViewProjection: identityMat4(),
  lightColor: [0.8, 0.7, 0.6] as const,
  lightDirection: [0.25, 0.5, 1] as const,
  lightIntensity: 4,
});

async function createCurrentFrame(
  backend: MockBackend,
  ownerId: string,
  width: number,
  height: number,
) {
  const gbuffer = new DeferredGBuffer({ height, ownerId, width });
  gbuffer.initialize(backend);
  const lighting = new DeferredLightingPass({ height, ownerId, width });
  await lighting.initialize(backend);
  const currentColor = lighting.execute({
    gbuffer: gbuffer.acquireFrame(),
    parameters: PARAMETERS,
  }).frame;
  return Object.freeze({ currentColor, gbuffer, lighting });
}

describe('Deferred TRAA Resolve settings and uniforms', () => {
  it('packs the fixed 208-byte matrices, Jitter, extent, History, and resolve options', async () => {
    const backend = new MockBackend();
    await backend.initialize();
    const current = await createCurrentFrame(backend, 'uniforms', 8, 4);
    const history = new DeferredTraaHistory({ height: 4, ownerId: 'uniforms', width: 8 });
    history.initialize(backend);
    const frame = history.prepareFrame({ historyGeneration: 7, reset: true, resetReason: 'scene' });

    const packed = packDeferredTraaResolveUniforms({
      currentColor: current.currentColor,
      currentGBuffer: current.gbuffer.acquireFrame(),
      currentJitterNdcOffset: [0.25, -0.5],
      currentRasterInverseViewProjection: identityMat4(),
      history: frame,
      options: {
        baseHistoryWeight: 0.75,
        depthAbsoluteThreshold: 0.002,
        depthRelativeThreshold: 0.02,
        edgeDepthDifference: 0.03,
        flickerReduction: 0.4,
        maxVelocityLength: 64,
        minimumCurrentWeight: 0.1,
        responsiveHistoryReduction: 0.6,
        subpixelCorrection: 0.2,
        varianceClipGamma: 1.5,
      },
      previousJitterNdcOffset: [-0.25, 0.5],
      previousRasterViewProjection: identityMat4(),
      responsiveMask: 0.35,
    });

    expect(packed.byteLength).toBe(DEFERRED_TRAA_RESOLVE_UNIFORM_LAYOUT.byteLength);
    expect([...packed.slice(0, 16)]).toEqual([...identityMat4()]);
    expect([...packed.slice(16, 32)]).toEqual([...identityMat4()]);
    expect([...packed.slice(32, 40)]).toEqual([
      8,
      4,
      0,
      expect.closeTo(0.35),
      0.25,
      -0.5,
      -0.25,
      0.5,
    ]);
    expect([...packed.slice(40, 50)]).toEqual([
      0.75,
      expect.closeTo(0.002),
      expect.closeTo(0.02),
      expect.closeTo(0.1),
      expect.closeTo(0.03),
      64,
      1.5,
      expect.closeTo(0.4),
      expect.closeTo(0.6),
      expect.closeTo(0.2),
    ]);

    history.cancelFrame();
    history.dispose();
    current.lighting.dispose();
    current.gbuffer.dispose();
    expect(backend.getResourceStatistics().activeCount).toBe(0);
    backend.dispose();
  });

  it('creates immutable defaults and rejects invalid settings, matrices, Jitter, and masks', async () => {
    expect(createDeferredTraaResolveSettings()).toEqual(DEFERRED_TRAA_DEFAULT_SETTINGS);
    expect(Object.isFrozen(createDeferredTraaResolveSettings())).toBe(true);
    expect(() => createDeferredTraaResolveSettings({ baseHistoryWeight: 2 })).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    );
    expect(() => createDeferredTraaResolveSettings({ maxVelocityLength: 0 })).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    );
    expect(() => createDeferredTraaResolveSettings({ varianceClipGamma: -1 })).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    );

    const backend = new MockBackend();
    await backend.initialize();
    const current = await createCurrentFrame(backend, 'invalid-uniforms', 1, 1);
    const history = new DeferredTraaHistory({ height: 1, ownerId: 'invalid-uniforms', width: 1 });
    history.initialize(backend);
    const frame = history.prepareFrame({ historyGeneration: 0, reset: true });
    const base = {
      currentColor: current.currentColor,
      currentGBuffer: current.gbuffer.acquireFrame(),
      currentRasterInverseViewProjection: identityMat4(),
      history: frame,
      previousRasterViewProjection: identityMat4(),
    } as const;

    expect(() => packDeferredTraaResolveUniforms({ ...base, responsiveMask: -1 })).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    );
    expect(() =>
      packDeferredTraaResolveUniforms({
        ...base,
        currentJitterNdcOffset: [Number.NaN, 0],
      }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    expect(() =>
      packDeferredTraaResolveUniforms({
        ...base,
        previousRasterViewProjection: [...identityMat4().slice(0, 15)] as never,
      }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));

    history.cancelFrame();
    history.dispose();
    current.lighting.dispose();
    current.gbuffer.dispose();
    expect(backend.getResourceStatistics().activeCount).toBe(0);
    backend.dispose();
  });
});

describe('DeferredTraaResolvePass', () => {
  it('writes independent History Color and Depth without committing the caller transaction', async () => {
    const backend = new MockBackend();
    await backend.initialize();
    const current = await createCurrentFrame(backend, 'viewport-a', 8, 4);
    const history = new DeferredTraaHistory({ height: 4, ownerId: 'viewport-a', width: 8 });
    history.initialize(backend);
    const resolve = new DeferredTraaResolvePass({ ownerId: 'viewport-a' });
    await resolve.initialize(backend);
    const createBindGroup = vi.spyOn(backend, 'createBindGroup');
    const executeFrame = vi.spyOn(backend, 'executeFrame');
    const writeBuffer = vi.spyOn(backend, 'writeBuffer');

    const firstFrame = history.prepareFrame({
      historyGeneration: 3,
      reset: true,
      resetReason: 'settings',
    });
    const first = resolve.execute({
      currentColor: current.currentColor,
      currentGBuffer: current.gbuffer.acquireFrame(),
      currentJitterNdcOffset: [0.001, -0.002],
      currentRasterInverseViewProjection: identityMat4(),
      history: firstFrame,
      previousJitterNdcOffset: [-0.001, 0.002],
      previousRasterViewProjection: identityMat4(),
    });

    expect(first.statistics).toEqual({ drawCalls: 1, instances: 1, triangles: 1, vertices: 3 });
    expect(first.historyFrame).toBe(firstFrame);
    expect(history.getDiagnostics()).toMatchObject({ frameOpen: true, historyValid: false });
    expect(writeBuffer).toHaveBeenCalledTimes(1);
    expect(createBindGroup).toHaveBeenCalledTimes(1);
    expect(createBindGroup).toHaveBeenLastCalledWith(
      expect.objectContaining({
        entries: [
          { binding: 0, resource: { buffer: expect.any(Object) } },
          { binding: 1, resource: { texture: current.currentColor.colorTexture } },
          { binding: 2, resource: { texture: current.gbuffer.acquireFrame().depthTexture } },
          { binding: 3, resource: { texture: current.gbuffer.acquireFrame().velocityTexture } },
          { binding: 4, resource: { texture: firstFrame.readColorTexture } },
          { binding: 5, resource: { texture: firstFrame.readDepthTexture } },
          { binding: 6, resource: { sampler: firstFrame.sampler } },
        ],
        group: 0,
        label: 'deferred-traa-resolve-viewport-a-bindings',
      }),
    );
    expect(executeFrame).toHaveBeenCalledTimes(1);
    expect(executeFrame.mock.calls[0]?.[0].renderPasses).toEqual([
      expect.objectContaining({
        colorAttachments: [{ texture: firstFrame.writeColorTexture }],
        depthAttachment: { clearValue: 1, texture: firstFrame.writeDepthTexture },
        draws: [expect.objectContaining({ vertexCount: 3 })],
        label: 'deferred-traa-resolve-viewport-a-pass',
      }),
    ]);

    history.commitFrame();
    expect(history.acquireResolvedFrame()).toMatchObject({
      colorTexture: firstFrame.writeColorTexture,
      depthTexture: firstFrame.writeDepthTexture,
      historyGeneration: 3,
    });

    const secondFrame = history.prepareFrame({ historyGeneration: 3 });
    resolve.execute({
      currentColor: current.currentColor,
      currentGBuffer: current.gbuffer.acquireFrame(),
      currentRasterInverseViewProjection: identityMat4(),
      history: secondFrame,
      previousRasterViewProjection: identityMat4(),
    });
    history.commitFrame();
    const thirdFrame = history.prepareFrame({ historyGeneration: 3 });
    resolve.execute({
      currentColor: current.currentColor,
      currentGBuffer: current.gbuffer.acquireFrame(),
      currentRasterInverseViewProjection: identityMat4(),
      history: thirdFrame,
      previousRasterViewProjection: identityMat4(),
    });
    history.commitFrame();

    expect(createBindGroup).toHaveBeenCalledTimes(2);
    expect(resolve.getDiagnostics()).toEqual({
      activeBindGroupCount: 2,
      executionCount: 3,
      ownerId: 'viewport-a',
      resourceGeneration: 1,
      state: 'ready',
    });

    resolve.dispose();
    history.dispose();
    current.lighting.dispose();
    current.gbuffer.dispose();
    expect(backend.getResourceStatistics().activeCount).toBe(0);
    backend.dispose();
  });

  it('rejects foreign owners and mismatched extents before encoding', async () => {
    const backend = new MockBackend();
    await backend.initialize();
    const current = await createCurrentFrame(backend, 'owned', 2, 2);
    const history = new DeferredTraaHistory({ height: 2, ownerId: 'owned', width: 2 });
    history.initialize(backend);
    const resolve = new DeferredTraaResolvePass({ ownerId: 'owned' });
    await resolve.initialize(backend);
    const frame = history.prepareFrame({ historyGeneration: 1, reset: true });

    expect(() =>
      resolve.execute({
        currentColor: { ...current.currentColor, ownerId: 'foreign' },
        currentGBuffer: current.gbuffer.acquireFrame(),
        currentRasterInverseViewProjection: identityMat4(),
        history: frame,
        previousRasterViewProjection: identityMat4(),
      }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    history.cancelFrame();

    current.gbuffer.resize(4, 4);
    const resizedFrame = history.prepareFrame({ historyGeneration: 1, reset: true });
    expect(() =>
      resolve.execute({
        currentColor: current.currentColor,
        currentGBuffer: current.gbuffer.acquireFrame(),
        currentRasterInverseViewProjection: identityMat4(),
        history: resizedFrame,
        previousRasterViewProjection: identityMat4(),
      }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    history.cancelFrame();

    resolve.dispose();
    history.dispose();
    current.lighting.dispose();
    current.gbuffer.dispose();
    expect(backend.getResourceStatistics().activeCount).toBe(0);
    backend.dispose();
  });

  it('clears role Bind Groups after Resize and rebuilds after Device Lost', async () => {
    const backend = new MockBackend();
    await backend.initialize();
    const current = await createCurrentFrame(backend, 'viewport-b', 2, 2);
    const history = new DeferredTraaHistory({ height: 2, ownerId: 'viewport-b', width: 2 });
    history.initialize(backend);
    const resolve = new DeferredTraaResolvePass({ ownerId: 'viewport-b' });
    await resolve.initialize(backend);

    const firstFrame = history.prepareFrame({ historyGeneration: 1, reset: true });
    resolve.execute({
      currentColor: current.currentColor,
      currentGBuffer: current.gbuffer.acquireFrame(),
      currentRasterInverseViewProjection: identityMat4(),
      history: firstFrame,
      previousRasterViewProjection: identityMat4(),
    });
    history.commitFrame();
    expect(resolve.getDiagnostics().activeBindGroupCount).toBe(1);

    history.resize(3, 3);
    current.gbuffer.resize(3, 3);
    current.lighting.resize(3, 3);
    const resizedColor = current.lighting.execute({
      gbuffer: current.gbuffer.acquireFrame(),
      parameters: PARAMETERS,
    }).frame;
    const resizedFrame = history.prepareFrame({ historyGeneration: 2, reset: true });
    resolve.execute({
      currentColor: resizedColor,
      currentGBuffer: current.gbuffer.acquireFrame(),
      currentRasterInverseViewProjection: identityMat4(),
      history: resizedFrame,
      previousRasterViewProjection: identityMat4(),
    });
    history.commitFrame();
    expect(resolve.getDiagnostics()).toMatchObject({
      activeBindGroupCount: 1,
      executionCount: 2,
      resourceGeneration: 1,
    });
    const staleGBufferFrame = current.gbuffer.acquireFrame();

    backend.simulateLoss({ message: 'forced Deferred TRAA Resolve loss' });
    expect(resolve.getDiagnostics()).toMatchObject({ activeBindGroupCount: 0, state: 'detached' });
    expect(() =>
      resolve.execute({
        currentColor: resizedColor,
        currentGBuffer: staleGBufferFrame,
        currentRasterInverseViewProjection: identityMat4(),
        history: resizedFrame,
        previousRasterViewProjection: identityMat4(),
      }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_STATE', recoverable: true }));

    await backend.initialize();
    current.gbuffer.initialize(backend);
    await current.lighting.initialize(backend);
    history.initialize(backend);
    await resolve.initialize(backend);
    const restoredColor = current.lighting.execute({
      gbuffer: current.gbuffer.acquireFrame(),
      parameters: PARAMETERS,
    }).frame;
    const restoredFrame = history.prepareFrame({ historyGeneration: 3, reset: true });
    resolve.execute({
      currentColor: restoredColor,
      currentGBuffer: current.gbuffer.acquireFrame(),
      currentRasterInverseViewProjection: identityMat4(),
      history: restoredFrame,
      previousRasterViewProjection: identityMat4(),
    });
    history.commitFrame();
    expect(resolve.getDiagnostics()).toMatchObject({
      activeBindGroupCount: 1,
      executionCount: 3,
      resourceGeneration: 2,
      state: 'ready',
    });

    resolve.dispose();
    history.dispose();
    current.lighting.dispose();
    current.gbuffer.dispose();
    expect(backend.getResourceStatistics().activeCount).toBe(0);
    backend.dispose();
  });

  it('validates construction and rejects work after disposal', async () => {
    expect(() => new DeferredTraaResolvePass({ ownerId: ' ' })).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    );
    const backend = new MockBackend();
    await backend.initialize();
    const resolve = new DeferredTraaResolvePass({ ownerId: 'viewport' });
    await resolve.initialize(backend);
    resolve.dispose();
    resolve.dispose();
    expect(resolve.getDiagnostics().state).toBe('disposed');
    expect(() => resolve.execute({} as never)).toThrowError(
      expect.objectContaining({ code: 'ALREADY_DISPOSED' }),
    );
    expect(backend.getResourceStatistics().activeCount).toBe(0);
    backend.dispose();
  });
});
