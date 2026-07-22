import { createBackendCapabilityReport } from '@kyxos/render-backend-api';
import { KyxosEngineError } from '@kyxos/render-core';
import { describe, expect, it, vi } from 'vitest';

import { MockBackend } from '../src/index.js';

describe('MockBackend', () => {
  it('reports explicit immutable capabilities and lifecycle transitions', async () => {
    const backend = new MockBackend({
      capabilities: createBackendCapabilityReport({
        backend: 'mock',
        features: { compute: true },
        limits: { maxTextureDimension2D: 4096 },
      }),
    });
    const transitions: string[] = [];
    backend.on('statechange', ({ current, previous }) =>
      transitions.push(`${previous}->${current}`),
    );

    await backend.initialize();
    await backend.initialize();
    await backend.waitForIdle();

    expect(backend.state).toBe('ready');
    expect(backend.capabilities.features.compute).toBe(true);
    expect(backend.capabilities.features['shader-f16']).toBe(false);
    expect(backend.capabilities.limits.maxTextureDimension2D).toBe(4096);
    expect(Object.isFrozen(backend.capabilities.features)).toBe(true);
    expect(transitions).toEqual(['new->initializing', 'initializing->ready']);
  });

  it('accounts for resources and returns active counters to baseline', async () => {
    const backend = new MockBackend();
    await backend.initialize();
    const baseline = backend.getResourceStatistics();
    const texture = backend.createResource('texture', { estimatedBytes: 4096, label: 'albedo' });
    const buffer = backend.createResource('buffer', { estimatedBytes: 256 });

    const active = backend.getResourceStatistics();
    expect(active).toMatchObject({
      activeCount: 2,
      activeEstimatedBytes: 4352,
      createdTotal: 2,
      destroyedTotal: 0,
    });
    expect(active.byKind.texture).toEqual({ activeCount: 1, activeEstimatedBytes: 4096 });
    expect(backend.destroyResource(texture)).toBe(true);
    expect(backend.destroyResource(texture)).toBe(false);
    expect(backend.destroyResource(buffer)).toBe(true);

    const released = backend.getResourceStatistics();
    expect(released.activeCount).toBe(baseline.activeCount);
    expect(released.activeEstimatedBytes).toBe(baseline.activeEstimatedBytes);
    expect(released.createdTotal).toBe(2);
    expect(released.destroyedTotal).toBe(2);
  });

  it('never reuses handles after explicit resource destruction', async () => {
    const backend = new MockBackend();
    await backend.initialize();
    const first = backend.createResource('texture');
    backend.destroyResource(first);
    const second = backend.createResource('texture');

    expect(second.id).toBeGreaterThan(first.id);
    expect(second.kind).toBe('backend:texture');
  });

  it('rejects equal-looking resource handles owned by another backend', async () => {
    const first = new MockBackend();
    const second = new MockBackend();
    await Promise.all([first.initialize(), second.initialize()]);
    const firstHandle = first.createResource('buffer');
    const secondHandle = second.createResource('buffer');

    expect(firstHandle).toEqual(secondHandle);
    expect(firstHandle).not.toBe(secondHandle);
    expect(first.destroyResource(secondHandle)).toBe(false);
    expect(first.getResourceStatistics().activeCount).toBe(1);
  });

  it('rejects invalid creation states and resource byte estimates', async () => {
    const backend = new MockBackend();
    expect(() => backend.createResource('buffer')).toThrow(KyxosEngineError);
    await backend.initialize();
    expect(() => backend.createResource('buffer', { estimatedBytes: -1 })).toThrow(
      KyxosEngineError,
    );

    backend.dispose();
    await expect(backend.initialize()).rejects.toMatchObject({ code: 'ALREADY_DISPOSED' });
  });

  it('reports an unavailable capability result as a recoverable startup error', async () => {
    const backend = new MockBackend({
      capabilities: createBackendCapabilityReport({
        available: false,
        backend: 'mock',
        unavailableReason: 'test backend disabled',
      }),
    });

    await expect(backend.initialize()).rejects.toMatchObject({
      code: 'BACKEND_UNAVAILABLE',
      message: 'test backend disabled',
      recoverable: true,
    });
    expect(backend.state).toBe('new');
  });

  it('invalidates resources on loss, reports the cause, and can reinitialize', async () => {
    const backend = new MockBackend();
    const onLost = vi.fn();
    backend.on('lost', onLost);
    await backend.initialize();
    backend.createResource('pipeline', { estimatedBytes: 128 });

    backend.simulateLoss({ message: 'test loss', reason: 'destroyed' });

    expect(backend.state).toBe('lost');
    expect(backend.getResourceStatistics()).toMatchObject({
      activeCount: 0,
      activeEstimatedBytes: 0,
      createdTotal: 1,
      destroyedTotal: 1,
    });
    expect(onLost).toHaveBeenCalledExactlyOnceWith({
      message: 'test loss',
      reason: 'destroyed',
      recoverable: true,
    });

    await backend.initialize();
    expect(backend.state).toBe('ready');
  });

  it('validates Bind Group ownership and depth-enabled frame submissions', async () => {
    const backend = new MockBackend();
    await backend.initialize();
    const shader = backend.createShaderModule({
      code: '@vertex fn main() -> @builtin(position) vec4f { return vec4f(); }',
      language: 'wgsl',
    });
    const pipeline = await backend.createRenderPipeline({
      depthStencil: {
        depthCompare: 'less',
        depthWriteEnabled: true,
        format: 'depth24plus',
      },
      vertex: { entryPoint: 'main', module: shader },
    });
    const uniform = backend.createBuffer({ size: 64, usage: ['uniform'] });
    const sampled = backend.createTexture({
      format: 'rgba8unorm-srgb',
      size: { height: 1, width: 1 },
      usage: ['copy-dst', 'sampled'],
    });
    backend.writeTexture(sampled, new Uint8Array([255, 255, 255, 255]), {
      size: { height: 1, width: 1 },
    });
    const sampler = backend.createSampler({ magFilter: 'linear' });
    const bindGroup = backend.createBindGroup({
      entries: [
        { binding: 0, resource: { buffer: uniform } },
        { binding: 1, resource: { texture: sampled } },
        { binding: 2, resource: { sampler } },
      ],
      group: 0,
      pipeline,
    });
    const target = { getContext: () => ({}), height: 0, width: 0 };
    const surface = backend.createSurface({
      cssHeight: 100,
      cssWidth: 160,
      devicePixelRatio: 1,
      target,
    });
    const depth = backend.createTexture({
      format: 'depth24plus',
      size: { height: 100, width: 160 },
      usage: ['render-attachment'],
    });

    expect(
      backend.executeFrame({
        commandEncoder: backend.createCommandEncoder(),
        renderPasses: [
          {
            clearColor: { a: 1, b: 0, g: 0, r: 0 },
            depthAttachment: { texture: depth },
            draws: [{ bindGroups: [{ bindGroup, group: 0 }], pipeline, vertexCount: 3 }],
            surface,
          },
        ],
      }),
    ).toEqual({ drawCalls: 1, instances: 1, triangles: 1, vertices: 3 });

    const invalidEncoder = backend.createCommandEncoder();
    expect(() =>
      backend.executeFrame({
        commandEncoder: invalidEncoder,
        renderPasses: [
          {
            clearColor: { a: 1, b: 0, g: 0, r: 0 },
            draws: [{ bindGroups: [{ bindGroup, group: 1 }], pipeline, vertexCount: 3 }],
            surface,
          },
        ],
      }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    expect(backend.destroyResource(invalidEncoder)).toBe(true);

    expect(backend.destroyResource(sampled)).toBe(true);
    const staleEncoder = backend.createCommandEncoder();
    expect(() =>
      backend.executeFrame({
        commandEncoder: staleEncoder,
        renderPasses: [
          {
            clearColor: { a: 1, b: 0, g: 0, r: 0 },
            depthAttachment: { texture: depth },
            draws: [{ bindGroups: [{ bindGroup, group: 0 }], pipeline, vertexCount: 3 }],
            surface,
          },
        ],
      }),
    ).toThrow('stale or incompatible');
    expect(backend.destroyResource(staleEncoder)).toBe(true);
    backend.dispose();
  });

  it('releases every resource on idempotent disposal', async () => {
    const backend = new MockBackend();
    await backend.initialize();
    backend.createResource('texture', { estimatedBytes: 512 });
    backend.createResource('buffer', { estimatedBytes: 64 });

    backend.dispose();
    backend.dispose();

    expect(backend.disposed).toBe(true);
    expect(backend.getResourceStatistics()).toMatchObject({
      activeCount: 0,
      activeEstimatedBytes: 0,
      createdTotal: 2,
      destroyedTotal: 2,
    });
  });
});
