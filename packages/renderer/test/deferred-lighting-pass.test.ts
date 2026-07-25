import { identityMat4 } from '@kyxos/render-math';
import { MockBackend } from '@kyxos/render-testing';
import { describe, expect, it, vi } from 'vitest';

import {
  DEFERRED_LIGHTING_UNIFORM_LAYOUT,
  DeferredGBuffer,
  DeferredLightingPass,
  packDeferredLightingUniforms,
  type DeferredLightingParameters,
} from '../src/index.js';

const PARAMETERS = Object.freeze({
  ambientIntensity: 0.125,
  cameraPosition: [1, 2, 3],
  inverseViewProjection: identityMat4(),
  lightColor: [0.8, 0.7, 0.6],
  lightDirection: [0.25, 0.5, 1],
  lightIntensity: 4,
}) satisfies DeferredLightingParameters;

describe('Deferred Lighting uniforms', () => {
  it('packs the fixed 128-byte camera, light, and viewport layout', () => {
    const packed = packDeferredLightingUniforms(PARAMETERS, { height: 4, width: 8 });

    expect(packed.byteLength).toBe(DEFERRED_LIGHTING_UNIFORM_LAYOUT.byteLength);
    expect([...packed]).toEqual([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
      1, 2, 3, 0,
      0.25, 0.5, 1, 4,
      expect.closeTo(0.8), expect.closeTo(0.7), expect.closeTo(0.6), 0.125,
      8, 4, 0.125, 0.25,
    ]);
  });

  it('rejects non-finite, negative, and zero-direction inputs', () => {
    expect(() =>
      packDeferredLightingUniforms({ ...PARAMETERS, lightDirection: [0, 0, 0] }, { height: 1, width: 1 }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    expect(() =>
      packDeferredLightingUniforms({ ...PARAMETERS, lightIntensity: -1 }, { height: 1, width: 1 }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    expect(() =>
      packDeferredLightingUniforms({ ...PARAMETERS, cameraPosition: [0, Number.NaN, 0] }, { height: 1, width: 1 }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  });
});

describe('DeferredLightingPass', () => {
  it('reads one current GBuffer and writes one independent linear HDR frame', async () => {
    const backend = new MockBackend();
    await backend.initialize();
    const gbuffer = new DeferredGBuffer({ height: 4, ownerId: 'viewport-a', width: 8 });
    gbuffer.initialize(backend);
    const lighting = new DeferredLightingPass({ height: 4, ownerId: 'viewport-a', width: 8 });
    const writeBuffer = vi.spyOn(backend, 'writeBuffer');
    const createBindGroup = vi.spyOn(backend, 'createBindGroup');
    const executeFrame = vi.spyOn(backend, 'executeFrame');

    await lighting.initialize(backend);
    await lighting.initialize(backend);
    const first = lighting.execute({ gbuffer: gbuffer.acquireFrame(), parameters: PARAMETERS });
    const second = lighting.execute({ gbuffer: gbuffer.acquireFrame(), parameters: PARAMETERS });

    expect(first.statistics).toEqual({ drawCalls: 1, instances: 1, triangles: 1, vertices: 3 });
    expect(first.frame).toMatchObject({
      ownerId: 'viewport-a',
      resourceGeneration: 1,
      size: { height: 4, width: 8 },
    });
    expect(first.frame.colorTexture).toBe(second.frame.colorTexture);
    expect(writeBuffer).toHaveBeenCalledTimes(2);
    expect(writeBuffer.mock.calls[0]?.[1]).toEqual(
      packDeferredLightingUniforms(PARAMETERS, { height: 4, width: 8 }),
    );
    expect(createBindGroup).toHaveBeenCalledTimes(1);
    expect(createBindGroup).toHaveBeenCalledWith(
      expect.objectContaining({
        entries: [
          { binding: 0, resource: { buffer: expect.any(Object) } },
          { binding: 1, resource: { texture: gbuffer.acquireFrame().baseColorMetallicTexture } },
          { binding: 2, resource: { texture: gbuffer.acquireFrame().normalRoughnessTexture } },
          { binding: 3, resource: { texture: gbuffer.acquireFrame().emissiveOcclusionTexture } },
          { binding: 4, resource: { texture: gbuffer.acquireFrame().depthTexture } },
        ],
        group: 0,
        label: 'deferred-lighting-viewport-a-bindings',
      }),
    );
    expect(executeFrame).toHaveBeenCalledTimes(2);
    expect(executeFrame.mock.calls[0]?.[0].renderPasses).toEqual([
      expect.objectContaining({
        colorAttachments: [{ texture: first.frame.colorTexture }],
        draws: [expect.objectContaining({ vertexCount: 3 })],
        label: 'deferred-lighting-viewport-a-pass',
      }),
    ]);
    expect(lighting.getDiagnostics()).toEqual({
      activeBindGroupCount: 1,
      estimatedGpuBytes: 256,
      executionCount: 2,
      ownerId: 'viewport-a',
      resourceGeneration: 1,
      size: { height: 4, width: 8 },
      state: 'ready',
    });

    lighting.dispose();
    gbuffer.dispose();
    expect(backend.getResourceStatistics().activeCount).toBe(0);
    backend.dispose();
  });

  it('rebuilds the input Bind Group only when the GBuffer generation changes', async () => {
    const backend = new MockBackend();
    await backend.initialize();
    const gbuffer = new DeferredGBuffer({ height: 2, ownerId: 'viewport-b', width: 2 });
    gbuffer.initialize(backend);
    const lighting = new DeferredLightingPass({ height: 2, ownerId: 'viewport-b', width: 2 });
    await lighting.initialize(backend);
    const createBindGroup = vi.spyOn(backend, 'createBindGroup');

    lighting.execute({ gbuffer: gbuffer.acquireFrame(), parameters: PARAMETERS });
    lighting.execute({ gbuffer: gbuffer.acquireFrame(), parameters: PARAMETERS });
    expect(createBindGroup).toHaveBeenCalledTimes(1);

    gbuffer.resize(4, 3);
    lighting.resize(4, 3);
    const resized = lighting.execute({ gbuffer: gbuffer.acquireFrame(), parameters: PARAMETERS });
    expect(createBindGroup).toHaveBeenCalledTimes(2);
    expect(resized.frame).toMatchObject({
      resourceGeneration: 2,
      size: { height: 3, width: 4 },
    });
    expect(lighting.getDiagnostics()).toMatchObject({
      activeBindGroupCount: 1,
      estimatedGpuBytes: 96,
      executionCount: 3,
      resourceGeneration: 2,
    });

    lighting.resize(4, 3);
    expect(lighting.getDiagnostics().resourceGeneration).toBe(2);
    lighting.dispose();
    gbuffer.dispose();
    expect(backend.getResourceStatistics().activeCount).toBe(0);
    backend.dispose();
  });

  it('rejects foreign-owner and mismatched-extent GBuffer frames', async () => {
    const backend = new MockBackend();
    await backend.initialize();
    const owned = new DeferredGBuffer({ height: 2, ownerId: 'owned', width: 2 });
    const foreign = new DeferredGBuffer({ height: 2, ownerId: 'foreign', width: 2 });
    owned.initialize(backend);
    foreign.initialize(backend);
    const lighting = new DeferredLightingPass({ height: 2, ownerId: 'owned', width: 2 });
    await lighting.initialize(backend);

    expect(() =>
      lighting.execute({ gbuffer: foreign.acquireFrame(), parameters: PARAMETERS }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    owned.resize(4, 4);
    expect(() =>
      lighting.execute({ gbuffer: owned.acquireFrame(), parameters: PARAMETERS }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));

    lighting.dispose();
    owned.dispose();
    foreign.dispose();
    expect(backend.getResourceStatistics().activeCount).toBe(0);
    backend.dispose();
  });

  it('detaches on Device Lost and creates a new output generation after recovery', async () => {
    const backend = new MockBackend();
    await backend.initialize();
    const gbuffer = new DeferredGBuffer({ height: 2, ownerId: 'viewport-c', width: 3 });
    gbuffer.initialize(backend);
    const lighting = new DeferredLightingPass({ height: 2, ownerId: 'viewport-c', width: 3 });
    await lighting.initialize(backend);
    const before = lighting.execute({ gbuffer: gbuffer.acquireFrame(), parameters: PARAMETERS }).frame;

    backend.simulateLoss({ message: 'forced Deferred Lighting loss' });
    expect(lighting.getDiagnostics()).toMatchObject({ resourceGeneration: 1, state: 'detached' });
    expect(() =>
      lighting.execute({ gbuffer: before as never, parameters: PARAMETERS }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_STATE', recoverable: true }));

    await backend.initialize();
    gbuffer.initialize(backend);
    await lighting.initialize(backend);
    const restored = lighting.execute({
      gbuffer: gbuffer.acquireFrame(),
      parameters: PARAMETERS,
    }).frame;
    expect(restored.resourceGeneration).toBe(2);
    expect(restored.colorTexture).not.toBe(before.colorTexture);

    lighting.dispose();
    gbuffer.dispose();
    expect(backend.getResourceStatistics().activeCount).toBe(0);
    backend.dispose();
  });

  it('validates construction and rejects work after disposal', async () => {
    expect(() => new DeferredLightingPass({ height: 1, ownerId: ' ', width: 1 })).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    );
    expect(() => new DeferredLightingPass({ height: 0, ownerId: 'viewport', width: 1 })).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    );

    const backend = new MockBackend();
    await backend.initialize();
    const lighting = new DeferredLightingPass({ height: 1, ownerId: 'viewport', width: 1 });
    await lighting.initialize(backend);
    lighting.dispose();
    lighting.dispose();
    expect(lighting.getDiagnostics().state).toBe('disposed');
    expect(() => lighting.resize(2, 2)).toThrowError(
      expect.objectContaining({ code: 'ALREADY_DISPOSED' }),
    );
    backend.dispose();
  });
});
