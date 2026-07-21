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
    const context = { configure: vi.fn(), unconfigure: vi.fn() };
    const queue = { onSubmittedWorkDone: vi.fn(() => Promise.resolve()) };
    const nativeDevice = {
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
