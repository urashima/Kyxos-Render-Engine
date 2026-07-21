import type {
  BackendFeature,
  BackendLimits,
  BackendLossInfo,
  BackendSurfaceSize,
} from '@kyxos/render-backend-api';
import { KyxosEngineError } from '@kyxos/render-core';
import { describe, expect, it, vi } from 'vitest';

import { createWebGpuBackendForPlatform } from '../src/backend.js';
import type {
  WebGpuAdapterPort,
  WebGpuBufferPort,
  WebGpuCommandEncoderPort,
  WebGpuDevicePort,
  WebGpuDeviceRequest,
  WebGpuPipelinePort,
  WebGpuPlatformPort,
  WebGpuRenderPipelineRequest,
  WebGpuSamplerPort,
  WebGpuShaderModulePort,
  WebGpuSurfacePort,
  WebGpuSurfaceRequest,
  WebGpuTexturePort,
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
  readonly destroy = vi.fn();
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

class FakeDevice implements WebGpuDevicePort {
  readonly #loss = new Deferred<BackendLossInfo>();
  readonly destroy = vi.fn();
  readonly lost = this.#loss.promise;
  readonly queue = Object.freeze({
    onSubmittedWorkDone: vi.fn(() => Promise.resolve()),
  });
  readonly createSurface = vi.fn<(request: WebGpuSurfaceRequest) => WebGpuSurfacePort>();
  readonly buffers: FakeBuffer[] = [];
  readonly textures: FakeTexture[] = [];
  readonly shaders: FakeShaderModule[] = [];
  readonly createBuffer = vi.fn<
    (descriptor: Parameters<WebGpuDevicePort['createBuffer']>[0]) => WebGpuBufferPort
  >(() => {
    const buffer = new FakeBuffer();
    this.buffers.push(buffer);
    return buffer;
  });
  readonly createTexture = vi.fn<
    (descriptor: Parameters<WebGpuDevicePort['createTexture']>[0]) => WebGpuTexturePort
  >(() => {
    const texture = new FakeTexture();
    this.textures.push(texture);
    return texture;
  });
  readonly createSampler = vi.fn<
    (descriptor: Parameters<WebGpuDevicePort['createSampler']>[0]) => WebGpuSamplerPort
  >(() => ({ kind: 'sampler' }));
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
  >(() => ({ kind: 'command-encoder' }));

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
    const device = new FakeDevice();
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
      usage: ['render-attachment', 'sampled'],
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
    await backend.createRenderPipeline({
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
    backend.createCommandEncoder({ label: 'frame' });

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
    expect(backend.getResourceStatistics()).toMatchObject({
      activeCount: 6,
      byKind: {
        buffer: { activeCount: 1, activeEstimatedBytes: 64 },
        'command-encoder': { activeCount: 1 },
        pipeline: { activeCount: 1 },
        sampler: { activeCount: 1 },
        'shader-module': { activeCount: 1 },
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
      createdTotal: 6,
      destroyedTotal: 6,
    });
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
