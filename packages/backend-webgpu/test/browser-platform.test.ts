import { normalizeBackendSurfaceSize } from '@kyxos/render-backend-api';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBrowserWebGpuPlatform } from '../src/browser-platform.js';

const NATIVE_LIMITS = {
  maxBindGroups: 8,
  maxColorAttachments: 4,
  maxSampledTexturesPerShaderStage: 16,
  maxStorageBufferBindingSize: 256 * 1024 * 1024,
  maxTextureDimension2D: 16_384,
  maxUniformBufferBindingSize: 65_536,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('browser WebGPU platform port', () => {
  it('contains native adapter, device, queue, and Canvas context objects', async () => {
    const nativeTextureView = {};
    const context = {
      configure: vi.fn(),
      getCurrentTexture: vi.fn(() => ({ createView: vi.fn(() => nativeTextureView) })),
      unconfigure: vi.fn(),
    };
    const queue = {
      onSubmittedWorkDone: vi.fn(() => Promise.resolve()),
      submit: vi.fn(),
      writeBuffer: vi.fn(),
    };
    const nativeBuffer = { destroy: vi.fn() };
    const nativeTexture = { destroy: vi.fn() };
    const nativeShader = {
      getCompilationInfo: vi.fn(() => Promise.resolve({ messages: [] })),
    };
    const nativePipeline = {};
    const nativeRenderPass = {
      draw: vi.fn(),
      drawIndexed: vi.fn(),
      end: vi.fn(),
      setIndexBuffer: vi.fn(),
      setPipeline: vi.fn(),
      setVertexBuffer: vi.fn(),
    };
    const nativeCommandBuffer = {};
    const nativeCommandEncoder = {
      beginRenderPass: vi.fn(() => nativeRenderPass),
      finish: vi.fn(() => nativeCommandBuffer),
    };
    const nativeDevice = {
      createBuffer: vi.fn(() => nativeBuffer as unknown as GPUBuffer),
      createCommandEncoder: vi.fn(() => nativeCommandEncoder as unknown as GPUCommandEncoder),
      createRenderPipelineAsync: vi.fn(() =>
        Promise.resolve(nativePipeline as unknown as GPURenderPipeline),
      ),
      createSampler: vi.fn(() => ({}) as GPUSampler),
      createShaderModule: vi.fn(() => nativeShader as unknown as GPUShaderModule),
      createTexture: vi.fn(() => nativeTexture as unknown as GPUTexture),
      destroy: vi.fn(),
      lost: new Promise<GPUDeviceLostInfo>(() => undefined),
      queue,
    };
    const nativeAdapter = {
      features: new Set<GPUFeatureName>(['timestamp-query']),
      limits: NATIVE_LIMITS,
      requestDevice: vi.fn(() => Promise.resolve(nativeDevice as unknown as GPUDevice)),
    };
    const gpu = {
      getPreferredCanvasFormat: vi.fn(() => 'bgra8unorm' as const),
      requestAdapter: vi.fn(() => Promise.resolve(nativeAdapter as unknown as GPUAdapter)),
    };
    vi.stubGlobal('navigator', { gpu });

    const platform = createBrowserWebGpuPlatform();
    const adapter = await platform.requestAdapter({
      forceFallbackAdapter: false,
      powerPreference: 'high-performance',
    });
    if (adapter === null) throw new Error('Expected the fake WebGPU adapter.');
    expect(adapter.features).toEqual(new Set(['compute', 'timestamp-query']));
    expect(adapter.limits).toEqual(NATIVE_LIMITS);

    const device = await adapter.requestDevice({
      label: 'contained-native-device',
      requiredFeatures: ['compute', 'timestamp-query'],
    });
    expect(nativeAdapter.requestDevice).toHaveBeenCalledExactlyOnceWith({
      label: 'contained-native-device',
      requiredFeatures: ['timestamp-query'],
    });
    await device.queue.onSubmittedWorkDone();
    expect(queue.onSubmittedWorkDone).toHaveBeenCalledTimes(1);

    const buffer = device.createBuffer({ size: 64, usage: ['copy-dst', 'vertex'] });
    expect(nativeDevice.createBuffer).toHaveBeenCalledExactlyOnceWith({
      mappedAtCreation: false,
      size: 64,
      usage: 0x28,
    });
    device.queue.writeBuffer(buffer, 0, new Float32Array(16));
    expect(queue.writeBuffer).toHaveBeenCalledWith(nativeBuffer, 0, expect.any(Float32Array));
    const texture = device.createTexture({
      format: 'rgba8unorm',
      size: { height: 4, width: 8 },
      usage: ['render-attachment', 'sampled'],
    });
    expect(nativeDevice.createTexture).toHaveBeenCalledExactlyOnceWith({
      dimension: '2d',
      format: 'rgba8unorm',
      mipLevelCount: 1,
      sampleCount: 1,
      size: { depthOrArrayLayers: 1, height: 4, width: 8 },
      usage: 0x14,
    });
    device.createSampler({ magFilter: 'linear' });
    expect(nativeDevice.createSampler).toHaveBeenCalledExactlyOnceWith({ magFilter: 'linear' });
    const shader = device.createShaderModule({ code: '@vertex fn main() {}', language: 'wgsl' });
    expect(await shader.getCompilationInfo()).toEqual({ messages: [], valid: true });
    const pipeline = await device.createRenderPipeline({
      fragment: {
        entryPoint: 'fragmentMain',
        module: shader,
        targets: [{ format: 'bgra8unorm' }],
      },
      label: 'pipeline',
      primitive: { topology: 'triangle-list' },
      vertex: { buffers: [], entryPoint: 'vertexMain', module: shader },
    });
    expect(nativeDevice.createRenderPipelineAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        fragment: expect.objectContaining({ module: nativeShader }),
        label: 'pipeline',
        vertex: expect.objectContaining({ module: nativeShader }),
      }),
    );
    const commandEncoder = device.createCommandEncoder({ label: 'frame' });
    expect(nativeDevice.createCommandEncoder).toHaveBeenCalledExactlyOnceWith({ label: 'frame' });
    buffer.destroy();
    texture.destroy();
    expect(nativeBuffer.destroy).toHaveBeenCalledTimes(1);
    expect(nativeTexture.destroy).toHaveBeenCalledTimes(1);

    const target = {
      getContext: vi.fn(() => context),
      height: 0,
      width: 0,
    };
    const surface = device.createSurface({
      alphaMode: 'opaque',
      colorSpace: 'srgb',
      label: 'surface',
      target,
    });
    const visible = normalizeBackendSurfaceSize(
      { cssHeight: 180, cssWidth: 320, devicePixelRatio: 2 },
      16_384,
    );
    surface.configure(visible);

    commandEncoder.encodeRenderPass({
      clearColor: { a: 1, b: 0.3, g: 0.2, r: 0.1 },
      draws: [
        {
          firstIndex: 0,
          firstInstance: 0,
          firstVertex: 0,
          indexBuffer: undefined,
          indexCount: undefined,
          instanceCount: 1,
          pipeline,
          vertexBuffers: [{ buffer, offset: 0, size: undefined, slot: 0 }],
          vertexCount: 3,
        },
      ],
      label: 'basic-pass',
      surface,
    });
    expect(nativeCommandEncoder.beginRenderPass).toHaveBeenCalledWith({
      colorAttachments: [
        {
          clearValue: { a: 1, b: 0.3, g: 0.2, r: 0.1 },
          loadOp: 'clear',
          storeOp: 'store',
          view: nativeTextureView,
        },
      ],
      label: 'basic-pass',
    });
    expect(nativeRenderPass.setPipeline).toHaveBeenCalledWith(nativePipeline);
    expect(nativeRenderPass.setVertexBuffer).toHaveBeenCalledWith(0, nativeBuffer, 0);
    expect(nativeRenderPass.draw).toHaveBeenCalledWith(3, 1, 0, 0);
    expect(nativeRenderPass.end).toHaveBeenCalledTimes(1);
    const commandBuffer = commandEncoder.finish();
    device.queue.submit([commandBuffer]);
    expect(queue.submit).toHaveBeenCalledExactlyOnceWith([nativeCommandBuffer]);

    expect(target).toMatchObject({ height: 360, width: 640 });
    expect(context.configure).toHaveBeenCalledExactlyOnceWith({
      alphaMode: 'opaque',
      colorSpace: 'srgb',
      device: nativeDevice,
      format: 'bgra8unorm',
    });
    const hidden = normalizeBackendSurfaceSize(
      { cssHeight: 0, cssWidth: 320, devicePixelRatio: 2 },
      16_384,
    );
    surface.configure(hidden);
    expect(target).toMatchObject({ height: 0, width: 0 });
    expect(context.unconfigure).toHaveBeenCalledTimes(1);

    surface.unconfigure();
    device.destroy();
    expect(context.unconfigure).toHaveBeenCalledTimes(2);
    expect(nativeDevice.destroy).toHaveBeenCalledTimes(1);
  });

  it('rejects a Canvas that does not supply a WebGPU context', async () => {
    const nativeDevice = {
      destroy: vi.fn(),
      lost: new Promise<GPUDeviceLostInfo>(() => undefined),
      queue: { onSubmittedWorkDone: vi.fn(() => Promise.resolve()) },
    };
    const nativeAdapter = {
      features: new Set<GPUFeatureName>(),
      limits: NATIVE_LIMITS,
      requestDevice: vi.fn(() => Promise.resolve(nativeDevice as unknown as GPUDevice)),
    };
    vi.stubGlobal('navigator', {
      gpu: {
        getPreferredCanvasFormat: vi.fn(() => 'bgra8unorm' as const),
        requestAdapter: vi.fn(() => Promise.resolve(nativeAdapter as unknown as GPUAdapter)),
      },
    });
    const adapter = await createBrowserWebGpuPlatform().requestAdapter({
      forceFallbackAdapter: false,
      powerPreference: undefined,
    });
    if (adapter === null) throw new Error('Expected the fake WebGPU adapter.');
    const device = await adapter.requestDevice({ label: undefined, requiredFeatures: [] });

    expect(() =>
      device.createSurface({
        alphaMode: 'opaque',
        colorSpace: 'srgb',
        label: undefined,
        target: { getContext: () => null, height: 0, width: 0 },
      }),
    ).toThrow('Canvas did not provide a WebGPU context.');
  });
});
