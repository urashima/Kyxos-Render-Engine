import type {
  BackendBufferHandle,
  BackendResourceHandle,
  BackendSamplerHandle,
  BackendTextureHandle,
  GraphicsBackend,
} from '@kyxos/render-backend-api';
import { MockBackend } from '@kyxos/render-testing';
import { describe, expect, it, vi } from 'vitest';

import {
  DeferredGBuffer,
  type DeferredGBufferRasterDraw,
  DeferredGBufferRasterPass,
  type DeferredLightingParameters,
  DeferredLightingPass,
  PBR_OBJECT_UNIFORM_LAYOUT,
} from '../src/index.js';

const LIGHTING_PARAMETERS: DeferredLightingParameters = Object.freeze({
  ambientIntensity: 0.1,
  cameraPosition: [0, 0, 4] as const,
  inverseViewProjection: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] as const,
  lightColor: [1, 0.9, 0.8] as const,
  lightDirection: [0.25, 0.5, 1] as const,
  lightIntensity: 3,
});

interface BorrowedDrawResources {
  readonly handles: readonly BackendResourceHandle[];
  readonly indexBuffer: BackendBufferHandle;
  readonly sampler: BackendSamplerHandle;
  readonly texture: BackendTextureHandle;
  readonly vertexBuffer: BackendBufferHandle;
}

function createBorrowedDrawResources(backend: GraphicsBackend): BorrowedDrawResources {
  const texture = backend.createTexture({
    format: 'rgba8unorm',
    label: 'deferred-gbuffer-test-texture',
    size: { height: 1, width: 1 },
    usage: ['sampled'],
  });
  const sampler = backend.createSampler({
    label: 'deferred-gbuffer-test-sampler',
    magFilter: 'nearest',
    minFilter: 'nearest',
  });
  const vertexBuffer = backend.createBuffer({
    label: 'deferred-gbuffer-test-vertices',
    size: 3 * 12 * Float32Array.BYTES_PER_ELEMENT,
    usage: ['vertex'],
  });
  const indexBuffer = backend.createBuffer({
    label: 'deferred-gbuffer-test-indices',
    size: 3 * Uint16Array.BYTES_PER_ELEMENT,
    usage: ['index'],
  });
  return Object.freeze({
    handles: Object.freeze([indexBuffer, vertexBuffer, sampler, texture]),
    indexBuffer,
    sampler,
    texture,
    vertexBuffer,
  });
}

function createDraw(
  resources: BorrowedDrawResources,
  overrides: Partial<DeferredGBufferRasterDraw> = {},
): DeferredGBufferRasterDraw {
  const binding = Object.freeze({ sampler: resources.sampler, texture: resources.texture });
  return Object.freeze({
    bindingGeneration: 0,
    baseColor: binding,
    emissive: binding,
    id: 'triangle',
    metallicRoughness: binding,
    normal: binding,
    occlusion: binding,
    uniforms: new Float32Array(PBR_OBJECT_UNIFORM_LAYOUT.floatLength),
    vertexBuffer: resources.vertexBuffer,
    vertexCount: 3,
    ...overrides,
  });
}

function destroyBorrowed(backend: GraphicsBackend, resources: BorrowedDrawResources): void {
  for (const handle of resources.handles) backend.destroyResource(handle);
}

describe('DeferredGBufferRasterPass', () => {
  it('writes the ordered five-target GBuffer and feeds Deferred Lighting without shared ownership', async () => {
    const backend = new MockBackend();
    await backend.initialize();
    const gbuffer = new DeferredGBuffer({ height: 4, ownerId: 'viewport-a', width: 8 });
    gbuffer.initialize(backend);
    const raster = new DeferredGBufferRasterPass({ ownerId: 'viewport-a' });
    const createPipeline = vi.spyOn(backend, 'createRenderPipeline');
    const createBindGroup = vi.spyOn(backend, 'createBindGroup');
    const writeBuffer = vi.spyOn(backend, 'writeBuffer');
    const executeFrame = vi.spyOn(backend, 'executeFrame');
    await raster.initialize(backend);
    await raster.initialize(backend);
    const borrowed = createBorrowedDrawResources(backend);
    const frame = gbuffer.acquireFrame();

    const first = raster.execute({ draws: [createDraw(borrowed)], frame });
    const second = raster.execute({ draws: [createDraw(borrowed)], frame });

    expect(createPipeline).toHaveBeenCalledTimes(4);
    expect(first.statistics).toEqual({ drawCalls: 1, instances: 1, triangles: 1, vertices: 3 });
    expect(second.frame).toBe(frame);
    expect(createBindGroup).toHaveBeenCalledTimes(1);
    expect(writeBuffer).toHaveBeenCalledTimes(2);
    expect(writeBuffer.mock.calls[0]?.[1]).toHaveLength(PBR_OBJECT_UNIFORM_LAYOUT.floatLength);
    expect(executeFrame.mock.calls[0]?.[0].renderPasses).toEqual([
      expect.objectContaining({
        colorAttachments: [
          expect.objectContaining({ texture: frame.baseColorMetallicTexture }),
          expect.objectContaining({ texture: frame.normalRoughnessTexture }),
          expect.objectContaining({ texture: frame.emissiveOcclusionTexture }),
          expect.objectContaining({ texture: frame.velocityTexture }),
        ],
        depthAttachment: expect.objectContaining({ texture: frame.depthTexture }),
        draws: [
          expect.objectContaining({
            bindGroups: [expect.objectContaining({ group: 0 })],
            instanceCount: 1,
            vertexBuffers: [{ buffer: borrowed.vertexBuffer, slot: 0 }],
            vertexCount: 3,
          }),
        ],
        label: 'deferred-gbuffer-raster-viewport-a-pass',
      }),
    ]);
    expect(raster.getDiagnostics()).toEqual({
      activeObjectBindingCount: 1,
      executionCount: 2,
      ownerId: 'viewport-a',
      pipelineCount: 4,
      state: 'ready',
    });

    const lighting = new DeferredLightingPass({ height: 4, ownerId: 'viewport-a', width: 8 });
    await lighting.initialize(backend);
    const lit = lighting.execute({ gbuffer: first.frame, parameters: LIGHTING_PARAMETERS });
    expect(lit.frame).toMatchObject({
      ownerId: 'viewport-a',
      resourceGeneration: 1,
      size: { height: 4, width: 8 },
    });
    expect(lit.statistics).toEqual({ drawCalls: 1, instances: 1, triangles: 1, vertices: 3 });

    lighting.dispose();
    raster.dispose();
    gbuffer.dispose();
    destroyBorrowed(backend, borrowed);
    expect(backend.getResourceStatistics().activeCount).toBe(0);
    backend.dispose();
  });

  it('reuses object bindings, rebuilds only on binding changes, and releases stale objects', async () => {
    const backend = new MockBackend();
    await backend.initialize();
    const gbuffer = new DeferredGBuffer({ height: 2, ownerId: 'viewport-b', width: 2 });
    gbuffer.initialize(backend);
    const raster = new DeferredGBufferRasterPass({ ownerId: 'viewport-b' });
    await raster.initialize(backend);
    const borrowed = createBorrowedDrawResources(backend);
    const createBindGroup = vi.spyOn(backend, 'createBindGroup');
    const frame = gbuffer.acquireFrame();

    raster.execute({ draws: [createDraw(borrowed)], frame });
    raster.execute({
      draws: [
        createDraw(borrowed, {
          alphaMode: 'mask',
          bindingGeneration: 1,
          doubleSided: true,
        }),
      ],
      frame,
    });
    expect(createBindGroup).toHaveBeenCalledTimes(2);
    expect(raster.getDiagnostics().activeObjectBindingCount).toBe(1);

    raster.execute({ draws: [], frame });
    expect(raster.getDiagnostics()).toMatchObject({
      activeObjectBindingCount: 0,
      executionCount: 3,
    });

    raster.dispose();
    gbuffer.dispose();
    destroyBorrowed(backend, borrowed);
    expect(backend.getResourceStatistics().activeCount).toBe(0);
    backend.dispose();
  });

  it('supports indexed draws and rejects malformed geometry, uniforms, duplicate ids, and foreign frames', async () => {
    const backend = new MockBackend();
    await backend.initialize();
    const owned = new DeferredGBuffer({ height: 2, ownerId: 'owned', width: 2 });
    const foreign = new DeferredGBuffer({ height: 2, ownerId: 'foreign', width: 2 });
    owned.initialize(backend);
    foreign.initialize(backend);
    const raster = new DeferredGBufferRasterPass({ ownerId: 'owned' });
    await raster.initialize(backend);
    const borrowed = createBorrowedDrawResources(backend);
    const frame = owned.acquireFrame();

    const baseDraw = createDraw(borrowed);
    const indexed: DeferredGBufferRasterDraw = Object.freeze({
      baseColor: baseDraw.baseColor,
      bindingGeneration: baseDraw.bindingGeneration,
      emissive: baseDraw.emissive,
      id: baseDraw.id,
      indexBuffer: borrowed.indexBuffer,
      indexCount: 3,
      indexFormat: 'uint16',
      metallicRoughness: baseDraw.metallicRoughness,
      normal: baseDraw.normal,
      occlusion: baseDraw.occlusion,
      uniforms: baseDraw.uniforms,
      vertexBuffer: baseDraw.vertexBuffer,
    });
    expect(raster.execute({ draws: [indexed], frame }).statistics).toEqual({
      drawCalls: 1,
      instances: 1,
      triangles: 1,
      vertices: 3,
    });
    expect(() =>
      raster.execute({
        draws: [createDraw(borrowed, { indexBuffer: borrowed.indexBuffer })],
        frame,
      }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    expect(() =>
      raster.execute({
        draws: [
          createDraw(borrowed, {
            uniforms: new Float32Array(PBR_OBJECT_UNIFORM_LAYOUT.floatLength - 1),
          }),
        ],
        frame,
      }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    expect(() =>
      raster.execute({
        draws: [createDraw(borrowed), createDraw(borrowed)],
        frame,
      }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    expect(() =>
      raster.execute({ draws: [createDraw(borrowed)], frame: foreign.acquireFrame() }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));

    raster.dispose();
    owned.dispose();
    foreign.dispose();
    destroyBorrowed(backend, borrowed);
    expect(backend.getResourceStatistics().activeCount).toBe(0);
    backend.dispose();
  });

  it('detaches on Device Lost, restores cleanly, and rejects work after disposal', async () => {
    expect(() => new DeferredGBufferRasterPass({ ownerId: ' ' })).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    );

    const backend = new MockBackend();
    await backend.initialize();
    const gbuffer = new DeferredGBuffer({ height: 2, ownerId: 'viewport-c', width: 2 });
    gbuffer.initialize(backend);
    const raster = new DeferredGBufferRasterPass({ ownerId: 'viewport-c' });
    await raster.initialize(backend);
    const borrowed = createBorrowedDrawResources(backend);
    const beforeLossFrame = gbuffer.acquireFrame();
    raster.execute({ draws: [createDraw(borrowed)], frame: beforeLossFrame });

    backend.simulateLoss({ message: 'forced Deferred GBuffer Raster loss' });
    expect(raster.getDiagnostics()).toMatchObject({
      activeObjectBindingCount: 0,
      pipelineCount: 0,
      state: 'detached',
    });
    expect(() =>
      raster.execute({ draws: [createDraw(borrowed)], frame: beforeLossFrame }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_STATE', recoverable: true }));

    await backend.initialize();
    gbuffer.initialize(backend);
    await raster.initialize(backend);
    const restoredBorrowed = createBorrowedDrawResources(backend);
    expect(
      raster.execute({
        draws: [createDraw(restoredBorrowed)],
        frame: gbuffer.acquireFrame(),
      }).statistics.drawCalls,
    ).toBe(1);

    raster.dispose();
    raster.dispose();
    expect(raster.getDiagnostics().state).toBe('disposed');
    expect(() => raster.execute({ draws: [], frame: gbuffer.acquireFrame() })).toThrowError(
      expect.objectContaining({ code: 'ALREADY_DISPOSED' }),
    );
    gbuffer.dispose();
    // Device-loss handles are no longer valid resources and are intentionally not destroyed.
    destroyBorrowed(backend, restoredBorrowed);
    expect(backend.getResourceStatistics().activeCount).toBe(0);
    backend.dispose();
  });
});
