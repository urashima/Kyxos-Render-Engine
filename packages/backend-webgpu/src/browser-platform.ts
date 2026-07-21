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
  WebGpuBindGroupPort,
  WebGpuBindGroupRequest,
  WebGpuBufferPort,
  WebGpuCommandBufferPort,
  WebGpuCommandEncoderPort,
  WebGpuDevicePort,
  WebGpuDeviceRequest,
  WebGpuPipelinePort,
  WebGpuPlatformPort,
  WebGpuQueuePort,
  WebGpuRenderPassRequest,
  WebGpuRenderPipelineRequest,
  WebGpuSamplerPort,
  WebGpuShaderModulePort,
  WebGpuSurfacePort,
  WebGpuSurfaceRequest,
  WebGpuTexturePort,
  WebGpuTextureViewPort,
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

  createCurrentTextureView(): GPUTextureView {
    return this.#context.getCurrentTexture().createView();
  }
}

class BrowserWebGpuBuffer implements WebGpuBufferPort {
  readonly native: GPUBuffer;

  constructor(buffer: GPUBuffer) {
    this.native = buffer;
  }

  destroy(): void {
    this.native.destroy();
  }
}

class BrowserWebGpuTexture implements WebGpuTexturePort {
  readonly #texture: GPUTexture;

  constructor(texture: GPUTexture) {
    this.#texture = texture;
  }

  createView(): WebGpuTextureViewPort {
    return new BrowserWebGpuTextureView(this.#texture.createView());
  }

  destroy(): void {
    this.#texture.destroy();
  }
}

class BrowserWebGpuTextureView implements WebGpuTextureViewPort {
  readonly kind = 'texture-view' as const;
  readonly native: GPUTextureView;

  constructor(view: GPUTextureView) {
    this.native = view;
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

class BrowserWebGpuBindGroup implements WebGpuBindGroupPort {
  readonly kind = 'bind-group' as const;
  readonly native: GPUBindGroup;

  constructor(bindGroup: GPUBindGroup) {
    this.native = bindGroup;
  }
}

class BrowserWebGpuCommandEncoder implements WebGpuCommandEncoderPort {
  readonly kind = 'command-encoder' as const;
  readonly native: GPUCommandEncoder;

  constructor(encoder: GPUCommandEncoder) {
    this.native = encoder;
  }

  encodeRenderPass(request: WebGpuRenderPassRequest): void {
    if (!(request.surface instanceof BrowserWebGpuSurface)) {
      throw new Error('Render Pass Surface belongs to another WebGPU device port.');
    }
    let depthStencilAttachment: GPURenderPassDepthStencilAttachment | undefined;
    if (request.depthAttachment !== undefined) {
      if (!(request.depthAttachment.view instanceof BrowserWebGpuTextureView)) {
        throw new Error('Render Pass depth Texture belongs to another WebGPU device port.');
      }
      depthStencilAttachment = {
        depthClearValue: request.depthAttachment.clearValue,
        depthLoadOp: request.depthAttachment.loadOp,
        depthStoreOp: request.depthAttachment.storeOp,
        view: request.depthAttachment.view.native,
      };
    }
    const pass = this.native.beginRenderPass({
      colorAttachments: [
        {
          clearValue: request.clearColor,
          loadOp: 'clear',
          storeOp: 'store',
          view: request.surface.createCurrentTextureView(),
        },
      ],
      ...(depthStencilAttachment === undefined ? {} : { depthStencilAttachment }),
      ...(request.label === undefined ? {} : { label: request.label }),
    });
    try {
      for (const draw of request.draws) {
        if (!(draw.pipeline instanceof BrowserWebGpuPipeline)) {
          throw new Error('Draw Pipeline belongs to another WebGPU device port.');
        }
        pass.setPipeline(draw.pipeline.native);
        for (const binding of draw.bindGroups) {
          if (!(binding.bindGroup instanceof BrowserWebGpuBindGroup)) {
            throw new Error('Draw Bind Group belongs to another WebGPU device port.');
          }
          pass.setBindGroup(binding.group, binding.bindGroup.native);
        }
        for (const vertexBuffer of draw.vertexBuffers) {
          if (!(vertexBuffer.buffer instanceof BrowserWebGpuBuffer)) {
            throw new Error('Vertex Buffer belongs to another WebGPU device port.');
          }
          if (vertexBuffer.size === undefined) {
            pass.setVertexBuffer(
              vertexBuffer.slot,
              vertexBuffer.buffer.native,
              vertexBuffer.offset,
            );
          } else {
            pass.setVertexBuffer(
              vertexBuffer.slot,
              vertexBuffer.buffer.native,
              vertexBuffer.offset,
              vertexBuffer.size,
            );
          }
        }
        if (draw.indexBuffer === undefined) {
          pass.draw(
            draw.vertexCount ?? 0,
            draw.instanceCount,
            draw.firstVertex,
            draw.firstInstance,
          );
          continue;
        }
        if (!(draw.indexBuffer.buffer instanceof BrowserWebGpuBuffer)) {
          throw new Error('Index Buffer belongs to another WebGPU device port.');
        }
        if (draw.indexBuffer.size === undefined) {
          pass.setIndexBuffer(
            draw.indexBuffer.buffer.native,
            draw.indexBuffer.format,
            draw.indexBuffer.offset,
          );
        } else {
          pass.setIndexBuffer(
            draw.indexBuffer.buffer.native,
            draw.indexBuffer.format,
            draw.indexBuffer.offset,
            draw.indexBuffer.size,
          );
        }
        pass.drawIndexed(
          draw.indexCount ?? 0,
          draw.instanceCount,
          draw.firstIndex,
          0,
          draw.firstInstance,
        );
      }
    } finally {
      pass.end();
    }
  }

  finish(): WebGpuCommandBufferPort {
    return new BrowserWebGpuCommandBuffer(this.native.finish());
  }
}

class BrowserWebGpuCommandBuffer implements WebGpuCommandBufferPort {
  readonly kind = 'command-buffer' as const;
  readonly native: GPUCommandBuffer;

  constructor(commandBuffer: GPUCommandBuffer) {
    this.native = commandBuffer;
  }
}

class BrowserWebGpuQueue implements WebGpuQueuePort {
  readonly #queue: GPUQueue;

  constructor(queue: GPUQueue) {
    this.#queue = queue;
  }

  onSubmittedWorkDone(): Promise<void> {
    return this.#queue.onSubmittedWorkDone();
  }

  submit(commandBuffers: readonly WebGpuCommandBufferPort[]): void {
    this.#queue.submit(
      commandBuffers.map((commandBuffer) => {
        if (!(commandBuffer instanceof BrowserWebGpuCommandBuffer)) {
          throw new Error('Command Buffer belongs to another WebGPU device port.');
        }
        return commandBuffer.native;
      }),
    );
  }

  writeBuffer(
    buffer: WebGpuBufferPort,
    offset: number,
    data: Parameters<WebGpuQueuePort['writeBuffer']>[2],
  ): void {
    if (!(buffer instanceof BrowserWebGpuBuffer)) {
      throw new Error('Queue write Buffer belongs to another WebGPU device port.');
    }
    this.#queue.writeBuffer(buffer.native, offset, data);
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
    this.queue = new BrowserWebGpuQueue(device.queue);
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

  createBindGroup(request: WebGpuBindGroupRequest): WebGpuBindGroupPort {
    if (!(request.pipeline instanceof BrowserWebGpuPipeline)) {
      throw new Error('Bind Group Pipeline belongs to another WebGPU device port.');
    }
    return new BrowserWebGpuBindGroup(
      this.#device.createBindGroup({
        entries: request.entries.map((entry) => {
          if (!(entry.buffer instanceof BrowserWebGpuBuffer)) {
            throw new Error('Bind Group Buffer belongs to another WebGPU device port.');
          }
          return {
            binding: entry.binding,
            resource: {
              buffer: entry.buffer.native,
              offset: entry.offset,
              size: entry.size,
            },
          };
        }),
        layout: request.pipeline.native.getBindGroupLayout(request.group),
        ...(request.label === undefined ? {} : { label: request.label }),
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
      ...(request.depthStencil === undefined ? {} : { depthStencil: request.depthStencil }),
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
              targets: request.fragment.targets.map((target) => ({
                format: target.format,
                ...(target.blend === undefined ? {} : { blend: target.blend }),
              })),
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
