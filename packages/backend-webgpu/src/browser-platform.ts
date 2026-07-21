import {
  BACKEND_FEATURES,
  type BackendFeature,
  type BackendLimits,
} from '@kyxos/render-backend-api';

import type {
  WebGpuAdapterPort,
  WebGpuAdapterRequest,
  WebGpuDevicePort,
  WebGpuDeviceRequest,
  WebGpuPlatformPort,
} from './platform.js';

type OptionalWebGpuFeature = Exclude<BackendFeature, 'compute'>;

const OPTIONAL_WEBGPU_FEATURES = BACKEND_FEATURES.filter(
  (feature): feature is OptionalWebGpuFeature => feature !== 'compute',
);

function readLimits(limits: GPUSupportedLimits): BackendLimits {
  return Object.freeze({
    maxBindGroups: limits.maxBindGroups,
    maxColorAttachments: limits.maxColorAttachments,
    maxSampledTexturesPerShaderStage: limits.maxSampledTexturesPerShaderStage,
    maxStorageBufferBindingSize: limits.maxStorageBufferBindingSize,
    maxTextureDimension2D: limits.maxTextureDimension2D,
    maxUniformBufferBindingSize: limits.maxUniformBufferBindingSize,
  });
}

function readFeatures(features: GPUSupportedFeatures): ReadonlySet<BackendFeature> {
  return new Set<BackendFeature>([
    'compute',
    ...OPTIONAL_WEBGPU_FEATURES.filter((feature) => features.has(feature)),
  ]);
}

class BrowserWebGpuDevice implements WebGpuDevicePort {
  readonly #device: GPUDevice;
  readonly lost: Promise<{
    readonly message: string;
    readonly reason: 'destroyed' | 'unknown';
    readonly recoverable: boolean;
  }>;

  constructor(device: GPUDevice) {
    this.#device = device;
    this.lost = device.lost.then((info) =>
      Object.freeze({
        message: info.message || 'WebGPU device lost.',
        reason: info.reason === 'destroyed' ? 'destroyed' : 'unknown',
        recoverable: true,
      }),
    );
  }

  destroy(): void {
    this.#device.destroy();
  }
}

class BrowserWebGpuAdapter implements WebGpuAdapterPort {
  readonly #adapter: GPUAdapter;
  readonly features: ReadonlySet<BackendFeature>;
  readonly limits: BackendLimits;

  constructor(adapter: GPUAdapter) {
    this.#adapter = adapter;
    this.features = readFeatures(adapter.features);
    this.limits = readLimits(adapter.limits);
  }

  async requestDevice(request: WebGpuDeviceRequest): Promise<WebGpuDevicePort> {
    const requiredFeatures = request.requiredFeatures.filter(
      (feature): feature is OptionalWebGpuFeature => feature !== 'compute',
    );
    const descriptor: GPUDeviceDescriptor = {
      requiredFeatures,
      ...(request.label === undefined ? {} : { label: request.label }),
    };
    return new BrowserWebGpuDevice(await this.#adapter.requestDevice(descriptor));
  }
}

class BrowserWebGpuPlatform implements WebGpuPlatformPort {
  get available(): boolean {
    return typeof navigator !== 'undefined' && navigator.gpu !== undefined;
  }

  async requestAdapter(request: WebGpuAdapterRequest): Promise<WebGpuAdapterPort | null> {
    if (!this.available) {
      return null;
    }

    const options: GPURequestAdapterOptions = {
      forceFallbackAdapter: request.forceFallbackAdapter,
      ...(request.powerPreference === undefined
        ? {}
        : { powerPreference: request.powerPreference }),
    };
    const adapter = await navigator.gpu.requestAdapter(options);
    return adapter === null ? null : new BrowserWebGpuAdapter(adapter);
  }
}

export function createBrowserWebGpuPlatform(): WebGpuPlatformPort {
  return new BrowserWebGpuPlatform();
}
