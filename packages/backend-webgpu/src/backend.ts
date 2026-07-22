import type {
  BackendBindGroupDescriptor,
  BackendBindGroupHandle,
  BackendBindGroupResource,
  BackendBufferData,
  BackendBufferDescriptor,
  BackendBufferHandle,
  BackendCapabilityReport,
  BackendCommandEncoderDescriptor,
  BackendCommandEncoderHandle,
  BackendDrawCommand,
  BackendEvents,
  BackendFeature,
  BackendFrameSubmission,
  BackendLifecycleState,
  BackendPipelineHandle,
  BackendPrimitiveTopology,
  BackendRenderPassStatistics,
  BackendRenderPipelineDescriptor,
  BackendResourceDescriptor,
  BackendResourceHandle,
  BackendResourceKind,
  BackendResourceStatistics,
  BackendSamplerDescriptor,
  BackendSamplerHandle,
  BackendShaderCompilationInfo,
  BackendShaderModuleDescriptor,
  BackendShaderModuleHandle,
  BackendSurfaceDescriptor,
  BackendSurfaceHandle,
  BackendSurfaceInfo,
  BackendSurfaceResize,
  BackendTextureData,
  BackendTextureDescriptor,
  BackendTextureFormat,
  BackendTextureHandle,
  BackendTextureViewDescriptor,
  BackendTextureWriteDescriptor,
  GraphicsBackend,
} from '@kyxos/render-backend-api';
import {
  BACKEND_FEATURES,
  createBackendCapabilityReport,
  normalizeBackendSurfaceSize,
} from '@kyxos/render-backend-api';
import { KyxosEngineError, TypedEventEmitter, toKyxosEngineError } from '@kyxos/render-core';
import type { EventListener, Unsubscribe } from '@kyxos/render-core';

import { createBrowserWebGpuPlatform } from './browser-platform.js';
import type {
  WebGpuBindGroupPort,
  WebGpuBufferPort,
  WebGpuCommandEncoderPort,
  WebGpuDevicePort,
  WebGpuDrawRequest,
  WebGpuPipelinePort,
  WebGpuPlatformPort,
  WebGpuPowerPreference,
  WebGpuSamplerPort,
  WebGpuShaderModulePort,
  WebGpuSurfacePort,
  WebGpuTexturePort,
} from './platform.js';
import { WebGpuResourceRegistry } from './resource-registry.js';

interface WebGpuSurfaceRecord {
  info: BackendSurfaceInfo;
  readonly surface: WebGpuSurfacePort;
}

interface WebGpuBufferRecord {
  readonly buffer: WebGpuBufferPort;
  readonly descriptor: BackendBufferDescriptor;
}

interface WebGpuTextureRecord {
  readonly descriptor: BackendTextureDescriptor;
  readonly texture: WebGpuTexturePort;
}

interface WebGpuPipelineRecord {
  readonly colorFormats: readonly BackendTextureFormat[];
  readonly depthFormat:
    Extract<BackendTextureDescriptor['format'], 'depth24plus' | 'depth32float'> | undefined;
  readonly pipeline: WebGpuPipelinePort;
  readonly topology: BackendPrimitiveTopology;
}

interface WebGpuBindGroupRecord {
  readonly bindGroup: WebGpuBindGroupPort;
  readonly group: number;
  readonly pipeline: BackendPipelineHandle;
  readonly resourceHandles: readonly BackendResourceHandle[];
}

interface WebGpuCommandEncoderRecord {
  readonly encoder: WebGpuCommandEncoderPort;
}

interface PreparedDraw {
  readonly colorFormats: readonly BackendTextureFormat[];
  readonly depthFormat: WebGpuPipelineRecord['depthFormat'];
  readonly instances: number;
  readonly request: WebGpuDrawRequest;
  readonly triangles: number;
  readonly vertices: number;
}

export interface WebGpuBackendOptions {
  readonly forceFallbackAdapter?: boolean;
  readonly label?: string;
  readonly powerPreference?: WebGpuPowerPreference;
  readonly requiredFeatures?: readonly BackendFeature[];
}

function invalidArgument(message: string): KyxosEngineError {
  return new KyxosEngineError(message, {
    code: 'INVALID_ARGUMENT',
    module: 'backend',
    recoverable: false,
  });
}

function validateOptions(options: WebGpuBackendOptions): readonly BackendFeature[] {
  const requiredFeatures = [...new Set(options.requiredFeatures ?? [])];
  for (const feature of requiredFeatures) {
    if (!BACKEND_FEATURES.includes(feature)) {
      throw invalidArgument(`Unknown WebGPU backend feature: "${String(feature)}".`);
    }
  }
  return Object.freeze(requiredFeatures);
}

function requirePositiveSafeInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw invalidArgument(`${name} must be a positive safe integer.`);
  }
}

function requireNonEmpty(name: string, values: readonly unknown[]): void {
  if (values.length === 0) {
    throw invalidArgument(`${name} must contain at least one value.`);
  }
}

function validateBufferDescriptor(descriptor: BackendBufferDescriptor): void {
  requirePositiveSafeInteger('Buffer size', descriptor.size);
  requireNonEmpty('Buffer usage', descriptor.usage);
}

function validateTextureDescriptor(
  descriptor: BackendTextureDescriptor,
  maxTextureDimension2D: number,
): void {
  requirePositiveSafeInteger('Texture width', descriptor.size.width);
  requirePositiveSafeInteger('Texture height', descriptor.size.height);
  requirePositiveSafeInteger('Texture depthOrArrayLayers', descriptor.size.depthOrArrayLayers ?? 1);
  requirePositiveSafeInteger('Texture mipLevelCount', descriptor.mipLevelCount ?? 1);
  requireNonEmpty('Texture usage', descriptor.usage);
  if (
    descriptor.size.width > maxTextureDimension2D ||
    descriptor.size.height > maxTextureDimension2D
  ) {
    throw new KyxosEngineError(
      `Texture dimensions exceed maxTextureDimension2D (${maxTextureDimension2D}).`,
      {
        code: 'UNSUPPORTED_CAPABILITY',
        module: 'backend',
        recoverable: true,
        suggestedAction: 'Downscale the texture or choose a device with a larger limit.',
      },
    );
  }
  const maximumMipLevels =
    Math.floor(Math.log2(Math.max(descriptor.size.width, descriptor.size.height))) + 1;
  if ((descriptor.mipLevelCount ?? 1) > maximumMipLevels) {
    throw invalidArgument(
      `Texture mipLevelCount exceeds the maximum ${maximumMipLevels} for its dimensions.`,
    );
  }
}

function resolveRenderAttachmentView(
  descriptor: BackendTextureDescriptor,
  view: BackendTextureViewDescriptor | undefined,
): Readonly<{
  descriptor: BackendTextureViewDescriptor;
  height: number;
  width: number;
}> {
  const baseMipLevel = view?.baseMipLevel ?? 0;
  const baseArrayLayer = view?.baseArrayLayer ?? 0;
  const mipLevelCount = view?.mipLevelCount ?? 1;
  const arrayLayerCount = view?.arrayLayerCount ?? 1;
  const dimension = view?.dimension ?? '2d';
  if (
    !Number.isSafeInteger(baseMipLevel) ||
    baseMipLevel < 0 ||
    baseMipLevel >= (descriptor.mipLevelCount ?? 1) ||
    !Number.isSafeInteger(baseArrayLayer) ||
    baseArrayLayer < 0 ||
    baseArrayLayer >= (descriptor.size.depthOrArrayLayers ?? 1) ||
    mipLevelCount !== 1 ||
    arrayLayerCount !== 1 ||
    dimension !== '2d'
  ) {
    throw invalidArgument('Render attachment View must select one valid 2D mip and array layer.');
  }
  return Object.freeze({
    descriptor: Object.freeze({
      arrayLayerCount,
      baseArrayLayer,
      baseMipLevel,
      dimension,
      mipLevelCount,
    }),
    height: Math.max(1, Math.floor(descriptor.size.height / 2 ** baseMipLevel)),
    width: Math.max(1, Math.floor(descriptor.size.width / 2 ** baseMipLevel)),
  });
}

function estimateTextureBytes(descriptor: BackendTextureDescriptor): number {
  const layers = descriptor.size.depthOrArrayLayers ?? 1;
  const samples = descriptor.sampleCount ?? 1;
  const mipLevels = descriptor.mipLevelCount ?? 1;
  let width = descriptor.size.width;
  let height = descriptor.size.height;
  let texels = 0;
  for (let mip = 0; mip < mipLevels; mip += 1) {
    texels += width * height * layers;
    width = Math.max(1, Math.floor(width / 2));
    height = Math.max(1, Math.floor(height / 2));
  }
  return texels * samples * (descriptor.format === 'rgba16float' ? 8 : 4);
}

function validateSamplerDescriptor(descriptor: BackendSamplerDescriptor): void {
  if (
    descriptor.maxAnisotropy !== undefined &&
    (!Number.isSafeInteger(descriptor.maxAnisotropy) ||
      descriptor.maxAnisotropy < 1 ||
      descriptor.maxAnisotropy > 16)
  ) {
    throw invalidArgument('Sampler maxAnisotropy must be an integer from 1 through 16.');
  }
}

function bindGroupResourceKind(
  resource: BackendBindGroupResource,
): 'buffer' | 'sampler' | 'texture' {
  const kinds = [
    Object.hasOwn(resource, 'buffer') ? 'buffer' : null,
    Object.hasOwn(resource, 'sampler') ? 'sampler' : null,
    Object.hasOwn(resource, 'texture') ? 'texture' : null,
  ].filter((kind): kind is 'buffer' | 'sampler' | 'texture' => kind !== null);
  if (kinds.length !== 1) {
    throw invalidArgument('Bind Group resource needs exactly one Handle.');
  }
  return kinds[0] as 'buffer' | 'sampler' | 'texture';
}

function validateShaderDescriptor(descriptor: BackendShaderModuleDescriptor): void {
  if (descriptor.language !== 'wgsl' || descriptor.code.trim().length === 0) {
    throw invalidArgument('Shader Module must contain non-empty WGSL source.');
  }
}

function resourceAccounting(
  label: string | undefined,
  estimatedBytes: number,
): BackendResourceDescriptor {
  return {
    estimatedBytes,
    ...(label === undefined ? {} : { label }),
  };
}

function requireNonNegativeSafeInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw invalidArgument(`${name} must be a non-negative safe integer.`);
  }
}

function requireFiniteClearColor(
  clearColor: BackendFrameSubmission['renderPasses'][number]['clearColor'],
): void {
  for (const [channel, value] of Object.entries(clearColor)) {
    if (!Number.isFinite(value)) {
      throw new KyxosEngineError(`Clear color channel ${channel} must be finite.`, {
        code: 'INVALID_ARGUMENT',
        module: 'backend',
        recoverable: false,
      });
    }
  }
}

function triangleCount(
  topology: BackendPrimitiveTopology,
  elementCount: number,
  instances: number,
): number {
  if (topology === 'triangle-list') {
    return Math.floor(elementCount / 3) * instances;
  }
  if (topology === 'triangle-strip') {
    return Math.max(0, elementCount - 2) * instances;
  }
  return 0;
}

export class WebGpuBackend implements GraphicsBackend {
  readonly #events = new TypedEventEmitter<BackendEvents>();
  readonly #forceFallbackAdapter: boolean;
  readonly #label: string | undefined;
  readonly #platform: WebGpuPlatformPort;
  readonly #powerPreference: WebGpuPowerPreference | undefined;
  readonly #requiredFeatures: readonly BackendFeature[];
  readonly #resources = new WebGpuResourceRegistry();
  #attempt = 0;
  #capabilities: BackendCapabilityReport;
  #device: WebGpuDevicePort | undefined;
  #deviceGeneration = 0;
  #initialization: Promise<void> | undefined;
  #state: BackendLifecycleState = 'new';

  readonly type = 'webgpu' as const;

  constructor(options: WebGpuBackendOptions, platform: WebGpuPlatformPort) {
    this.#platform = platform;
    this.#forceFallbackAdapter = options.forceFallbackAdapter ?? false;
    this.#label = options.label;
    this.#powerPreference = options.powerPreference;
    this.#requiredFeatures = validateOptions(options);
    this.#capabilities = createBackendCapabilityReport({
      available: platform.available,
      backend: 'webgpu',
      ...(platform.available
        ? {}
        : { unavailableReason: 'WebGPU is unavailable in this environment.' }),
    });
  }

  get capabilities(): BackendCapabilityReport {
    return this.#capabilities;
  }

  get disposed(): boolean {
    return this.#state === 'disposed';
  }

  get state(): BackendLifecycleState {
    return this.#state;
  }

  initialize(): Promise<void> {
    if (this.#state === 'ready') {
      return Promise.resolve();
    }
    if (this.#state === 'disposed') {
      return Promise.reject(this.#stateError('Cannot initialize a disposed WebGPU backend.'));
    }
    if (this.#initialization !== undefined) {
      return this.#initialization;
    }

    const attempt = ++this.#attempt;
    const fallbackState = this.#state === 'lost' ? 'lost' : 'new';
    const initialization = this.#initializeAttempt(attempt, fallbackState).finally(() => {
      if (this.#initialization === initialization) {
        this.#initialization = undefined;
      }
    });
    this.#initialization = initialization;
    return initialization;
  }

  on<EventName extends keyof BackendEvents>(
    eventName: EventName,
    listener: EventListener<BackendEvents[EventName]>,
  ): Unsubscribe {
    return this.#events.on(eventName, listener);
  }

  async waitForIdle(): Promise<void> {
    this.#assertReady('wait for submitted work');
    const device = this.#device;
    if (device === undefined) {
      throw this.#stateError('WebGPU device is unavailable while waiting for submitted work.');
    }
    try {
      await device.queue.onSubmittedWorkDone();
    } catch (error) {
      throw toKyxosEngineError(error, {
        code: 'DEVICE_LOST',
        message: 'WebGPU queue work did not complete because the device was lost.',
        module: 'backend',
        recoverable: true,
        suggestedAction: 'Reinitialize the renderer and recreate device-owned resources.',
      });
    }
  }

  createBuffer(descriptor: BackendBufferDescriptor): BackendBufferHandle {
    validateBufferDescriptor(descriptor);
    const device = this.#requireDevice('create a Buffer');
    try {
      const buffer = device.createBuffer(descriptor);
      const record: WebGpuBufferRecord = {
        buffer,
        descriptor: Object.freeze({
          ...descriptor,
          usage: Object.freeze([...descriptor.usage]),
        }),
      };
      return this.#resources.register(
        'buffer',
        resourceAccounting(descriptor.label, descriptor.size),
        record,
        () => buffer.destroy(),
      );
    } catch (error) {
      throw this.#resourceCreationError('Buffer', error);
    }
  }

  createTexture(descriptor: BackendTextureDescriptor): BackendTextureHandle {
    validateTextureDescriptor(descriptor, this.#capabilities.limits.maxTextureDimension2D);
    const device = this.#requireDevice('create a Texture');
    try {
      const texture = device.createTexture(descriptor);
      const record: WebGpuTextureRecord = {
        descriptor: Object.freeze({
          ...descriptor,
          size: Object.freeze({ ...descriptor.size }),
          usage: Object.freeze([...descriptor.usage]),
        }),
        texture,
      };
      return this.#resources.register(
        'texture',
        resourceAccounting(descriptor.label, estimateTextureBytes(descriptor)),
        record,
        () => texture.destroy(),
      );
    } catch (error) {
      throw this.#resourceCreationError('Texture', error);
    }
  }

  createSampler(descriptor: BackendSamplerDescriptor = {}): BackendSamplerHandle {
    validateSamplerDescriptor(descriptor);
    const device = this.#requireDevice('create a Sampler');
    try {
      const sampler = device.createSampler(descriptor);
      return this.#resources.register('sampler', resourceAccounting(descriptor.label, 0), sampler);
    } catch (error) {
      throw this.#resourceCreationError('Sampler', error);
    }
  }

  createShaderModule(descriptor: BackendShaderModuleDescriptor): BackendShaderModuleHandle {
    validateShaderDescriptor(descriptor);
    const device = this.#requireDevice('create a Shader Module');
    try {
      const shader = device.createShaderModule(descriptor);
      return this.#resources.register(
        'shader-module',
        resourceAccounting(descriptor.label, new TextEncoder().encode(descriptor.code).byteLength),
        shader,
      );
    } catch (error) {
      throw this.#resourceCreationError('Shader Module', error);
    }
  }

  async getShaderCompilationInfo(
    handle: BackendShaderModuleHandle,
  ): Promise<BackendShaderCompilationInfo> {
    this.#assertReady('read Shader Module compilation information');
    const shader = this.#resources.resolve<'shader-module', WebGpuShaderModulePort>(
      handle,
      'shader-module',
    );
    try {
      return await shader.getCompilationInfo();
    } catch (error) {
      throw toKyxosEngineError(error, {
        code: 'RESOURCE_CREATION_FAILED',
        message: 'Failed to read WebGPU Shader Module compilation information.',
        module: 'backend',
        recoverable: false,
      });
    }
  }

  async createRenderPipeline(
    descriptor: BackendRenderPipelineDescriptor,
  ): Promise<BackendPipelineHandle> {
    const device = this.#requireDevice('create a Render Pipeline');
    if (descriptor.vertex.entryPoint.trim().length === 0) {
      throw new KyxosEngineError('Render Pipeline vertex entryPoint must not be empty.', {
        code: 'INVALID_ARGUMENT',
        module: 'backend',
        recoverable: false,
      });
    }
    const vertexModule = this.#resources.resolve<'shader-module', WebGpuShaderModulePort>(
      descriptor.vertex.module,
      'shader-module',
    );
    const fragmentModule =
      descriptor.fragment === undefined
        ? undefined
        : this.#resources.resolve<'shader-module', WebGpuShaderModulePort>(
            descriptor.fragment.module,
            'shader-module',
          );
    if (descriptor.fragment !== undefined) {
      if (descriptor.fragment.entryPoint.trim().length === 0) {
        throw new KyxosEngineError('Render Pipeline fragment entryPoint must not be empty.', {
          code: 'INVALID_ARGUMENT',
          module: 'backend',
          recoverable: false,
        });
      }
      requireNonEmpty('Render Pipeline color targets', descriptor.fragment.targets);
      if (
        descriptor.fragment.targets.some(
          (target) => target.format === 'depth24plus' || target.format === 'depth32float',
        )
      ) {
        throw new KyxosEngineError('Render Pipeline color targets cannot use a depth format.', {
          code: 'INVALID_ARGUMENT',
          module: 'backend',
          recoverable: false,
        });
      }
    }
    for (const buffer of descriptor.vertex.buffers ?? []) {
      requirePositiveSafeInteger('Vertex Buffer arrayStride', buffer.arrayStride);
      for (const attribute of buffer.attributes) {
        if (
          !Number.isSafeInteger(attribute.offset) ||
          attribute.offset < 0 ||
          !Number.isSafeInteger(attribute.shaderLocation) ||
          attribute.shaderLocation < 0
        ) {
          throw new KyxosEngineError(
            'Vertex attributes require non-negative safe integer offsets and Shader locations.',
            {
              code: 'INVALID_ARGUMENT',
              module: 'backend',
              recoverable: false,
            },
          );
        }
      }
    }

    try {
      const pipeline = await device.createRenderPipeline({
        depthStencil: descriptor.depthStencil,
        fragment:
          descriptor.fragment === undefined || fragmentModule === undefined
            ? undefined
            : {
                entryPoint: descriptor.fragment.entryPoint,
                module: fragmentModule,
                targets: descriptor.fragment.targets,
              },
        label: descriptor.label,
        primitive: descriptor.primitive,
        vertex: {
          buffers: descriptor.vertex.buffers ?? [],
          entryPoint: descriptor.vertex.entryPoint,
          module: vertexModule,
        },
      });
      return this.#resources.register('pipeline', resourceAccounting(descriptor.label, 0), {
        colorFormats: Object.freeze(descriptor.fragment?.targets.map(({ format }) => format) ?? []),
        depthFormat: descriptor.depthStencil?.format,
        pipeline,
        topology: descriptor.primitive?.topology ?? 'triangle-list',
      } satisfies WebGpuPipelineRecord);
    } catch (error) {
      throw this.#resourceCreationError('Render Pipeline', error);
    }
  }

  createBindGroup(descriptor: BackendBindGroupDescriptor): BackendBindGroupHandle {
    const device = this.#requireDevice('create a Bind Group');
    requireNonNegativeSafeInteger('Bind Group index', descriptor.group);
    if (descriptor.group >= this.#capabilities.limits.maxBindGroups) {
      throw new KyxosEngineError(
        `Bind Group index exceeds maxBindGroups (${this.#capabilities.limits.maxBindGroups}).`,
        {
          code: 'UNSUPPORTED_CAPABILITY',
          module: 'backend',
          recoverable: false,
        },
      );
    }
    requireNonEmpty('Bind Group entries', descriptor.entries);
    const pipeline = this.#resources.resolve<'pipeline', WebGpuPipelineRecord>(
      descriptor.pipeline,
      'pipeline',
    );
    const bindings = new Set<number>();
    const resourceHandles: BackendResourceHandle[] = [];
    let sampledTextureCount = 0;
    const entries = descriptor.entries.map((entry) => {
      requireNonNegativeSafeInteger('Bind Group binding', entry.binding);
      if (bindings.has(entry.binding)) {
        throw invalidArgument(`Bind Group binding ${entry.binding} is provided more than once.`);
      }
      bindings.add(entry.binding);
      const resourceKind = bindGroupResourceKind(entry.resource);
      if (resourceKind === 'buffer' && 'buffer' in entry.resource) {
        const buffer = this.#resources.resolve<'buffer', WebGpuBufferRecord>(
          entry.resource.buffer,
          'buffer',
        );
        if (
          !buffer.descriptor.usage.includes('uniform') &&
          !buffer.descriptor.usage.includes('storage')
        ) {
          throw invalidArgument('Bind Group Buffer requires uniform or storage usage.');
        }
        const offset = entry.resource.offset ?? 0;
        const size = entry.resource.size ?? buffer.descriptor.size - offset;
        requireNonNegativeSafeInteger('Bind Group Buffer offset', offset);
        requirePositiveSafeInteger('Bind Group Buffer size', size);
        if (offset % 4 !== 0 || size % 4 !== 0 || offset + size > buffer.descriptor.size) {
          throw invalidArgument('Bind Group Buffer range is invalid.');
        }
        resourceHandles.push(entry.resource.buffer);
        return {
          binding: entry.binding,
          buffer: buffer.buffer,
          kind: 'buffer' as const,
          offset,
          size,
        };
      }
      if (resourceKind === 'sampler' && 'sampler' in entry.resource) {
        const sampler = this.#resources.resolve<'sampler', WebGpuSamplerPort>(
          entry.resource.sampler,
          'sampler',
        );
        resourceHandles.push(entry.resource.sampler);
        return { binding: entry.binding, kind: 'sampler' as const, sampler };
      }
      if (resourceKind === 'texture' && 'texture' in entry.resource) {
        const texture = this.#resources.resolve<'texture', WebGpuTextureRecord>(
          entry.resource.texture,
          'texture',
        );
        if (
          !texture.descriptor.usage.includes('sampled') ||
          texture.descriptor.format === 'depth24plus' ||
          texture.descriptor.format === 'depth32float' ||
          (texture.descriptor.sampleCount ?? 1) !== 1
        ) {
          throw invalidArgument('Bind Group Texture must be sampled color data.');
        }
        sampledTextureCount += 1;
        resourceHandles.push(entry.resource.texture);
        return {
          binding: entry.binding,
          kind: 'texture' as const,
          view: texture.texture.createView(entry.resource.view),
        };
      }
      throw invalidArgument('Bind Group resource is invalid.');
    });
    if (sampledTextureCount > this.#capabilities.limits.maxSampledTexturesPerShaderStage) {
      throw new KyxosEngineError(
        `Bind Group sampled Texture count exceeds maxSampledTexturesPerShaderStage (${this.#capabilities.limits.maxSampledTexturesPerShaderStage}).`,
        {
          code: 'UNSUPPORTED_CAPABILITY',
          module: 'backend',
          recoverable: false,
        },
      );
    }

    try {
      const bindGroup = device.createBindGroup({
        entries,
        group: descriptor.group,
        label: descriptor.label,
        pipeline: pipeline.pipeline,
      });
      return this.#resources.register('bind-group', resourceAccounting(descriptor.label, 0), {
        bindGroup,
        group: descriptor.group,
        pipeline: descriptor.pipeline,
        resourceHandles: Object.freeze([...resourceHandles]),
      } satisfies WebGpuBindGroupRecord);
    } catch (error) {
      throw this.#resourceCreationError('Bind Group', error);
    }
  }

  createCommandEncoder(
    descriptor: BackendCommandEncoderDescriptor = {},
  ): BackendCommandEncoderHandle {
    const device = this.#requireDevice('create a Command Encoder');
    try {
      const encoder = device.createCommandEncoder(descriptor);
      return this.#resources.register('command-encoder', resourceAccounting(descriptor.label, 0), {
        encoder,
      } satisfies WebGpuCommandEncoderRecord);
    } catch (error) {
      throw this.#resourceCreationError('Command Encoder', error);
    }
  }

  createResource<Kind extends BackendResourceKind>(
    kind: Kind,
    descriptor: BackendResourceDescriptor = {},
  ): BackendResourceHandle<Kind> {
    void kind;
    void descriptor;
    this.#assertReady('create a resource');
    throw new KyxosEngineError(
      'WebGPU resource descriptors are not configured at this Phase 1 checkpoint.',
      {
        code: 'UNSUPPORTED_CAPABILITY',
        module: 'backend',
        recoverable: false,
      },
    );
  }

  debugSimulateDeviceLoss(): void {
    this.#requireDevice('simulate Device Lost for diagnostics').destroy();
  }

  createSurface(descriptor: BackendSurfaceDescriptor): BackendSurfaceHandle {
    const device = this.#requireDevice('create a Canvas surface');
    const size = normalizeBackendSurfaceSize(
      descriptor,
      this.#capabilities.limits.maxTextureDimension2D,
    );
    let surface: WebGpuSurfacePort | undefined;
    try {
      surface = device.createSurface({
        alphaMode: descriptor.alphaMode ?? 'opaque',
        colorSpace: descriptor.colorSpace ?? 'srgb',
        label: descriptor.label,
        target: descriptor.target,
      });
      surface.configure(size);
      const record: WebGpuSurfaceRecord = {
        info: Object.freeze({ format: surface.format, size }),
        surface,
      };
      return this.#resources.register(
        'surface',
        descriptor.label === undefined ? {} : { label: descriptor.label },
        record,
        () => surface?.unconfigure(),
      );
    } catch (error) {
      try {
        surface?.unconfigure();
      } catch {
        // The original creation/configuration error remains the actionable cause.
      }
      throw toKyxosEngineError(error, {
        code: 'RESOURCE_CREATION_FAILED',
        message: 'Failed to create or configure the WebGPU Canvas surface.',
        module: 'backend',
        recoverable: true,
        suggestedAction: 'Verify the Canvas, dimensions, DPR, and WebGPU context availability.',
      });
    }
  }

  destroyResource(handle: BackendResourceHandle): boolean {
    return this.#resources.destroy(handle);
  }

  getSurfaceInfo(handle: BackendSurfaceHandle): BackendSurfaceInfo {
    return this.#resources.resolve<'surface', WebGpuSurfaceRecord>(handle, 'surface').info;
  }

  getResourceStatistics(): BackendResourceStatistics {
    return this.#resources.getStatistics();
  }

  writeBuffer(handle: BackendBufferHandle, data: BackendBufferData, offset = 0): void {
    const device = this.#requireDevice('write Buffer data');
    const record = this.#resources.resolve<'buffer', WebGpuBufferRecord>(handle, 'buffer');
    requireNonNegativeSafeInteger('Buffer write offset', offset);
    if (offset % 4 !== 0 || data.byteLength % 4 !== 0) {
      throw new KyxosEngineError('Buffer write offset and byte length must be multiples of 4.', {
        code: 'INVALID_ARGUMENT',
        module: 'backend',
        recoverable: false,
      });
    }
    if (offset + data.byteLength > record.descriptor.size) {
      throw new KyxosEngineError('Buffer write exceeds the allocated Buffer size.', {
        code: 'INVALID_ARGUMENT',
        module: 'backend',
        recoverable: false,
      });
    }
    if (!record.descriptor.usage.includes('copy-dst')) {
      throw new KyxosEngineError('Buffer write requires the copy-dst usage.', {
        code: 'INVALID_ARGUMENT',
        module: 'backend',
        recoverable: false,
      });
    }
    try {
      device.queue.writeBuffer(record.buffer, offset, data);
    } catch (error) {
      throw toKyxosEngineError(error, {
        code: 'RESOURCE_CREATION_FAILED',
        message: 'Failed to upload WebGPU Buffer data.',
        module: 'backend',
        recoverable: true,
      });
    }
  }

  writeTexture(
    handle: BackendTextureHandle,
    data: BackendTextureData,
    descriptor: BackendTextureWriteDescriptor,
  ): void {
    const device = this.#requireDevice('write Texture data');
    const record = this.#resources.resolve<'texture', WebGpuTextureRecord>(handle, 'texture');
    if (
      !record.descriptor.usage.includes('copy-dst') ||
      record.descriptor.format === 'depth24plus' ||
      record.descriptor.format === 'depth32float' ||
      (record.descriptor.sampleCount ?? 1) !== 1
    ) {
      throw invalidArgument('Texture write needs copy-dst single-sampled color data.');
    }

    const mipLevel = descriptor.mipLevel ?? 0;
    requireNonNegativeSafeInteger('Texture write mipLevel', mipLevel);
    if (mipLevel >= (record.descriptor.mipLevelCount ?? 1)) {
      throw invalidArgument('Texture write mip is out of range.');
    }
    const origin = {
      x: descriptor.origin?.x ?? 0,
      y: descriptor.origin?.y ?? 0,
      z: descriptor.origin?.z ?? 0,
    };
    requireNonNegativeSafeInteger('Texture write origin.x', origin.x);
    requireNonNegativeSafeInteger('Texture write origin.y', origin.y);
    requireNonNegativeSafeInteger('Texture write origin.z', origin.z);
    const size = {
      depthOrArrayLayers: descriptor.size.depthOrArrayLayers ?? 1,
      height: descriptor.size.height,
      width: descriptor.size.width,
    };
    requirePositiveSafeInteger('Texture write width', size.width);
    requirePositiveSafeInteger('Texture write height', size.height);
    requirePositiveSafeInteger('Texture write depthOrArrayLayers', size.depthOrArrayLayers);
    const mipWidth = Math.max(1, Math.floor(record.descriptor.size.width / 2 ** mipLevel));
    const mipHeight = Math.max(1, Math.floor(record.descriptor.size.height / 2 ** mipLevel));
    const layers = record.descriptor.size.depthOrArrayLayers ?? 1;
    if (
      origin.x + size.width > mipWidth ||
      origin.y + size.height > mipHeight ||
      origin.z + size.depthOrArrayLayers > layers
    ) {
      throw invalidArgument('Texture write exceeds its subresource.');
    }

    const texelBytes = record.descriptor.format === 'rgba16float' ? 8 : 4;
    const bytesPerRow = descriptor.bytesPerRow ?? size.width * texelBytes;
    const rowsPerImage = descriptor.rowsPerImage ?? size.height;
    requirePositiveSafeInteger('Texture write bytesPerRow', bytesPerRow);
    requirePositiveSafeInteger('Texture write rowsPerImage', rowsPerImage);
    if (
      bytesPerRow % texelBytes !== 0 ||
      bytesPerRow < size.width * texelBytes ||
      rowsPerImage < size.height
    ) {
      throw invalidArgument('Texture write rows are invalid.');
    }
    const requiredBytes =
      bytesPerRow * (rowsPerImage * (size.depthOrArrayLayers - 1) + Math.max(0, size.height - 1)) +
      size.width * texelBytes;
    if (!Number.isSafeInteger(requiredBytes) || data.byteLength < requiredBytes) {
      throw invalidArgument('Texture write data is too small.');
    }

    try {
      device.queue.writeTexture(
        { bytesPerRow, mipLevel, origin, rowsPerImage, size, texture: record.texture },
        data,
      );
    } catch (error) {
      throw toKyxosEngineError(error, {
        code: 'RESOURCE_CREATION_FAILED',
        message: 'Failed to upload WebGPU Texture data.',
        module: 'backend',
        recoverable: true,
      });
    }
  }

  executeFrame(submission: BackendFrameSubmission): BackendRenderPassStatistics {
    const device = this.#requireDevice('execute a frame');
    requireNonEmpty('Frame render passes', submission.renderPasses);
    const encoder = this.#resources.resolve<'command-encoder', WebGpuCommandEncoderRecord>(
      submission.commandEncoder,
      'command-encoder',
    );
    let drawCalls = 0;
    let instances = 0;
    let triangles = 0;
    let vertices = 0;
    const renderPasses = submission.renderPasses.map((renderPass) => {
      requireFiniteClearColor(renderPass.clearColor);
      if ((renderPass.colorAttachment === undefined) === (renderPass.surface === undefined)) {
        throw invalidArgument(
          'Render Pass requires exactly one Surface or Texture color attachment.',
        );
      }
      let target:
        | Readonly<{
            format: BackendTextureFormat;
            height: number;
            kind: 'surface';
            surface: WebGpuSurfacePort;
            width: number;
          }>
        | Readonly<{
            colorAttachment: {
              readonly loadOp: 'clear' | 'load';
              readonly storeOp: 'discard' | 'store';
              readonly view: ReturnType<WebGpuTexturePort['createView']>;
            };
            format: BackendTextureFormat;
            height: number;
            kind: 'texture';
            width: number;
          }>;
      if (renderPass.colorAttachment === undefined) {
        const surface = this.#resources.resolve<'surface', WebGpuSurfaceRecord>(
          renderPass.surface,
          'surface',
        );
        if (surface.info.size.suspended) {
          throw new KyxosEngineError('Cannot render to a suspended zero-area Canvas surface.', {
            code: 'INVALID_STATE',
            module: 'backend',
            recoverable: true,
            suggestedAction: 'Resize the Canvas to nonzero dimensions before rendering.',
          });
        }
        target = Object.freeze({
          format: surface.info.format,
          height: surface.info.size.physicalHeight,
          kind: 'surface',
          surface: surface.surface,
          width: surface.info.size.physicalWidth,
        });
      } else {
        const loadOp = renderPass.colorAttachment.loadOp ?? 'clear';
        const storeOp = renderPass.colorAttachment.storeOp ?? 'store';
        if (
          (loadOp !== 'clear' && loadOp !== 'load') ||
          (storeOp !== 'discard' && storeOp !== 'store')
        ) {
          throw invalidArgument('Color attachment loadOp or storeOp is invalid.');
        }
        const record = this.#resources.resolve<'texture', WebGpuTextureRecord>(
          renderPass.colorAttachment.texture,
          'texture',
        );
        if (
          !record.descriptor.usage.includes('render-attachment') ||
          record.descriptor.format === 'depth24plus' ||
          record.descriptor.format === 'depth32float' ||
          (record.descriptor.sampleCount ?? 1) !== 1
        ) {
          throw invalidArgument(
            'Color attachment requires a single-sampled color Texture with render-attachment usage.',
          );
        }
        const attachmentView = resolveRenderAttachmentView(
          record.descriptor,
          renderPass.colorAttachment.view,
        );
        target = Object.freeze({
          colorAttachment: Object.freeze({
            loadOp,
            storeOp,
            view: record.texture.createView(attachmentView.descriptor),
          }),
          format: record.descriptor.format,
          height: attachmentView.height,
          kind: 'texture',
          width: attachmentView.width,
        });
      }
      const draws = (renderPass.draws ?? []).map((draw) => this.#prepareDraw(draw));
      if (
        draws.some(
          ({ colorFormats }) =>
            colorFormats.length > 1 ||
            (colorFormats.length === 1 && colorFormats[0] !== target.format),
        )
      ) {
        throw invalidArgument(
          'Render Pipeline color target must match the Render Pass attachment.',
        );
      }
      let depthAttachment;
      if (renderPass.depthAttachment !== undefined) {
        const record = this.#resources.resolve<'texture', WebGpuTextureRecord>(
          renderPass.depthAttachment.texture,
          'texture',
        );
        if (
          !record.descriptor.usage.includes('render-attachment') ||
          (record.descriptor.format !== 'depth24plus' &&
            record.descriptor.format !== 'depth32float') ||
          (record.descriptor.sampleCount ?? 1) !== 1
        ) {
          throw new KyxosEngineError(
            'Depth attachment requires a depth Texture with render-attachment usage.',
            {
              code: 'INVALID_ARGUMENT',
              module: 'backend',
              recoverable: false,
            },
          );
        }
        if (
          record.descriptor.size.width !== target.width ||
          record.descriptor.size.height !== target.height
        ) {
          throw new KyxosEngineError('Depth attachment dimensions must match the color target.', {
            code: 'INVALID_ARGUMENT',
            module: 'backend',
            recoverable: false,
          });
        }
        const clearValue = renderPass.depthAttachment.clearValue ?? 1;
        if (!Number.isFinite(clearValue) || clearValue < 0 || clearValue > 1) {
          throw new KyxosEngineError('Depth clear value must be finite and between 0 and 1.', {
            code: 'INVALID_ARGUMENT',
            module: 'backend',
            recoverable: false,
          });
        }
        depthAttachment = {
          clearValue,
          loadOp: renderPass.depthAttachment.loadOp ?? 'clear',
          storeOp: renderPass.depthAttachment.storeOp ?? 'store',
          view: record.texture.createView(),
        } as const;
        if (
          draws.some(
            (draw) =>
              draw.depthFormat !== undefined && draw.depthFormat !== record.descriptor.format,
          )
        ) {
          throw new KyxosEngineError('Render Pipeline and depth attachment formats must match.', {
            code: 'INVALID_ARGUMENT',
            module: 'backend',
            recoverable: false,
          });
        }
      } else if (draws.some((draw) => draw.depthFormat !== undefined)) {
        throw new KyxosEngineError('A depth-enabled Render Pipeline requires a depth attachment.', {
          code: 'INVALID_ARGUMENT',
          module: 'backend',
          recoverable: false,
        });
      }
      for (const draw of draws) {
        drawCalls += 1;
        instances += draw.instances;
        triangles += draw.triangles;
        vertices += draw.vertices;
        if (
          !Number.isSafeInteger(drawCalls) ||
          !Number.isSafeInteger(instances) ||
          !Number.isSafeInteger(triangles) ||
          !Number.isSafeInteger(vertices)
        ) {
          throw new KyxosEngineError('Frame statistics exceed the safe integer range.', {
            code: 'INVALID_ARGUMENT',
            module: 'backend',
            recoverable: false,
          });
        }
      }
      const prepared = {
        clearColor: renderPass.clearColor,
        depthAttachment,
        draws: draws.map((draw) => draw.request),
        label: renderPass.label,
      };
      return target.kind === 'surface'
        ? { ...prepared, surface: target.surface }
        : { ...prepared, colorAttachment: target.colorAttachment };
    });

    try {
      for (const renderPass of renderPasses) {
        encoder.encoder.encodeRenderPass(renderPass);
      }
      const commandBuffer = encoder.encoder.finish();
      device.queue.submit([commandBuffer]);
    } catch (error) {
      throw toKyxosEngineError(error, {
        code: 'RESOURCE_CREATION_FAILED',
        message: 'Failed to encode or submit the WebGPU frame.',
        module: 'backend',
        recoverable: true,
        suggestedAction: 'Inspect render commands and recreate resources after device loss.',
      });
    } finally {
      this.#resources.destroy(submission.commandEncoder);
    }

    return Object.freeze({ drawCalls, instances, triangles, vertices });
  }

  resizeSurface(handle: BackendSurfaceHandle, resize: BackendSurfaceResize): BackendSurfaceInfo {
    this.#assertReady('resize a Canvas surface');
    const record = this.#resources.resolve<'surface', WebGpuSurfaceRecord>(handle, 'surface');
    const size = normalizeBackendSurfaceSize(
      resize,
      this.#capabilities.limits.maxTextureDimension2D,
    );
    try {
      record.surface.configure(size);
    } catch (error) {
      throw toKyxosEngineError(error, {
        code: 'RESOURCE_CREATION_FAILED',
        message: 'Failed to resize or reconfigure the WebGPU Canvas surface.',
        module: 'backend',
        recoverable: true,
        suggestedAction: 'Verify the Canvas dimensions and retry after restoring visibility.',
      });
    }
    record.info = Object.freeze({ format: record.surface.format, size });
    return record.info;
  }

  dispose(): void {
    if (this.#state === 'disposed') {
      return;
    }

    this.#attempt += 1;
    this.#deviceGeneration += 1;
    const device = this.#device;
    this.#device = undefined;
    this.#setState('disposed');
    const errors: unknown[] = [];
    try {
      this.#resources.releaseAll(true);
    } catch (error) {
      errors.push(error);
    }
    try {
      device?.destroy();
    } catch (error) {
      errors.push(error);
    }
    this.#resources.releaseAll(false);
    this.#events.dispose();
    if (errors.length === 1) {
      throw errors[0];
    }
    if (errors.length > 1) {
      throw new AggregateError(errors, 'WebGPU backend disposal failed.');
    }
  }

  async #initializeAttempt(
    attempt: number,
    fallbackState: Extract<BackendLifecycleState, 'lost' | 'new'>,
  ): Promise<void> {
    this.#setState('initializing');
    try {
      if (!this.#platform.available) {
        this.#capabilities = createBackendCapabilityReport({
          available: false,
          backend: 'webgpu',
          unavailableReason: 'WebGPU is unavailable in this environment.',
        });
        throw this.#unavailableError('WebGPU is unavailable in this environment.');
      }

      const adapter = await this.#platform.requestAdapter({
        forceFallbackAdapter: this.#forceFallbackAdapter,
        powerPreference: this.#powerPreference,
      });
      this.#assertAttemptActive(attempt);
      if (adapter === null) {
        this.#capabilities = createBackendCapabilityReport({
          available: false,
          backend: 'webgpu',
          unavailableReason: 'No compatible WebGPU adapter was found.',
        });
        throw this.#unavailableError('No compatible WebGPU adapter was found.');
      }

      this.#capabilities = createBackendCapabilityReport({
        backend: 'webgpu',
        features: Object.fromEntries(
          BACKEND_FEATURES.map((feature) => [feature, adapter.features.has(feature)]),
        ),
        limits: adapter.limits,
      });
      const unsupportedFeatures = this.#requiredFeatures.filter(
        (feature) => !adapter.features.has(feature),
      );
      if (unsupportedFeatures.length > 0) {
        throw new KyxosEngineError(
          `WebGPU adapter does not support required features: ${unsupportedFeatures.join(', ')}.`,
          {
            code: 'UNSUPPORTED_CAPABILITY',
            module: 'backend',
            recoverable: true,
            suggestedAction: 'Disable the feature or choose a compatible adapter/backend.',
          },
        );
      }

      const device = await adapter.requestDevice({
        label: this.#label,
        requiredFeatures: this.#requiredFeatures,
      });
      this.#assertAttemptActive(attempt, device);
      this.#device = device;
      const generation = ++this.#deviceGeneration;
      void device.lost.then(
        (loss) => this.#handleDeviceLost(generation, loss),
        (cause: unknown) =>
          this.#handleDeviceLost(
            generation,
            Object.freeze({
              message: cause instanceof Error ? cause.message : 'WebGPU device loss rejected.',
              reason: 'unknown',
              recoverable: true,
            }),
          ),
      );
      this.#setState('ready');
    } catch (error) {
      if (this.#state !== 'disposed' && this.#attempt === attempt) {
        this.#setState(fallbackState);
      }
      if (error instanceof KyxosEngineError) {
        throw error;
      }
      throw toKyxosEngineError(error, {
        code: 'BACKEND_INITIALIZATION_FAILED',
        message: 'WebGPU adapter or device initialization failed.',
        module: 'backend',
        recoverable: true,
        suggestedAction: 'Retry initialization or choose the WebGL2 fallback when available.',
      });
    }
  }

  #assertAttemptActive(attempt: number, device?: WebGpuDevicePort): void {
    if (this.#state !== 'disposed' && this.#attempt === attempt) {
      return;
    }
    device?.destroy();
    throw this.#stateError('WebGPU initialization was canceled because the backend was disposed.');
  }

  #assertReady(action: string): void {
    if (this.#state !== 'ready') {
      throw this.#stateError(
        `WebGPU backend must be ready to ${action}; current state is "${this.#state}".`,
      );
    }
  }

  #requireDevice(action: string): WebGpuDevicePort {
    this.#assertReady(action);
    if (this.#device === undefined) {
      throw this.#stateError(`WebGPU device is unavailable while attempting to ${action}.`);
    }
    return this.#device;
  }

  #prepareDraw(draw: BackendDrawCommand): PreparedDraw {
    const pipeline = this.#resources.resolve<'pipeline', WebGpuPipelineRecord>(
      draw.pipeline,
      'pipeline',
    );
    const instanceCount = draw.instanceCount ?? 1;
    requirePositiveSafeInteger('Draw instanceCount', instanceCount);
    const firstInstance = draw.firstInstance ?? 0;
    const firstIndex = draw.firstIndex ?? 0;
    const firstVertex = draw.firstVertex ?? 0;
    requireNonNegativeSafeInteger('Draw firstInstance', firstInstance);
    requireNonNegativeSafeInteger('Draw firstIndex', firstIndex);
    requireNonNegativeSafeInteger('Draw firstVertex', firstVertex);

    const groups = new Set<number>();
    const bindGroups = (draw.bindGroups ?? []).map((binding) => {
      requireNonNegativeSafeInteger('Draw Bind Group index', binding.group);
      if (groups.has(binding.group)) {
        throw new KyxosEngineError(`Bind Group ${binding.group} is bound more than once.`, {
          code: 'INVALID_ARGUMENT',
          module: 'backend',
          recoverable: false,
        });
      }
      groups.add(binding.group);
      const record = this.#resources.resolve<'bind-group', WebGpuBindGroupRecord>(
        binding.bindGroup,
        'bind-group',
      );
      if (record.group !== binding.group || record.pipeline !== draw.pipeline) {
        throw new KyxosEngineError(
          'Draw Bind Group must use its declared group and originating Render Pipeline.',
          {
            code: 'INVALID_ARGUMENT',
            module: 'backend',
            recoverable: false,
          },
        );
      }
      if (record.resourceHandles.some((handle) => !this.#resources.has(handle))) {
        throw invalidArgument('Draw Bind Group references a stale GPU resource.');
      }
      return { bindGroup: record.bindGroup, group: binding.group };
    });

    const slots = new Set<number>();
    const vertexBuffers = (draw.vertexBuffers ?? []).map((binding) => {
      requireNonNegativeSafeInteger('Vertex Buffer slot', binding.slot);
      if (slots.has(binding.slot)) {
        throw new KyxosEngineError(`Vertex Buffer slot ${binding.slot} is bound more than once.`, {
          code: 'INVALID_ARGUMENT',
          module: 'backend',
          recoverable: false,
        });
      }
      slots.add(binding.slot);
      const record = this.#resources.resolve<'buffer', WebGpuBufferRecord>(
        binding.buffer,
        'buffer',
      );
      if (!record.descriptor.usage.includes('vertex')) {
        throw new KyxosEngineError('Vertex Buffer binding requires the vertex usage.', {
          code: 'INVALID_ARGUMENT',
          module: 'backend',
          recoverable: false,
        });
      }
      const offset = binding.offset ?? 0;
      const size = binding.size;
      requireNonNegativeSafeInteger('Vertex Buffer offset', offset);
      if (size !== undefined) requirePositiveSafeInteger('Vertex Buffer size', size);
      if (offset % 4 !== 0 || (size !== undefined && size % 4 !== 0)) {
        throw new KyxosEngineError('Vertex Buffer offset and size must be multiples of 4.', {
          code: 'INVALID_ARGUMENT',
          module: 'backend',
          recoverable: false,
        });
      }
      if (offset + (size ?? 0) > record.descriptor.size || offset >= record.descriptor.size) {
        throw new KyxosEngineError('Vertex Buffer binding exceeds the Buffer size.', {
          code: 'INVALID_ARGUMENT',
          module: 'backend',
          recoverable: false,
        });
      }
      return { buffer: record.buffer, offset, size, slot: binding.slot };
    });

    let indexBuffer: WebGpuDrawRequest['indexBuffer'];
    let elementCount: number;
    if (draw.indexBuffer === undefined) {
      if (draw.indexCount !== undefined || draw.vertexCount === undefined) {
        throw new KyxosEngineError(
          'A non-indexed Draw requires vertexCount and must not provide indexCount.',
          {
            code: 'INVALID_ARGUMENT',
            module: 'backend',
            recoverable: false,
          },
        );
      }
      requirePositiveSafeInteger('Draw vertexCount', draw.vertexCount);
      elementCount = draw.vertexCount;
    } else {
      if (draw.indexCount === undefined || draw.vertexCount !== undefined) {
        throw new KyxosEngineError(
          'An indexed Draw requires indexCount and must not provide vertexCount.',
          {
            code: 'INVALID_ARGUMENT',
            module: 'backend',
            recoverable: false,
          },
        );
      }
      requirePositiveSafeInteger('Draw indexCount', draw.indexCount);
      const record = this.#resources.resolve<'buffer', WebGpuBufferRecord>(
        draw.indexBuffer.buffer,
        'buffer',
      );
      if (!record.descriptor.usage.includes('index')) {
        throw new KyxosEngineError('Index Buffer binding requires the index usage.', {
          code: 'INVALID_ARGUMENT',
          module: 'backend',
          recoverable: false,
        });
      }
      const offset = draw.indexBuffer.offset ?? 0;
      const size = draw.indexBuffer.size;
      const alignment = draw.indexBuffer.format === 'uint16' ? 2 : 4;
      requireNonNegativeSafeInteger('Index Buffer offset', offset);
      if (offset % alignment !== 0) {
        throw new KyxosEngineError(`Index Buffer offset must be aligned to ${alignment} bytes.`, {
          code: 'INVALID_ARGUMENT',
          module: 'backend',
          recoverable: false,
        });
      }
      if (size !== undefined) requirePositiveSafeInteger('Index Buffer size', size);
      if (size !== undefined && size % alignment !== 0) {
        throw new KyxosEngineError(`Index Buffer size must be aligned to ${alignment} bytes.`, {
          code: 'INVALID_ARGUMENT',
          module: 'backend',
          recoverable: false,
        });
      }
      if (offset + (size ?? 0) > record.descriptor.size || offset >= record.descriptor.size) {
        throw new KyxosEngineError('Index Buffer binding exceeds the Buffer size.', {
          code: 'INVALID_ARGUMENT',
          module: 'backend',
          recoverable: false,
        });
      }
      const boundSize = size ?? record.descriptor.size - offset;
      const requiredSize = (firstIndex + draw.indexCount) * alignment;
      if (!Number.isSafeInteger(requiredSize) || requiredSize > boundSize) {
        throw new KyxosEngineError('Indexed Draw exceeds the bound Index Buffer range.', {
          code: 'INVALID_ARGUMENT',
          module: 'backend',
          recoverable: false,
        });
      }
      indexBuffer = {
        buffer: record.buffer,
        format: draw.indexBuffer.format,
        offset,
        size,
      };
      elementCount = draw.indexCount;
    }

    const submittedVertices = elementCount * instanceCount;
    const triangles = triangleCount(pipeline.topology, elementCount, instanceCount);
    if (!Number.isSafeInteger(submittedVertices) || !Number.isSafeInteger(triangles)) {
      throw new KyxosEngineError('Draw statistics exceed the safe integer range.', {
        code: 'INVALID_ARGUMENT',
        module: 'backend',
        recoverable: false,
      });
    }
    return {
      colorFormats: pipeline.colorFormats,
      depthFormat: pipeline.depthFormat,
      instances: instanceCount,
      request: {
        bindGroups,
        firstIndex,
        firstInstance,
        firstVertex,
        indexBuffer,
        indexCount: draw.indexCount,
        instanceCount,
        pipeline: pipeline.pipeline,
        vertexBuffers,
        vertexCount: draw.vertexCount,
      },
      triangles,
      vertices: submittedVertices,
    };
  }

  #handleDeviceLost(
    generation: number,
    loss: Readonly<{
      message: string;
      reason: 'destroyed' | 'unknown';
      recoverable: boolean;
    }>,
  ): void {
    if (this.#state === 'disposed' || generation !== this.#deviceGeneration) {
      return;
    }
    this.#device = undefined;
    this.#resources.releaseAll(false);
    this.#setState('lost');
    this.#events.emit('lost', Object.freeze({ ...loss }));
  }

  #setState(current: BackendLifecycleState): void {
    const previous = this.#state;
    if (previous === current) {
      return;
    }
    this.#state = current;
    this.#events.emit('statechange', Object.freeze({ current, previous }));
  }

  #stateError(message: string): KyxosEngineError {
    return new KyxosEngineError(message, {
      code: this.#state === 'disposed' ? 'ALREADY_DISPOSED' : 'INVALID_STATE',
      module: 'backend',
      recoverable: false,
    });
  }

  #resourceCreationError(resourceName: string, error: unknown): KyxosEngineError {
    return toKyxosEngineError(error, {
      code: 'RESOURCE_CREATION_FAILED',
      message: `Failed to create WebGPU ${resourceName}.`,
      module: 'backend',
      recoverable: false,
      suggestedAction: 'Inspect the descriptor, device limits, and Shader compilation diagnostics.',
    });
  }

  #unavailableError(message: string): KyxosEngineError {
    return new KyxosEngineError(message, {
      code: 'BACKEND_UNAVAILABLE',
      module: 'backend',
      recoverable: true,
      suggestedAction: 'Use a WebGL2 fallback on systems without WebGPU support.',
    });
  }
}

export function createWebGpuBackend(options: WebGpuBackendOptions = {}): GraphicsBackend {
  return createWebGpuBackendForPlatform(options, createBrowserWebGpuPlatform());
}

/** Package-private test seam; not re-exported from the package root. */
export function createWebGpuBackendForPlatform(
  options: WebGpuBackendOptions,
  platform: WebGpuPlatformPort,
): WebGpuBackend {
  return new WebGpuBackend(options, platform);
}
