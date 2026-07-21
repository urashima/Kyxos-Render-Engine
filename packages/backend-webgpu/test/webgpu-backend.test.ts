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
  WebGpuDevicePort,
  WebGpuDeviceRequest,
  WebGpuPlatformPort,
  WebGpuSurfacePort,
  WebGpuSurfaceRequest,
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

class FakeDevice implements WebGpuDevicePort {
  readonly #loss = new Deferred<BackendLossInfo>();
  readonly destroy = vi.fn();
  readonly lost = this.#loss.promise;
  readonly queue = Object.freeze({
    onSubmittedWorkDone: vi.fn(() => Promise.resolve()),
  });
  readonly createSurface = vi.fn<(request: WebGpuSurfaceRequest) => WebGpuSurfacePort>();

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

    firstDevice.lose({ message: 'simulated device loss', reason: 'unknown', recoverable: true });
    await vi.waitFor(() => expect(backend.state).toBe('lost'));

    expect(onLost).toHaveBeenCalledExactlyOnceWith({
      message: 'simulated device loss',
      reason: 'unknown',
      recoverable: true,
    });
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
