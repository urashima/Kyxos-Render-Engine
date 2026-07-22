import type {
  BackendBindGroupResource,
  BackendFeature,
  BackendLimits,
  BackendLossInfo,
  BackendSurfaceSize,
  BackendTextureViewDescriptor,
} from '@kyxos/render-backend-api';
import { KyxosEngineError } from '@kyxos/render-core';
import { describe, expect, it, vi } from 'vitest';

import { createWebGpuBackendForPlatform } from '../src/backend.js';
import type {
  WebGpuAdapterPort,
  WebGpuBindGroupPort,
  WebGpuBufferPort,
  WebGpuCommandBufferPort,
  WebGpuCommandEncoderPort,
  WebGpuDevicePort,
  WebGpuDeviceRequest,
  WebGpuPipelinePort,
  WebGpuPlatformPort,
  WebGpuRenderPassRequest,
  WebGpuRenderPipelineRequest,
  WebGpuSamplerPort,
  WebGpuShaderModulePort,
  WebGpuSurfacePort,
  WebGpuSurfaceRequest,
  WebGpuTexturePort,
  WebGpuTextureViewPort,
} from '../src/platform.js';

const TEST_LIMITS: BackendLimits = Object.freeze({
  maxBindGroups: 8,
  maxColorAttachments: 4,
  maxSampledTexturesPerShaderStage: 16,
  maxStorageBufferBindingSize: 256 * 1024 * 1024,
  maxTextureDimension2D: 16_384,
  maxUniformBufferBindingSize: 65_536,
});

class Deferred<Value> {
  readonly promise: Promise<Value>;
  #resolve: ((value: Value) => void) | undefined;

  constructor() {
    this.promise = new Promise<Value>((resolve) => {
      this.#resolve = resolve;
    });
  }

  resolve(value: Value): void {
    this.#resolve?.(value);
  }
}

class FakeSurface implements WebGpuSurfacePort {
  readonly configure = vi.fn<(size: BackendSurfaceSize) => void>();
  readonly format = 'bgra8unorm' as const;
  readonly unconfigure = vi.fn();
}

class FakeBuffer implements WebGpuBufferPort {
  readonly destroy = vi.fn();
}

class FakeTexture implements WebGpuTexturePort {
  readonly createView = vi.fn<(descriptor?: BackendTextureViewDescriptor) => WebGpuTextureViewPort>(
    () => ({ kind: 'texture-view' }),
  );
  readonly destroy = vi.fn();
}

class FakeBindGroup implements WebGpuBindGroupPort {
  readonly kind = 'bind-group' as const;
}

class FakeShaderModule implements WebGpuShaderModulePort {
  readonly getCompilationInfo = vi.fn(() =>
    Promise.resolve(
      Object.freeze({
        messages: Object.freeze([]),
        valid: true,
      }),
    ),
  );
}

class FakeCommandBuffer implements WebGpuCommandBufferPort {
  readonly kind = 'command-buffer' as const;
}

class FakeCommandEncoder implements WebGpuCommandEncoderPort {
  readonly kind = 'command-encoder' as const;
  readonly commandBuffer = new FakeCommandBuffer();
  readonly encodeRenderPass = vi.fn<(request: WebGpuRenderPassRequest) => void>();
  readonly finish = vi.fn(() => this.commandBuffer);
}

class FakeDevice implements WebGpuDevicePort {
  readonly #loss = new Deferred<BackendLossInfo>();
  readonly destroy = vi.fn();
  readonly lost = this.#loss.promise;
  readonly queue = Object.freeze({
    onSubmittedWorkDone: vi.fn(() => Promise.resolve()),
    submit: vi.fn<(commandBuffers: readonly WebGpuCommandBufferPort[]) => void>(),
    writeBuffer: vi.fn<WebGpuDevicePort['queue']['writeBuffer']>(),
    writeTexture: vi.fn<WebGpuDevicePort['queue']['writeTexture']>(),
  });
  readonly createSurface = vi.fn<(request: WebGpuSurfaceRequest) => WebGpuSurfacePort>();
  readonly buffers: FakeBuffer[] = [];
  readonly textures: FakeTexture[] = [];
  readonly shaders: FakeShaderModule[] = [];
  readonly samplers: WebGpuSamplerPort[] = [];
  readonly encoders: FakeCommandEncoder[] = [];
  readonly createBuffer = vi.fn<
    (descriptor: Parameters<WebGpuDevicePort['createBuffer']>[0]) => WebGpuBufferPort
  >(() => {
    const buffer = new FakeBuffer();
    this.buffers.push(buffer);
    return buffer;
  });
  readonly createBindGroup = vi.fn<WebGpuDevicePort['createBindGroup']>(() => new FakeBindGroup());
  readonly createTexture = vi.fn<
    (descriptor: Parameters<WebGpuDevicePort['createTexture']>[0]) => WebGpuTexturePort
  >(() => {
    const texture = new FakeTexture();
    this.textures.push(texture);
    return texture;
  });
  readonly createSampler = vi.fn<
    (descriptor: Parameters<WebGpuDevicePort['createSampler']>[0]) => WebGpuSamplerPort
  >(() => {
    const sampler = { kind: 'sampler' as const };
    this.samplers.push(sampler);
    return sampler;
  });
  readonly createShaderModule = vi.fn<
    (descriptor: Parameters<WebGpuDevicePort['createShaderModule']>[0]) => WebGpuShaderModulePort
  >(() => {
    const shader = new FakeShaderModule();
    this.shaders.push(shader);
    return shader;
  });
  readonly createRenderPipeline = vi.fn<
    (request: WebGpuRenderPipelineRequest) => Promise<WebGpuPipelinePort>
  >(() => Promise.resolve({ kind: 'pipeline' }));
  readonly createCommandEncoder = vi.fn<
    (
      descriptor: Parameters<WebGpuDevicePort['createCommandEncoder']>[0],
    ) => WebGpuCommandEncoderPort
  >(() => {
    const encoder = new FakeCommandEncoder();
    this.encoders.push(encoder);
    return encoder;
  });

  constructor(surfaces: readonly FakeSurface[] = []) {
    for (const surface of surfaces) {
      this.createSurface.mockReturnValueOnce(surface);
    }
  }

  lose(loss: BackendLossInfo): void {
    this.#loss.resolve(loss);
  }
}

class FakeAdapter implements WebGpuAdapterPort {
  readonly features: ReadonlySet<BackendFeature>;
  readonly limits = TEST_LIMITS;
  readonly requestDevice = vi.fn<(request: WebGpuDeviceRequest) => Promise<WebGpuDevicePort>>();

  constructor(features: readonly BackendFeature[], devices: readonly FakeDevice[]) {
    this.features = new Set(features);
    for (const device of devices) {
      this.requestDevice.mockResolvedValueOnce(device);
    }
  }
}

class FakePlatform implements WebGpuPlatformPort {
  readonly requestAdapter = vi.fn<() => Promise<WebGpuAdapterPort | null>>();

  constructor(
    readonly available: boolean,
    adapters: readonly (WebGpuAdapterPort | null)[],
  ) {
    for (const adapter of adapters) {
      this.requestAdapter.mockResolvedValueOnce(adapter);
    }
  }
}

describe('WebGpuBackend device lifecycle', () => {
  it('reports WebGPU absence as a recoverable stable error', async () => {
    const platform = new FakePlatform(false, []);
    const backend = createWebGpuBackendForPlatform({}, platform);

    expect(backend.capabilities).toMatchObject({ available: false, backend: 'webgpu' });
    await expect(backend.initialize()).rejects.toMatchObject({
      code: 'BACKEND_UNAVAILABLE',
      recoverable: true,
    });
    expect(backend.state).toBe('new');
    expect(platform.requestAdapter).not.toHaveBeenCalled();
    expect(() => backend.createResource('buffer')).toThrow(
      expect.objectContaining({ code: 'INVALID_STATE' }),
    );
  });

  it('reports a missing adapter without attempting device creation', async () => {
    const platform = new FakePlatform(true, [null]);
    const backend = createWebGpuBackendForPlatform(
      { forceFallbackAdapter: true, powerPreference: 'low-power' },
      platform,
    );
    const transitions: string[] = [];
    backend.on('statechange', ({ current, previous }) =>
      transitions.push(`${previous}->${current}`),
    );

    await expect(backend.initialize()).rejects.toMatchObject({ code: 'BACKEND_UNAVAILABLE' });

    expect(platform.requestAdapter).toHaveBeenCalledExactlyOnceWith({
      forceFallbackAdapter: true,
      powerPreference: 'low-power',
    });
    expect(backend.capabilities.unavailableReason).toBe('No compatible WebGPU adapter was found.');
    expect(transitions).toEqual(['new->initializing', 'initializing->new']);
  });

  it('coalesces initialization and exposes immutable negotiated capabilities', async () => {
    const device = new FakeDevice();
    const adapter = new FakeAdapter(['compute', 'timestamp-query'], [device]);
    const platform = new FakePlatform(true, [adapter]);
    const backend = createWebGpuBackendForPlatform(
      { label: 'phase-01', requiredFeatures: ['timestamp-query'] },
      platform,
    );

    await Promise.all([backend.initialize(), backend.initialize(), backend.initialize()]);

    expect(platform.requestAdapter).toHaveBeenCalledTimes(1);
    expect(adapter.requestDevice).toHaveBeenCalledExactlyOnceWith({
      label: 'phase-01',
      requiredFeatures: ['timestamp-query'],
    });
    expect(backend.state).toBe('ready');
    expect(backend.capabilities).toMatchObject({
      available: true,
      backend: 'webgpu',
      features: { compute: true, 'timestamp-query': true, 'shader-f16': false },
      limits: TEST_LIMITS,
    });
    expect(Object.isFrozen(backend.capabilities)).toBe(true);

    await backend.waitForIdle();
    expect(device.queue.onSubmittedWorkDone).toHaveBeenCalledTimes(1);
  });

  it('rejects unsupported required features before requesting a device', async () => {
    const adapter = new FakeAdapter(['compute'], []);
    const backend = createWebGpuBackendForPlatform(
      { requiredFeatures: ['shader-f16'] },
      new FakePlatform(true, [adapter]),
    );

    await expect(backend.initialize()).rejects.toMatchObject({
      code: 'UNSUPPORTED_CAPABILITY',
      recoverable: true,
    });
    expect(adapter.requestDevice).not.toHaveBeenCalled();
    expect(backend.state).toBe('new');
  });

  it('wraps native adapter or device rejection without leaking it as the public error', async () => {
    const adapter = new FakeAdapter(['compute'], []);
    adapter.requestDevice.mockRejectedValueOnce(new Error('native test failure'));
    const backend = createWebGpuBackendForPlatform({}, new FakePlatform(true, [adapter]));

    await expect(backend.initialize()).rejects.toMatchObject({
      code: 'BACKEND_INITIALIZATION_FAILED',
      message: 'WebGPU adapter or device initialization failed.',
      recoverable: true,
    });
    expect(backend.state).toBe('new');
  });

  it('emits device loss, returns to lost, and can acquire a replacement device', async () => {
    const firstDevice = new FakeDevice();
    const secondDevice = new FakeDevice();
    const adapter = new FakeAdapter(['compute'], [firstDevice, secondDevice]);
    const platform = new FakePlatform(true, [adapter, adapter]);
    const backend = createWebGpuBackendForPlatform({}, platform);
    const onLost = vi.fn();
    backend.on('lost', onLost);
    await backend.initialize();
    backend.createBuffer({ size: 64, usage: ['vertex'] });
    backend.createTexture({
      format: 'rgba8unorm',
      size: { height: 4, width: 4 },
      usage: ['sampled'],
    });

    firstDevice.lose({ message: 'simulated device loss', reason: 'unknown', recoverable: true });
    await vi.waitFor(() => expect(backend.state).toBe('lost'));

    expect(onLost).toHaveBeenCalledExactlyOnceWith({
      message: 'simulated device loss',
      reason: 'unknown',
      recoverable: true,
    });
    expect(backend.getResourceStatistics()).toMatchObject({
      activeCount: 0,
      activeEstimatedBytes: 0,
      createdTotal: 2,
      destroyedTotal: 2,
    });
    expect(firstDevice.buffers[0]?.destroy).not.toHaveBeenCalled();
    expect(firstDevice.textures[0]?.destroy).not.toHaveBeenCalled();
    await backend.initialize();
    expect(backend.state).toBe('ready');
    expect(platform.requestAdapter).toHaveBeenCalledTimes(2);
    expect(adapter.requestDevice).toHaveBeenCalledTimes(2);
  });

  it('simulates Device Lost for diagnostics without exposing the native device', async () => {
    const device = new FakeDevice();
    const backend = createWebGpuBackendForPlatform(
      {},
      new FakePlatform(true, [new FakeAdapter([], [device])]),
    );
    await backend.initialize();

    backend.debugSimulateDeviceLoss();
    expect(device.destroy).toHaveBeenCalledTimes(1);
    device.lose({ message: 'diagnostic loss', reason: 'destroyed', recoverable: true });
    await vi.waitFor(() => expect(backend.state).toBe('lost'));
  });

  it('cancels in-flight initialization and ignores expected loss after idempotent disposal', async () => {
    const device = new FakeDevice();
    const adapterDeferred = new Deferred<WebGpuAdapterPort | null>();
    const platform: WebGpuPlatformPort = {
      available: true,
      requestAdapter: vi.fn(() => adapterDeferred.promise),
    };
    const backend = createWebGpuBackendForPlatform({}, platform);
    const onLost = vi.fn();
    backend.on('lost', onLost);
    const initialization = backend.initialize();

    backend.dispose();
    backend.dispose();
    adapterDeferred.resolve(new FakeAdapter(['compute'], [device]));

    await expect(initialization).rejects.toBeInstanceOf(KyxosEngineError);
    expect(backend.state).toBe('disposed');
    expect(device.destroy).not.toHaveBeenCalled();
    expect(onLost).not.toHaveBeenCalled();

    await expect(backend.initialize()).rejects.toMatchObject({ code: 'ALREADY_DISPOSED' });
  });

  it('destroys an acquired device once and suppresses its expected destroy loss', async () => {
    const device = new FakeDevice();
    const backend = createWebGpuBackendForPlatform(
      {},
      new FakePlatform(true, [new FakeAdapter(['compute'], [device])]),
    );
    const onLost = vi.fn();
    backend.on('lost', onLost);
    await backend.initialize();

    backend.dispose();
    backend.dispose();
    device.lose({ message: 'destroyed by owner', reason: 'destroyed', recoverable: true });
    await Promise.resolve();

    expect(device.destroy).toHaveBeenCalledTimes(1);
    expect(onLost).not.toHaveBeenCalled();
    expect(backend.getResourceStatistics()).toMatchObject({
      activeCount: 0,
      activeEstimatedBytes: 0,
    });
  });

  it('creates typed native resources, validates Shaders, and accounts for disposal', async () => {
    const surfacePort = new FakeSurface();
    const device = new FakeDevice([surfacePort]);
    const backend = createWebGpuBackendForPlatform(
      {},
      new FakePlatform(true, [new FakeAdapter(['compute'], [device])]),
    );
    await backend.initialize();

    const buffer = backend.createBuffer({
      label: 'vertices',
      size: 64,
      usage: ['copy-dst', 'vertex'],
    });
    const texture = backend.createTexture({
      format: 'rgba8unorm',
      mipLevelCount: 2,
      size: { height: 4, width: 4 },
      usage: ['copy-dst', 'render-attachment', 'sampled'],
    });
    backend.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    const shader = backend.createShaderModule({
      code: '@vertex fn main() -> @builtin(position) vec4f { return vec4f(); }',
      language: 'wgsl',
    });
    expect(await backend.getShaderCompilationInfo(shader)).toEqual({
      messages: [],
      valid: true,
    });
    const pipeline = await backend.createRenderPipeline({
      fragment: {
        entryPoint: 'fragmentMain',
        module: shader,
        targets: [{ format: 'bgra8unorm' }],
      },
      primitive: { cullMode: 'back', topology: 'triangle-list' },
      vertex: {
        buffers: [
          {
            arrayStride: 20,
            attributes: [
              { format: 'float32x3', offset: 0, shaderLocation: 0 },
              { format: 'float32x2', offset: 12, shaderLocation: 1 },
            ],
          },
        ],
        entryPoint: 'vertexMain',
        module: shader,
      },
    });
    const surface = backend.createSurface({
      cssHeight: 180,
      cssWidth: 320,
      devicePixelRatio: 2,
      target: { getContext: () => ({}), height: 0, width: 0 },
    });
    backend.writeBuffer(buffer, new Float32Array(16));
    backend.writeTexture(texture, new Uint8Array(4 * 4 * 4), {
      size: { height: 4, width: 4 },
    });
    const commandEncoder = backend.createCommandEncoder({ label: 'frame' });
    const frame = backend.executeFrame({
      commandEncoder,
      renderPasses: [
        {
          clearColor: { a: 1, b: 0.2, g: 0.1, r: 0.05 },
          draws: [
            {
              pipeline,
              vertexBuffers: [{ buffer, slot: 0 }],
              vertexCount: 3,
            },
          ],
          surface,
        },
      ],
    });

    expect(device.createBuffer).toHaveBeenCalledWith({
      label: 'vertices',
      size: 64,
      usage: ['copy-dst', 'vertex'],
    });
    expect(device.createRenderPipeline).toHaveBeenCalledWith(
      expect.objectContaining({
        fragment: expect.objectContaining({ module: device.shaders[0] }),
        vertex: expect.objectContaining({ module: device.shaders[0] }),
      }),
    );
    expect(device.queue.writeBuffer).toHaveBeenCalledExactlyOnceWith(
      device.buffers[0],
      0,
      expect.any(Float32Array),
    );
    expect(device.queue.writeTexture).toHaveBeenCalledExactlyOnceWith(
      {
        bytesPerRow: 16,
        mipLevel: 0,
        origin: { x: 0, y: 0, z: 0 },
        rowsPerImage: 4,
        size: { depthOrArrayLayers: 1, height: 4, width: 4 },
        texture: device.textures[0],
      },
      expect.any(Uint8Array),
    );
    expect(frame).toEqual({ drawCalls: 1, instances: 1, triangles: 1, vertices: 3 });
    expect(device.encoders[0]?.encodeRenderPass).toHaveBeenCalledWith(
      expect.objectContaining({
        draws: [expect.objectContaining({ pipeline: expect.any(Object), vertexCount: 3 })],
        surface: surfacePort,
      }),
    );
    expect(device.encoders[0]?.finish).toHaveBeenCalledTimes(1);
    expect(device.queue.submit).toHaveBeenCalledExactlyOnceWith([
      device.encoders[0]?.commandBuffer,
    ]);
    expect(backend.getResourceStatistics()).toMatchObject({
      activeCount: 6,
      byKind: {
        buffer: { activeCount: 1, activeEstimatedBytes: 64 },
        'command-encoder': { activeCount: 0 },
        pipeline: { activeCount: 1 },
        sampler: { activeCount: 1 },
        'shader-module': { activeCount: 1 },
        surface: { activeCount: 1 },
        texture: { activeCount: 1, activeEstimatedBytes: 80 },
      },
    });

    expect(backend.destroyResource(buffer)).toBe(true);
    expect(backend.destroyResource(texture)).toBe(true);
    expect(device.buffers[0]?.destroy).toHaveBeenCalledTimes(1);
    expect(device.textures[0]?.destroy).toHaveBeenCalledTimes(1);
    backend.dispose();
    expect(backend.getResourceStatistics()).toMatchObject({
      activeCount: 0,
      activeEstimatedBytes: 0,
      createdTotal: 7,
      destroyedTotal: 7,
    });
  });

  it('uploads HDR formats and creates validated cube and LUT Texture Views', async () => {
    const device = new FakeDevice();
    const backend = createWebGpuBackendForPlatform(
      {},
      new FakePlatform(true, [new FakeAdapter([], [device])]),
    );
    await backend.initialize();
    const shader = backend.createShaderModule({
      code: '@vertex fn vertexMain() -> @builtin(position) vec4f { return vec4f(); }',
      language: 'wgsl',
    });
    const pipeline = await backend.createRenderPipeline({
      vertex: { entryPoint: 'vertexMain', module: shader },
    });
    const cube = backend.createTexture({
      format: 'rgba16float',
      mipLevelCount: 2,
      size: { depthOrArrayLayers: 6, height: 2, width: 2 },
      usage: ['copy-dst', 'sampled'],
    });
    const lut = backend.createTexture({
      format: 'rg16float',
      size: { height: 2, width: 2 },
      usage: ['copy-dst', 'sampled'],
    });
    backend.writeTexture(cube, new Uint16Array(2 * 2 * 6 * 4), {
      bytesPerRow: 16,
      rowsPerImage: 2,
      size: { depthOrArrayLayers: 6, height: 2, width: 2 },
    });
    backend.writeTexture(cube, new Uint16Array(1 * 1 * 6 * 4), {
      bytesPerRow: 8,
      mipLevel: 1,
      rowsPerImage: 1,
      size: { depthOrArrayLayers: 6, height: 1, width: 1 },
    });
    backend.writeTexture(lut, new Uint16Array(2 * 2 * 2), {
      bytesPerRow: 8,
      rowsPerImage: 2,
      size: { height: 2, width: 2 },
    });
    const sampler = backend.createSampler({ minFilter: 'linear' });
    backend.createBindGroup({
      entries: [
        {
          binding: 0,
          resource: {
            texture: cube,
            view: { arrayLayerCount: 6, dimension: 'cube', mipLevelCount: 2 },
          },
        },
        { binding: 1, resource: { sampler } },
        { binding: 2, resource: { texture: lut, view: { dimension: '2d' } } },
      ],
      group: 0,
      pipeline,
    });

    expect(device.textures[0]?.createView).toHaveBeenCalledExactlyOnceWith({
      arrayLayerCount: 6,
      dimension: 'cube',
      mipLevelCount: 2,
    });
    expect(device.textures[1]?.createView).toHaveBeenCalledExactlyOnceWith({
      dimension: '2d',
    });
    expect(device.queue.writeTexture.mock.calls.map(([request]) => request.bytesPerRow)).toEqual([
      16, 8, 8,
    ]);
    expect(backend.getResourceStatistics()).toMatchObject({
      byKind: { texture: { activeCount: 2, activeEstimatedBytes: 256 } },
    });
    backend.dispose();
  });

  it('renders to one validated offscreen color subresource and rejects incompatible targets', async () => {
    const device = new FakeDevice();
    const backend = createWebGpuBackendForPlatform(
      {},
      new FakePlatform(true, [new FakeAdapter([], [device])]),
    );
    await backend.initialize();
    const shader = backend.createShaderModule({
      code: '@vertex fn vertexMain() -> @builtin(position) vec4f { return vec4f(); }',
      language: 'wgsl',
    });
    const pipeline = await backend.createRenderPipeline({
      fragment: {
        entryPoint: 'fragmentMain',
        module: shader,
        targets: [{ format: 'rgba16float' }],
      },
      vertex: { entryPoint: 'vertexMain', module: shader },
    });
    const target = backend.createTexture({
      format: 'rgba16float',
      mipLevelCount: 2,
      size: { height: 4, width: 8 },
      usage: ['render-attachment', 'sampled'],
    });
    const view = {
      arrayLayerCount: 1,
      baseArrayLayer: 0,
      baseMipLevel: 1,
      dimension: '2d' as const,
      mipLevelCount: 1,
    };

    expect(
      backend.executeFrame({
        commandEncoder: backend.createCommandEncoder(),
        renderPasses: [
          {
            clearColor: { a: 0, b: 0, g: 0, r: 0 },
            colorAttachment: { loadOp: 'load', storeOp: 'discard', texture: target, view },
            draws: [{ pipeline, vertexCount: 3 }],
          },
        ],
      }),
    ).toEqual({ drawCalls: 1, instances: 1, triangles: 1, vertices: 3 });
    expect(device.textures[0]?.createView).toHaveBeenCalledExactlyOnceWith(view);
    expect(device.encoders[0]?.encodeRenderPass).toHaveBeenCalledExactlyOnceWith({
      clearColor: { a: 0, b: 0, g: 0, r: 0 },
      colorAttachment: {
        loadOp: 'load',
        storeOp: 'discard',
        view: { kind: 'texture-view' },
      },
      depthAttachment: undefined,
      draws: [expect.objectContaining({ pipeline: expect.any(Object), vertexCount: 3 })],
      label: undefined,
    });

    const incompatible = await backend.createRenderPipeline({
      fragment: {
        entryPoint: 'fragmentMain',
        module: shader,
        targets: [{ format: 'bgra8unorm' }],
      },
      vertex: { entryPoint: 'vertexMain', module: shader },
    });
    const incompatibleEncoder = backend.createCommandEncoder();
    expect(() =>
      backend.executeFrame({
        commandEncoder: incompatibleEncoder,
        renderPasses: [
          {
            clearColor: { a: 1, b: 0, g: 0, r: 0 },
            colorAttachment: { texture: target },
            draws: [{ pipeline: incompatible, vertexCount: 3 }],
          },
        ],
      }),
    ).toThrow('color target must match');
    expect(backend.destroyResource(incompatibleEncoder)).toBe(true);

    const invalidViewEncoder = backend.createCommandEncoder();
    expect(() =>
      backend.executeFrame({
        commandEncoder: invalidViewEncoder,
        renderPasses: [
          {
            clearColor: { a: 1, b: 0, g: 0, r: 0 },
            colorAttachment: {
              texture: target,
              view: { dimension: '2d', mipLevelCount: 2 },
            },
            draws: [],
          },
        ],
      }),
    ).toThrow('one valid 2D mip');
    expect(backend.destroyResource(invalidViewEncoder)).toBe(true);
    backend.dispose();
  });

  it('records indexed Draws and rejects reads outside the bound Index Buffer range', async () => {
    const surfacePort = new FakeSurface();
    const device = new FakeDevice([surfacePort]);
    const backend = createWebGpuBackendForPlatform(
      {},
      new FakePlatform(true, [new FakeAdapter([], [device])]),
    );
    await backend.initialize();

    const shader = backend.createShaderModule({
      code: '@vertex fn vertexMain() -> @builtin(position) vec4f { return vec4f(); }',
      language: 'wgsl',
    });
    const pipeline = await backend.createRenderPipeline({
      fragment: {
        entryPoint: 'fragmentMain',
        module: shader,
        targets: [{ format: 'bgra8unorm' }],
      },
      primitive: { topology: 'triangle-list' },
      vertex: { entryPoint: 'vertexMain', module: shader },
    });
    const surface = backend.createSurface({
      cssHeight: 180,
      cssWidth: 320,
      devicePixelRatio: 1,
      target: { getContext: () => ({}), height: 0, width: 0 },
    });
    const vertexBuffer = backend.createBuffer({ size: 48, usage: ['copy-dst', 'vertex'] });
    const indexBuffer = backend.createBuffer({ size: 16, usage: ['copy-dst', 'index'] });
    backend.writeBuffer(indexBuffer, new Uint16Array([0, 1, 2, 2, 3, 0, 0, 0]));

    const frame = backend.executeFrame({
      commandEncoder: backend.createCommandEncoder(),
      renderPasses: [
        {
          clearColor: { a: 1, b: 0, g: 0, r: 0 },
          draws: [
            {
              indexBuffer: { buffer: indexBuffer, format: 'uint16', size: 12 },
              indexCount: 6,
              instanceCount: 2,
              pipeline,
              vertexBuffers: [{ buffer: vertexBuffer, slot: 0 }],
            },
          ],
          surface,
        },
      ],
    });

    expect(frame).toEqual({ drawCalls: 1, instances: 2, triangles: 4, vertices: 12 });
    expect(device.encoders[0]?.encodeRenderPass).toHaveBeenCalledWith(
      expect.objectContaining({
        draws: [
          expect.objectContaining({
            indexBuffer: expect.objectContaining({ buffer: device.buffers[1], size: 12 }),
            indexCount: 6,
            instanceCount: 2,
          }),
        ],
      }),
    );

    const invalidEncoder = backend.createCommandEncoder();
    expect(() =>
      backend.executeFrame({
        commandEncoder: invalidEncoder,
        renderPasses: [
          {
            clearColor: { a: 1, b: 0, g: 0, r: 0 },
            draws: [
              {
                firstIndex: 5,
                indexBuffer: { buffer: indexBuffer, format: 'uint16', size: 12 },
                indexCount: 2,
                pipeline,
              },
            ],
            surface,
          },
        ],
      }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    expect(device.queue.submit).toHaveBeenCalledTimes(1);
    expect(backend.destroyResource(invalidEncoder)).toBe(true);
    backend.dispose();
  });

  it('submits Bind Groups, depth attachments, and blend state without exposing native objects', async () => {
    const surfacePort = new FakeSurface();
    const device = new FakeDevice([surfacePort]);
    const backend = createWebGpuBackendForPlatform(
      {},
      new FakePlatform(true, [new FakeAdapter([], [device])]),
    );
    await backend.initialize();

    const shader = backend.createShaderModule({
      code: '@vertex fn vertexMain() -> @builtin(position) vec4f { return vec4f(); }',
      language: 'wgsl',
    });
    const pipeline = await backend.createRenderPipeline({
      depthStencil: {
        depthCompare: 'less',
        depthWriteEnabled: false,
        format: 'depth24plus',
      },
      fragment: {
        entryPoint: 'fragmentMain',
        module: shader,
        targets: [
          {
            blend: {
              alpha: { dstFactor: 'one-minus-src-alpha', srcFactor: 'one' },
              color: { dstFactor: 'one-minus-src-alpha', srcFactor: 'src-alpha' },
            },
            format: 'bgra8unorm',
          },
        ],
      },
      vertex: { entryPoint: 'vertexMain', module: shader },
    });
    const uniform = backend.createBuffer({
      size: 144,
      usage: ['copy-dst', 'uniform'],
    });
    const sampled = backend.createTexture({
      format: 'rgba8unorm',
      size: { height: 1, width: 1 },
      usage: ['copy-dst', 'sampled'],
    });
    backend.writeTexture(sampled, new Uint8Array([255, 255, 255, 255]), {
      size: { height: 1, width: 1 },
    });
    expect(() =>
      backend.writeTexture(sampled, new Uint8Array(3), {
        size: { height: 1, width: 1 },
      }),
    ).toThrow('data is too small');
    const sampler = backend.createSampler({ minFilter: 'linear' });
    expect(() =>
      backend.createBindGroup({
        entries: [
          {
            binding: 0,
            resource: { sampler, texture: sampled } as unknown as BackendBindGroupResource,
          },
        ],
        group: 0,
        pipeline,
      }),
    ).toThrow('exactly one');
    const bindGroup = backend.createBindGroup({
      entries: [
        { binding: 0, resource: { buffer: uniform, size: 144 } },
        { binding: 1, resource: { texture: sampled } },
        { binding: 2, resource: { sampler } },
      ],
      group: 0,
      pipeline,
    });
    const surface = backend.createSurface({
      cssHeight: 180,
      cssWidth: 320,
      devicePixelRatio: 1,
      target: { getContext: () => ({}), height: 0, width: 0 },
    });
    const depth = backend.createTexture({
      format: 'depth24plus',
      size: { height: 180, width: 320 },
      usage: ['render-attachment'],
    });

    const statistics = backend.executeFrame({
      commandEncoder: backend.createCommandEncoder(),
      renderPasses: [
        {
          clearColor: { a: 1, b: 0, g: 0, r: 0 },
          depthAttachment: { texture: depth },
          draws: [
            {
              bindGroups: [{ bindGroup, group: 0 }],
              pipeline,
              vertexCount: 3,
            },
          ],
          surface,
        },
      ],
    });

    expect(statistics).toEqual({ drawCalls: 1, instances: 1, triangles: 1, vertices: 3 });
    expect(device.createRenderPipeline).toHaveBeenCalledWith(
      expect.objectContaining({
        depthStencil: {
          depthCompare: 'less',
          depthWriteEnabled: false,
          format: 'depth24plus',
        },
        fragment: expect.objectContaining({
          targets: [expect.objectContaining({ blend: expect.any(Object) })],
        }),
      }),
    );
    expect(device.createBindGroup).toHaveBeenCalledWith({
      entries: [
        { binding: 0, buffer: device.buffers[0], kind: 'buffer', offset: 0, size: 144 },
        { binding: 1, kind: 'texture', view: expect.any(Object) },
        { binding: 2, kind: 'sampler', sampler: device.samplers[0] },
      ],
      group: 0,
      label: undefined,
      pipeline: expect.any(Object),
    });
    expect(device.encoders[0]?.encodeRenderPass).toHaveBeenCalledWith(
      expect.objectContaining({
        depthAttachment: expect.objectContaining({ clearValue: 1 }),
        draws: [
          expect.objectContaining({
            bindGroups: [{ bindGroup: expect.any(FakeBindGroup), group: 0 }],
          }),
        ],
      }),
    );
    expect(device.textures[0]?.createView).toHaveBeenCalledTimes(1);
    expect(device.textures[1]?.createView).toHaveBeenCalledTimes(1);

    const missingDepthEncoder = backend.createCommandEncoder();
    expect(() =>
      backend.executeFrame({
        commandEncoder: missingDepthEncoder,
        renderPasses: [
          {
            clearColor: { a: 1, b: 0, g: 0, r: 0 },
            draws: [{ bindGroups: [{ bindGroup, group: 0 }], pipeline, vertexCount: 3 }],
            surface,
          },
        ],
      }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    expect(backend.destroyResource(missingDepthEncoder)).toBe(true);

    expect(() =>
      backend.createBindGroup({
        entries: [
          {
            binding: 0,
            resource: {
              buffer: backend.createBuffer({ size: 16, usage: ['vertex'] }),
            },
          },
        ],
        group: 0,
        pipeline,
      }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    backend.dispose();
  });

  it('rejects invalid typed resource descriptors and foreign Shader handles', async () => {
    const firstDevice = new FakeDevice();
    const secondDevice = new FakeDevice();
    const first = createWebGpuBackendForPlatform(
      {},
      new FakePlatform(true, [new FakeAdapter(['compute'], [firstDevice])]),
    );
    const second = createWebGpuBackendForPlatform(
      {},
      new FakePlatform(true, [new FakeAdapter(['compute'], [secondDevice])]),
    );
    await Promise.all([first.initialize(), second.initialize()]);

    expect(() => first.createBuffer({ size: 0, usage: ['vertex'] })).toThrow(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    );
    expect(() =>
      first.createTexture({
        format: 'rgba8unorm',
        size: { height: 32_768, width: 32_768 },
        usage: ['sampled'],
      }),
    ).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_CAPABILITY' }));
    expect(() => first.createSampler({ maxAnisotropy: 17 })).toThrow(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    );
    expect(() => first.createShaderModule({ code: '   ', language: 'wgsl' })).toThrow(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    );

    const foreignShader = second.createShaderModule({
      code: '@vertex fn main() -> @builtin(position) vec4f { return vec4f(); }',
      language: 'wgsl',
    });
    await expect(
      first.createRenderPipeline({
        vertex: { entryPoint: 'main', module: foreignShader },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(first.getResourceStatistics().activeCount).toBe(0);
  });

  it('owns surface configure, Resize, DPR, suspension, and disposal', async () => {
    const surface = new FakeSurface();
    const device = new FakeDevice([surface]);
    const backend = createWebGpuBackendForPlatform(
      {},
      new FakePlatform(true, [new FakeAdapter(['compute'], [device])]),
    );
    const target = { height: 0, width: 0, getContext: vi.fn(() => ({})) };
    await backend.initialize();

    const handle = backend.createSurface({
      alphaMode: 'premultiplied',
      colorSpace: 'display-p3',
      cssHeight: 180,
      cssWidth: 320,
      devicePixelRatio: 2,
      label: 'primary',
      target,
    });

    expect(device.createSurface).toHaveBeenCalledExactlyOnceWith({
      alphaMode: 'premultiplied',
      colorSpace: 'display-p3',
      label: 'primary',
      target,
    });
    expect(surface.configure).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        physicalHeight: 360,
        physicalWidth: 640,
        suspended: false,
      }),
    );
    expect(backend.getSurfaceInfo(handle)).toMatchObject({
      format: 'bgra8unorm',
      size: { physicalHeight: 360, physicalWidth: 640 },
    });
    expect(backend.getResourceStatistics().byKind.surface.activeCount).toBe(1);

    expect(
      backend.resizeSurface(handle, {
        cssHeight: 0,
        cssWidth: 640,
        devicePixelRatio: 1.5,
      }),
    ).toMatchObject({
      size: { physicalHeight: 0, physicalWidth: 0, suspended: true },
    });
    expect(surface.configure).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ suspended: true }),
    );

    expect(backend.destroyResource(handle)).toBe(true);
    expect(backend.destroyResource(handle)).toBe(false);
    expect(surface.unconfigure).toHaveBeenCalledTimes(1);
    expect(backend.getResourceStatistics().byKind.surface.activeCount).toBe(0);
  });

  it('keeps multiple Canvas surfaces independent and invalidates them on device loss', async () => {
    const firstSurface = new FakeSurface();
    const secondSurface = new FakeSurface();
    const device = new FakeDevice([firstSurface, secondSurface]);
    const backend = createWebGpuBackendForPlatform(
      {},
      new FakePlatform(true, [new FakeAdapter(['compute'], [device])]),
    );
    await backend.initialize();
    const target = () => ({ height: 0, width: 0, getContext: vi.fn(() => ({})) });
    const first = backend.createSurface({
      cssHeight: 100,
      cssWidth: 100,
      devicePixelRatio: 1,
      target: target(),
    });
    backend.createSurface({
      cssHeight: 200,
      cssWidth: 300,
      devicePixelRatio: 2,
      target: target(),
    });

    expect(firstSurface.configure).toHaveBeenCalledWith(
      expect.objectContaining({ physicalHeight: 100, physicalWidth: 100 }),
    );
    expect(secondSurface.configure).toHaveBeenCalledWith(
      expect.objectContaining({ physicalHeight: 400, physicalWidth: 600 }),
    );
    expect(backend.getResourceStatistics().byKind.surface.activeCount).toBe(2);

    device.lose({ message: 'surface device lost', reason: 'unknown', recoverable: true });
    await vi.waitFor(() => expect(backend.state).toBe('lost'));
    expect(backend.getResourceStatistics().byKind.surface.activeCount).toBe(0);
    expect(firstSurface.unconfigure).not.toHaveBeenCalled();
    expect(secondSurface.unconfigure).not.toHaveBeenCalled();
    expect(() => backend.getSurfaceInfo(first)).toThrow(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    );
  });
});
