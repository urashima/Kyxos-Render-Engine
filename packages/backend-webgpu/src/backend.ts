import type {
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
  BackendTextureDescriptor,
  BackendTextureHandle,
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
  WebGpuBufferPort,
  WebGpuCommandEncoderPort,
  WebGpuDevicePort,
  WebGpuDrawRequest,
  WebGpuPipelinePort,
  WebGpuPlatformPort,
  WebGpuPowerPreference,
  WebGpuShaderModulePort,
  WebGpuSurfacePort,
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

interface WebGpuPipelineRecord {
  readonly pipeline: WebGpuPipelinePort;
  readonly topology: BackendPrimitiveTopology;
}

interface WebGpuCommandEncoderRecord {
  readonly encoder: WebGpuCommandEncoderPort;
}

interface PreparedDraw {
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

function validateOptions(options: WebGpuBackendOptions): readonly BackendFeature[] {
  const requiredFeatures = [...new Set(options.requiredFeatures ?? [])];
  for (const feature of requiredFeatures) {
    if (!BACKEND_FEATURES.includes(feature)) {
      throw new KyxosEngineError(`Unknown WebGPU backend feature: "${String(feature)}".`, {
        code: 'INVALID_ARGUMENT',
        module: 'backend',
        recoverable: false,
      });
    }
  }
  return Object.freeze(requiredFeatures);
}

function requirePositiveSafeInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new KyxosEngineError(`${name} must be a positive safe integer.`, {
      code: 'INVALID_ARGUMENT',
      module: 'backend',
      recoverable: false,
    });
  }
}

function requireNonEmpty(name: string, values: readonly unknown[]): void {
  if (values.length === 0) {
    throw new KyxosEngineError(`${name} must contain at least one value.`, {
      code: 'INVALID_ARGUMENT',
      module: 'backend',
      recoverable: false,
    });
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
    throw new KyxosEngineError(
      `Texture mipLevelCount exceeds the maximum ${maximumMipLevels} for its dimensions.`,
      {
        code: 'INVALID_ARGUMENT',
        module: 'backend',
        recoverable: false,
      },
    );
  }
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
  return texels * samples * 4;
}

function validateSamplerDescriptor(descriptor: BackendSamplerDescriptor): void {
  if (
    descriptor.maxAnisotropy !== undefined &&
    (!Number.isSafeInteger(descriptor.maxAnisotropy) ||
      descriptor.maxAnisotropy < 1 ||
      descriptor.maxAnisotropy > 16)
  ) {
    throw new KyxosEngineError('Sampler maxAnisotropy must be an integer from 1 through 16.', {
      code: 'INVALID_ARGUMENT',
      module: 'backend',
      recoverable: false,
    });
  }
}

function validateShaderDescriptor(descriptor: BackendShaderModuleDescriptor): void {
  if (descriptor.language !== 'wgsl' || descriptor.code.trim().length === 0) {
    throw new KyxosEngineError('Shader Module must contain non-empty WGSL source.', {
      code: 'INVALID_ARGUMENT',
      module: 'backend',
      recoverable: false,
    });
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
    throw new KyxosEngineError(`${name} must be a non-negative safe integer.`, {
      code: 'INVALID_ARGUMENT',
      module: 'backend',
      recoverable: false,
    });
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
      return this.#resources.register(
        'texture',
        resourceAccounting(descriptor.label, estimateTextureBytes(descriptor)),
        texture,
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
        pipeline,
        topology: descriptor.primitive?.topology ?? 'triangle-list',
      } satisfies WebGpuPipelineRecord);
    } catch (error) {
      throw this.#resourceCreationError('Render Pipeline', error);
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
      const draws = (renderPass.draws ?? []).map((draw) => this.#prepareDraw(draw));
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
      return {
        clearColor: renderPass.clearColor,
        draws: draws.map((draw) => draw.request),
        label: renderPass.label,
        surface: surface.surface,
      };
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
      instances: instanceCount,
      request: {
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
