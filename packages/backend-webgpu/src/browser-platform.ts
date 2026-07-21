import {
  BACKEND_FEATURES,
  type BackendBufferDescriptor,
  type BackendBufferUsage,
  type BackendCommandEncoderDescriptor,
  type BackendFeature,
  type BackendLimits,
  type BackendSamplerDescriptor,
  type BackendShaderCompilationInfo,
  type BackendShaderModuleDescriptor,
  type BackendTextureDescriptor,
  type BackendTextureUsage,
} from '@kyxos/render-backend-api';

import type {
  WebGpuAdapterPort,
  WebGpuAdapterRequest,
  WebGpuBufferPort,
  WebGpuCommandEncoderPort,
  WebGpuDevicePort,
  WebGpuDeviceRequest,
  WebGpuPipelinePort,
  WebGpuPlatformPort,
  WebGpuQueuePort,
  WebGpuRenderPipelineRequest,
  WebGpuSamplerPort,
  WebGpuShaderModulePort,
  WebGpuSurfacePort,
  WebGpuSurfaceRequest,
  WebGpuTexturePort,
} from './platform.js';

type OptionalWebGpuFeature = Exclude<BackendFeature, 'compute'>;

const OPTIONAL_WEBGPU_FEATURES = BACKEND_FEATURES.filter(
  (feature): feature is OptionalWebGpuFeature => feature !== 'compute',
);

const BUFFER_USAGE_FLAGS: Readonly<Record<BackendBufferUsage, GPUFlagsConstant>> = {
  'copy-dst': 0x0008,
  'copy-src': 0x0004,
  index: 0x0010,
  indirect: 0x0100,
  'map-read': 0x0001,
  'map-write': 0x0002,
  'query-resolve': 0x0200,
  storage: 0x0080,
  uniform: 0x0040,
  vertex: 0x0020,
};

const TEXTURE_USAGE_FLAGS: Readonly<Record<BackendTextureUsage, GPUFlagsConstant>> = {
  'copy-dst': 0x02,
  'copy-src': 0x01,
  'render-attachment': 0x10,
  sampled: 0x04,
  storage: 0x08,
};

function combineFlags<Usage extends string>(
  usages: readonly Usage[],
  flags: Readonly<Record<Usage, GPUFlagsConstant>>,
): GPUFlagsConstant {
  return usages.reduce((combined, usage) => combined | flags[usage], 0);
}

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

function preferredSurfaceFormat(): 'bgra8unorm' | 'rgba8unorm' {
  const format = navigator.gpu.getPreferredCanvasFormat();
  if (format !== 'bgra8unorm' && format !== 'rgba8unorm') {
    throw new Error(`Unsupported preferred WebGPU Canvas format: ${format}.`);
  }
  return format;
}

function requireCanvasContext(value: unknown): GPUCanvasContext {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('configure' in value) ||
    typeof value.configure !== 'function' ||
    !('unconfigure' in value) ||
    typeof value.unconfigure !== 'function'
  ) {
    throw new Error('Canvas did not provide a WebGPU context.');
  }
  return value as GPUCanvasContext;
}

class BrowserWebGpuSurface implements WebGpuSurfacePort {
  readonly #context: GPUCanvasContext;
  readonly #device: GPUDevice;
  readonly #request: WebGpuSurfaceRequest;
  readonly format: 'bgra8unorm' | 'rgba8unorm';

  constructor(device: GPUDevice, request: WebGpuSurfaceRequest) {
    this.#device = device;
    this.#request = request;
    this.#context = requireCanvasContext(request.target.getContext('webgpu'));
    this.format = preferredSurfaceFormat();
  }

  configure(size: Parameters<WebGpuSurfacePort['configure']>[0]): void {
    this.#request.target.width = size.physicalWidth;
    this.#request.target.height = size.physicalHeight;
    if (size.suspended) {
      this.#context.unconfigure();
      return;
    }
    this.#context.configure({
      alphaMode: this.#request.alphaMode,
      colorSpace: this.#request.colorSpace,
      device: this.#device,
      format: this.format,
    });
  }

  unconfigure(): void {
    this.#context.unconfigure();
  }
}

class BrowserWebGpuBuffer implements WebGpuBufferPort {
  readonly #buffer: GPUBuffer;

  constructor(buffer: GPUBuffer) {
    this.#buffer = buffer;
  }

  destroy(): void {
    this.#buffer.destroy();
  }
}

class BrowserWebGpuTexture implements WebGpuTexturePort {
  readonly #texture: GPUTexture;

  constructor(texture: GPUTexture) {
    this.#texture = texture;
  }

  destroy(): void {
    this.#texture.destroy();
  }
}

class BrowserWebGpuSampler implements WebGpuSamplerPort {
  readonly kind = 'sampler' as const;
  readonly native: GPUSampler;

  constructor(sampler: GPUSampler) {
    this.native = sampler;
  }
}

class BrowserWebGpuShaderModule implements WebGpuShaderModulePort {
  readonly native: GPUShaderModule;

  constructor(module: GPUShaderModule) {
    this.native = module;
  }

  async getCompilationInfo(): Promise<BackendShaderCompilationInfo> {
    const info = await this.native.getCompilationInfo();
    const messages = info.messages.map((message) =>
      Object.freeze({
        length: message.length,
        lineNumber: message.lineNum,
        linePosition: message.linePos,
        message: message.message,
        offset: message.offset,
        type: message.type,
      }),
    );
    return Object.freeze({
      messages: Object.freeze(messages),
      valid: !messages.some((message) => message.type === 'error'),
    });
  }
}

class BrowserWebGpuPipeline implements WebGpuPipelinePort {
  readonly kind = 'pipeline' as const;
  readonly native: GPURenderPipeline;

  constructor(pipeline: GPURenderPipeline) {
    this.native = pipeline;
  }
}

class BrowserWebGpuCommandEncoder implements WebGpuCommandEncoderPort {
  readonly kind = 'command-encoder' as const;
  readonly native: GPUCommandEncoder;

  constructor(encoder: GPUCommandEncoder) {
    this.native = encoder;
  }
}

function requireBrowserShaderModule(module: WebGpuShaderModulePort): GPUShaderModule {
  if (!(module instanceof BrowserWebGpuShaderModule)) {
    throw new Error('Render pipeline Shader Module belongs to another WebGPU device port.');
  }
  return module.native;
}

class BrowserWebGpuDevice implements WebGpuDevicePort {
  readonly #device: GPUDevice;
  readonly lost: Promise<{
    readonly message: string;
    readonly reason: 'destroyed' | 'unknown';
    readonly recoverable: boolean;
  }>;
  readonly queue: WebGpuQueuePort;

  constructor(device: GPUDevice) {
    this.#device = device;
    this.queue = Object.freeze({
      onSubmittedWorkDone: () => device.queue.onSubmittedWorkDone(),
    });
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

  createBuffer(descriptor: BackendBufferDescriptor): WebGpuBufferPort {
    return new BrowserWebGpuBuffer(
      this.#device.createBuffer({
        mappedAtCreation: descriptor.mappedAtCreation ?? false,
        size: descriptor.size,
        usage: combineFlags(descriptor.usage, BUFFER_USAGE_FLAGS),
        ...(descriptor.label === undefined ? {} : { label: descriptor.label }),
      }),
    );
  }

  createTexture(descriptor: BackendTextureDescriptor): WebGpuTexturePort {
    return new BrowserWebGpuTexture(
      this.#device.createTexture({
        dimension: '2d',
        format: descriptor.format,
        mipLevelCount: descriptor.mipLevelCount ?? 1,
        sampleCount: descriptor.sampleCount ?? 1,
        size: {
          depthOrArrayLayers: descriptor.size.depthOrArrayLayers ?? 1,
          height: descriptor.size.height,
          width: descriptor.size.width,
        },
        usage: combineFlags(descriptor.usage, TEXTURE_USAGE_FLAGS),
        ...(descriptor.label === undefined ? {} : { label: descriptor.label }),
      }),
    );
  }

  createSampler(descriptor: BackendSamplerDescriptor): WebGpuSamplerPort {
    return new BrowserWebGpuSampler(
      this.#device.createSampler({
        ...(descriptor.addressModeU === undefined ? {} : { addressModeU: descriptor.addressModeU }),
        ...(descriptor.addressModeV === undefined ? {} : { addressModeV: descriptor.addressModeV }),
        ...(descriptor.addressModeW === undefined ? {} : { addressModeW: descriptor.addressModeW }),
        ...(descriptor.label === undefined ? {} : { label: descriptor.label }),
        ...(descriptor.magFilter === undefined ? {} : { magFilter: descriptor.magFilter }),
        ...(descriptor.maxAnisotropy === undefined
          ? {}
          : { maxAnisotropy: descriptor.maxAnisotropy }),
        ...(descriptor.minFilter === undefined ? {} : { minFilter: descriptor.minFilter }),
        ...(descriptor.mipmapFilter === undefined ? {} : { mipmapFilter: descriptor.mipmapFilter }),
      }),
    );
  }

  createShaderModule(descriptor: BackendShaderModuleDescriptor): WebGpuShaderModulePort {
    return new BrowserWebGpuShaderModule(
      this.#device.createShaderModule({
        code: descriptor.code,
        ...(descriptor.label === undefined ? {} : { label: descriptor.label }),
      }),
    );
  }

  async createRenderPipeline(request: WebGpuRenderPipelineRequest): Promise<WebGpuPipelinePort> {
    const primitive: GPUPrimitiveState = {
      ...(request.primitive?.cullMode === undefined
        ? {}
        : { cullMode: request.primitive.cullMode }),
      ...(request.primitive?.frontFace === undefined
        ? {}
        : { frontFace: request.primitive.frontFace }),
      ...(request.primitive?.topology === undefined
        ? {}
        : { topology: request.primitive.topology }),
    };
    const descriptor: GPURenderPipelineDescriptor = {
      layout: 'auto',
      primitive,
      vertex: {
        buffers: request.vertex.buffers.map((buffer) => ({
          arrayStride: buffer.arrayStride,
          attributes: buffer.attributes.map((attribute) => ({ ...attribute })),
          stepMode: buffer.stepMode ?? 'vertex',
        })),
        entryPoint: request.vertex.entryPoint,
        module: requireBrowserShaderModule(request.vertex.module),
      },
      ...(request.fragment === undefined
        ? {}
        : {
            fragment: {
              entryPoint: request.fragment.entryPoint,
              module: requireBrowserShaderModule(request.fragment.module),
              targets: request.fragment.targets.map((target) => ({ format: target.format })),
            },
          }),
      ...(request.label === undefined ? {} : { label: request.label }),
    };
    return new BrowserWebGpuPipeline(await this.#device.createRenderPipelineAsync(descriptor));
  }

  createCommandEncoder(descriptor: BackendCommandEncoderDescriptor): WebGpuCommandEncoderPort {
    return new BrowserWebGpuCommandEncoder(
      this.#device.createCommandEncoder(
        descriptor.label === undefined ? {} : { label: descriptor.label },
      ),
    );
  }

  createSurface(request: WebGpuSurfaceRequest): WebGpuSurfacePort {
    return new BrowserWebGpuSurface(this.#device, request);
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
