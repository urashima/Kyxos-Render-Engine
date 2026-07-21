import type { BackendFeature, BackendLimits, BackendLossInfo } from '@kyxos/render-backend-api';
import { KyxosEngineError } from '@kyxos/render-core';
import { describe, expect, it, vi } from 'vitest';

import { createWebGpuBackendForPlatform } from '../src/backend.js';
import type {
  WebGpuAdapterPort,
  WebGpuDevicePort,
  WebGpuDeviceRequest,
  WebGpuPlatformPort,
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

class FakeDevice implements WebGpuDevicePort {
  readonly #loss = new Deferred<BackendLossInfo>();
  readonly destroy = vi.fn();
  readonly lost = this.#loss.promise;

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
});
