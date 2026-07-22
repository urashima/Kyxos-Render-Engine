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
  BackendEvents,
  BackendFrameSubmission,
  BackendLifecycleState,
  BackendLossInfo,
  BackendPipelineHandle,
  BackendRenderPassStatistics,
  BackendRenderPipelineDescriptor,
  BackendResourceDescriptor,
  BackendResourceHandle,
  BackendResourceHandleKind,
  BackendResourceKind,
  BackendResourceKindStatistics,
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
  BACKEND_RESOURCE_KINDS,
  backendResourceHandleKind,
  createBackendCapabilityReport,
  normalizeBackendSurfaceSize,
} from '@kyxos/render-backend-api';
import { HandleAllocator, KyxosEngineError, TypedEventEmitter } from '@kyxos/render-core';
import type { EventListener, Unsubscribe } from '@kyxos/render-core';

interface MockResourceRecord {
  readonly estimatedBytes: number;
  readonly handle: BackendResourceHandle;
  readonly kind: BackendResourceKind;
  readonly label: string | undefined;
}

interface MockSurfaceRecord {
  info: BackendSurfaceInfo;
  readonly target: BackendSurfaceDescriptor['target'];
}

export interface MockBackendOptions {
  readonly capabilities?: BackendCapabilityReport;
}

function createAllocators(): ReadonlyMap<
  BackendResourceKind,
  HandleAllocator<BackendResourceHandleKind<BackendResourceKind>>
> {
  return new Map(
    BACKEND_RESOURCE_KINDS.map((kind) => [
      kind,
      new HandleAllocator<BackendResourceHandleKind<BackendResourceKind>>(
        backendResourceHandleKind(kind),
      ),
    ]),
  );
}

function invalidArgument(message: string): KyxosEngineError {
  return new KyxosEngineError(message, {
    code: 'INVALID_ARGUMENT',
    module: 'backend',
    recoverable: false,
  });
}

function validateEstimatedBytes(estimatedBytes: number): void {
  if (!Number.isSafeInteger(estimatedBytes) || estimatedBytes < 0) {
    throw invalidArgument('Resource estimatedBytes must be a non-negative safe integer.');
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
    throw invalidArgument('Mock Bind Group resource is invalid.');
  }
  return kinds[0] as 'buffer' | 'sampler' | 'texture';
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

function validateTextureView(
  view: BackendTextureViewDescriptor | undefined,
  texture: BackendTextureDescriptor,
): boolean {
  const textureMips = texture.mipLevelCount ?? 1;
  const textureLayers = texture.size.depthOrArrayLayers ?? 1;
  const baseMipLevel = view?.baseMipLevel ?? 0;
  const baseArrayLayer = view?.baseArrayLayer ?? 0;
  const mipLevelCount = view?.mipLevelCount ?? textureMips - baseMipLevel;
  const dimension = view?.dimension ?? (textureLayers - baseArrayLayer === 1 ? '2d' : '2d-array');
  const arrayLayerCount =
    view?.arrayLayerCount ??
    (dimension === '2d' ? 1 : dimension === 'cube' ? 6 : textureLayers - baseArrayLayer);
  return (
    Number.isSafeInteger(baseMipLevel) &&
    baseMipLevel >= 0 &&
    Number.isSafeInteger(baseArrayLayer) &&
    baseArrayLayer >= 0 &&
    Number.isSafeInteger(mipLevelCount) &&
    mipLevelCount >= 1 &&
    baseMipLevel + mipLevelCount <= textureMips &&
    Number.isSafeInteger(arrayLayerCount) &&
    arrayLayerCount >= 1 &&
    baseArrayLayer + arrayLayerCount <= textureLayers &&
    (dimension !== '2d' || arrayLayerCount === 1) &&
    (dimension !== 'cube' || (arrayLayerCount === 6 && texture.size.width === texture.size.height))
  );
}

function renderAttachmentSize(
  view: BackendTextureViewDescriptor | undefined,
  texture: BackendTextureDescriptor,
): Readonly<{ height: number; width: number }> | undefined {
  const baseMipLevel = view?.baseMipLevel ?? 0;
  const baseArrayLayer = view?.baseArrayLayer ?? 0;
  if (
    !Number.isSafeInteger(baseMipLevel) ||
    baseMipLevel < 0 ||
    baseMipLevel >= (texture.mipLevelCount ?? 1) ||
    !Number.isSafeInteger(baseArrayLayer) ||
    baseArrayLayer < 0 ||
    baseArrayLayer >= (texture.size.depthOrArrayLayers ?? 1) ||
    (view?.mipLevelCount ?? 1) !== 1 ||
    (view?.arrayLayerCount ?? 1) !== 1 ||
    (view?.dimension ?? '2d') !== '2d'
  ) {
    return undefined;
  }
  return Object.freeze({
    height: Math.max(1, Math.floor(texture.size.height / 2 ** baseMipLevel)),
    width: Math.max(1, Math.floor(texture.size.width / 2 ** baseMipLevel)),
  });
}

export class MockBackend implements GraphicsBackend {
  readonly #allocators = createAllocators();
  readonly #bindGroups = new Map<BackendBindGroupHandle, BackendBindGroupDescriptor>();
  readonly #buffers = new Map<BackendBufferHandle, BackendBufferDescriptor>();
  readonly #commandEncoders = new Set<BackendCommandEncoderHandle>();
  readonly #events = new TypedEventEmitter<BackendEvents>();
  readonly #resources = new Map<BackendResourceHandle, MockResourceRecord>();
  readonly #samplers = new Map<BackendSamplerHandle, BackendSamplerDescriptor>();
  readonly #pipelines = new Map<BackendPipelineHandle, BackendRenderPipelineDescriptor>();
  readonly #shaderInfo = new Map<BackendShaderModuleHandle, BackendShaderCompilationInfo>();
  readonly #surfaces = new Map<BackendSurfaceHandle, MockSurfaceRecord>();
  readonly #textures = new Map<BackendTextureHandle, BackendTextureDescriptor>();
  #createdTotal = 0;
  #destroyedTotal = 0;
  #state: BackendLifecycleState = 'new';

  readonly capabilities: BackendCapabilityReport;
  readonly type = 'mock' as const;

  constructor(options: MockBackendOptions = {}) {
    this.capabilities =
      options.capabilities ??
      createBackendCapabilityReport({
        backend: 'mock',
        features: {
          compute: true,
          'timestamp-query': true,
        },
      });
  }

  get disposed(): boolean {
    return this.#state === 'disposed';
  }

  get state(): BackendLifecycleState {
    return this.#state;
  }

  async initialize(): Promise<void> {
    if (this.#state === 'ready') {
      return;
    }

    if (this.#state === 'disposed') {
      throw this.#stateError('Cannot initialize a disposed backend.', 'ALREADY_DISPOSED');
    }

    if (!this.capabilities.available) {
      throw new KyxosEngineError(
        this.capabilities.unavailableReason ?? 'Mock backend is unavailable.',
        {
          code: 'BACKEND_UNAVAILABLE',
          module: 'backend',
          recoverable: true,
          suggestedAction: 'Choose another available graphics backend.',
        },
      );
    }

    this.#setState('initializing');
    await Promise.resolve();
    this.#setState('ready');
  }

  on<EventName extends keyof BackendEvents>(
    eventName: EventName,
    listener: EventListener<BackendEvents[EventName]>,
  ): Unsubscribe {
    return this.#events.on(eventName, listener);
  }

  async waitForIdle(): Promise<void> {
    this.#assertReady('wait for submitted work');
    await Promise.resolve();
  }

  createBuffer(descriptor: BackendBufferDescriptor): BackendBufferHandle {
    if (!Number.isSafeInteger(descriptor.size) || descriptor.size < 1) {
      throw invalidArgument('Mock Buffer size must be a positive safe integer.');
    }
    const handle = this.createResource('buffer', {
      estimatedBytes: descriptor.size,
      ...(descriptor.label === undefined ? {} : { label: descriptor.label }),
    });
    this.#buffers.set(
      handle,
      Object.freeze({ ...descriptor, usage: Object.freeze([...descriptor.usage]) }),
    );
    return handle;
  }

  createTexture(descriptor: BackendTextureDescriptor): BackendTextureHandle {
    const estimatedBytes = estimateTextureBytes(descriptor);
    const handle = this.createResource('texture', {
      estimatedBytes,
      ...(descriptor.label === undefined ? {} : { label: descriptor.label }),
    });
    this.#textures.set(
      handle,
      Object.freeze({
        ...descriptor,
        size: Object.freeze({ ...descriptor.size }),
        usage: Object.freeze([...descriptor.usage]),
      }),
    );
    return handle;
  }

  createBindGroup(descriptor: BackendBindGroupDescriptor): BackendBindGroupHandle {
    this.#assertReady('create a Bind Group');
    if (
      !Number.isSafeInteger(descriptor.group) ||
      descriptor.group < 0 ||
      descriptor.group >= this.capabilities.limits.maxBindGroups ||
      descriptor.entries.length === 0 ||
      !this.#pipelines.has(descriptor.pipeline)
    )
      throw invalidArgument('Mock Bind Group descriptor is invalid.');
    const bindings = new Set<number>();
    for (const entry of descriptor.entries) {
      if (!Number.isSafeInteger(entry.binding) || entry.binding < 0 || bindings.has(entry.binding))
        throw invalidArgument('Mock Bind Group entry is invalid.');
      const resourceKind = bindGroupResourceKind(entry.resource);
      if (resourceKind === 'buffer' && 'buffer' in entry.resource) {
        const buffer = this.#buffers.get(entry.resource.buffer);
        const offset = entry.resource.offset ?? 0;
        const size = entry.resource.size ?? (buffer?.size ?? 0) - offset;
        if (
          buffer === undefined ||
          (!buffer.usage.includes('uniform') && !buffer.usage.includes('storage')) ||
          !Number.isSafeInteger(offset) ||
          offset < 0 ||
          offset % 4 !== 0 ||
          !Number.isSafeInteger(size) ||
          size < 1 ||
          size % 4 !== 0 ||
          offset + size > buffer.size
        )
          throw invalidArgument('Mock Bind Group Buffer entry is invalid.');
      } else if (resourceKind === 'sampler' && 'sampler' in entry.resource) {
        if (!this.#samplers.has(entry.resource.sampler)) {
          throw invalidArgument('Mock Bind Group Sampler entry is invalid.');
        }
      } else if (resourceKind === 'texture' && 'texture' in entry.resource) {
        const texture = this.#textures.get(entry.resource.texture);
        if (
          texture === undefined ||
          !texture.usage.includes('sampled') ||
          texture.format === 'depth24plus' ||
          texture.format === 'depth32float' ||
          (texture.sampleCount ?? 1) !== 1 ||
          !validateTextureView(entry.resource.view, texture)
        )
          throw invalidArgument('Mock Bind Group Texture entry is invalid.');
      }
      bindings.add(entry.binding);
    }
    const handle = this.createResource(
      'bind-group',
      descriptor.label === undefined ? {} : { label: descriptor.label },
    );
    this.#bindGroups.set(handle, descriptor);
    return handle;
  }

  createSampler(descriptor: BackendSamplerDescriptor = {}): BackendSamplerHandle {
    const handle = this.createResource(
      'sampler',
      descriptor.label === undefined ? {} : { label: descriptor.label },
    );
    this.#samplers.set(handle, Object.freeze({ ...descriptor }));
    return handle;
  }

  createShaderModule(descriptor: BackendShaderModuleDescriptor): BackendShaderModuleHandle {
    if (descriptor.code.trim().length === 0) {
      throw invalidArgument('Mock Shader Module source must not be empty.');
    }
    const handle = this.createResource('shader-module', {
      estimatedBytes: new TextEncoder().encode(descriptor.code).byteLength,
      ...(descriptor.label === undefined ? {} : { label: descriptor.label }),
    });
    this.#shaderInfo.set(handle, Object.freeze({ messages: Object.freeze([]), valid: true }));
    return handle;
  }

  async getShaderCompilationInfo(
    handle: BackendShaderModuleHandle,
  ): Promise<BackendShaderCompilationInfo> {
    const info = this.#shaderInfo.get(handle);
    if (info === undefined) {
      throw invalidArgument('Mock Shader Module handle is stale or foreign.');
    }
    return info;
  }

  async createRenderPipeline(
    descriptor: BackendRenderPipelineDescriptor,
  ): Promise<BackendPipelineHandle> {
    await this.getShaderCompilationInfo(descriptor.vertex.module);
    if (descriptor.fragment !== undefined) {
      await this.getShaderCompilationInfo(descriptor.fragment.module);
    }
    const handle = this.createResource(
      'pipeline',
      descriptor.label === undefined ? {} : { label: descriptor.label },
    );
    this.#pipelines.set(handle, descriptor);
    return handle;
  }

  createCommandEncoder(
    descriptor: BackendCommandEncoderDescriptor = {},
  ): BackendCommandEncoderHandle {
    const handle = this.createResource(
      'command-encoder',
      descriptor.label === undefined ? {} : { label: descriptor.label },
    );
    this.#commandEncoders.add(handle);
    return handle;
  }

  createResource<Kind extends BackendResourceKind>(
    kind: Kind,
    descriptor: BackendResourceDescriptor = {},
  ): BackendResourceHandle<Kind> {
    this.#assertReady('create a resource');
    const estimatedBytes = descriptor.estimatedBytes ?? 0;
    validateEstimatedBytes(estimatedBytes);

    const allocator = this.#allocators.get(kind);
    if (allocator === undefined) {
      throw invalidArgument(`Unsupported mock resource kind: "${kind}".`);
    }

    const handle = allocator.create() as BackendResourceHandle<Kind>;
    this.#resources.set(handle, {
      estimatedBytes,
      handle,
      kind,
      label: descriptor.label,
    });
    this.#createdTotal += 1;
    return handle;
  }

  createSurface(descriptor: BackendSurfaceDescriptor): BackendSurfaceHandle {
    this.#assertReady('create a surface');
    const size = normalizeBackendSurfaceSize(
      descriptor,
      this.capabilities.limits.maxTextureDimension2D,
    );
    descriptor.target.width = size.physicalWidth;
    descriptor.target.height = size.physicalHeight;
    const handle = this.createResource(
      'surface',
      descriptor.label === undefined ? {} : { label: descriptor.label },
    );
    this.#surfaces.set(handle, {
      info: Object.freeze({ format: 'bgra8unorm', size }),
      target: descriptor.target,
    });
    return handle;
  }

  destroyResource(handle: BackendResourceHandle): boolean {
    if (!this.#resources.delete(handle)) {
      return false;
    }

    if (handle.kind === backendResourceHandleKind('surface')) {
      this.#surfaces.delete(handle as BackendSurfaceHandle);
    }
    if (handle.kind === backendResourceHandleKind('shader-module')) {
      this.#shaderInfo.delete(handle as BackendShaderModuleHandle);
    }
    if (handle.kind === backendResourceHandleKind('buffer')) {
      this.#buffers.delete(handle as BackendBufferHandle);
    }
    if (handle.kind === backendResourceHandleKind('bind-group')) {
      this.#bindGroups.delete(handle as BackendBindGroupHandle);
    }
    if (handle.kind === backendResourceHandleKind('pipeline')) {
      this.#pipelines.delete(handle as BackendPipelineHandle);
    }
    if (handle.kind === backendResourceHandleKind('command-encoder')) {
      this.#commandEncoders.delete(handle as BackendCommandEncoderHandle);
    }
    if (handle.kind === backendResourceHandleKind('texture')) {
      this.#textures.delete(handle as BackendTextureHandle);
    }
    if (handle.kind === backendResourceHandleKind('sampler')) {
      this.#samplers.delete(handle as BackendSamplerHandle);
    }
    this.#destroyedTotal += 1;
    return true;
  }

  getSurfaceInfo(handle: BackendSurfaceHandle): BackendSurfaceInfo {
    const record = this.#surfaces.get(handle);
    if (record === undefined) {
      throw invalidArgument('Mock surface handle is stale or foreign.');
    }
    return record.info;
  }

  getResourceStatistics(): BackendResourceStatistics {
    const mutableByKind = Object.fromEntries(
      BACKEND_RESOURCE_KINDS.map((kind) => [kind, { activeCount: 0, activeEstimatedBytes: 0 }]),
    ) as Record<BackendResourceKind, { activeCount: number; activeEstimatedBytes: number }>;

    let activeEstimatedBytes = 0;
    for (const resource of this.#resources.values()) {
      const kindStatistics = mutableByKind[resource.kind];
      kindStatistics.activeCount += 1;
      kindStatistics.activeEstimatedBytes += resource.estimatedBytes;
      activeEstimatedBytes += resource.estimatedBytes;
    }

    const byKind = Object.fromEntries(
      BACKEND_RESOURCE_KINDS.map((kind) => [
        kind,
        Object.freeze({ ...mutableByKind[kind] }) satisfies BackendResourceKindStatistics,
      ]),
    ) as Record<BackendResourceKind, BackendResourceKindStatistics>;

    return Object.freeze({
      activeCount: this.#resources.size,
      activeEstimatedBytes,
      byKind: Object.freeze(byKind),
      createdTotal: this.#createdTotal,
      destroyedTotal: this.#destroyedTotal,
    });
  }

  writeBuffer(handle: BackendBufferHandle, data: BackendBufferData, offset = 0): void {
    this.#assertReady('write Buffer data');
    const descriptor = this.#buffers.get(handle);
    if (
      descriptor === undefined ||
      !descriptor.usage.includes('copy-dst') ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset + data.byteLength > descriptor.size
    )
      throw invalidArgument('Mock Buffer write is invalid or uses a foreign Handle.');
  }

  writeTexture(
    handle: BackendTextureHandle,
    data: BackendTextureData,
    descriptor: BackendTextureWriteDescriptor,
  ): void {
    this.#assertReady('write Texture data');
    const texture = this.#textures.get(handle);
    const mipLevel = descriptor.mipLevel ?? 0;
    const origin = {
      x: descriptor.origin?.x ?? 0,
      y: descriptor.origin?.y ?? 0,
      z: descriptor.origin?.z ?? 0,
    };
    const depthOrArrayLayers = descriptor.size.depthOrArrayLayers ?? 1;
    const texelBytes = texture === undefined ? 0 : texture.format === 'rgba16float' ? 8 : 4;
    const bytesPerRow = descriptor.bytesPerRow ?? descriptor.size.width * texelBytes;
    const rowsPerImage = descriptor.rowsPerImage ?? descriptor.size.height;
    const mipWidth = Math.max(1, Math.floor((texture?.size.width ?? 0) / 2 ** mipLevel));
    const mipHeight = Math.max(1, Math.floor((texture?.size.height ?? 0) / 2 ** mipLevel));
    const requiredBytes =
      bytesPerRow *
        (rowsPerImage * (depthOrArrayLayers - 1) + Math.max(0, descriptor.size.height - 1)) +
      descriptor.size.width * texelBytes;
    if (
      texture === undefined ||
      !texture.usage.includes('copy-dst') ||
      texture.format === 'depth24plus' ||
      texture.format === 'depth32float' ||
      (texture.sampleCount ?? 1) !== 1 ||
      !Number.isSafeInteger(mipLevel) ||
      mipLevel < 0 ||
      mipLevel >= (texture.mipLevelCount ?? 1) ||
      Object.values(origin).some((value) => !Number.isSafeInteger(value) || value < 0) ||
      !Number.isSafeInteger(descriptor.size.width) ||
      descriptor.size.width < 1 ||
      !Number.isSafeInteger(descriptor.size.height) ||
      descriptor.size.height < 1 ||
      !Number.isSafeInteger(depthOrArrayLayers) ||
      depthOrArrayLayers < 1 ||
      origin.x + descriptor.size.width > mipWidth ||
      origin.y + descriptor.size.height > mipHeight ||
      origin.z + depthOrArrayLayers > (texture.size.depthOrArrayLayers ?? 1) ||
      !Number.isSafeInteger(bytesPerRow) ||
      bytesPerRow < descriptor.size.width * texelBytes ||
      bytesPerRow % texelBytes !== 0 ||
      !Number.isSafeInteger(rowsPerImage) ||
      rowsPerImage < descriptor.size.height ||
      !Number.isSafeInteger(requiredBytes) ||
      data.byteLength < requiredBytes
    )
      throw invalidArgument('Mock Texture write is invalid or uses a foreign Handle.');
  }

  executeFrame(submission: BackendFrameSubmission): BackendRenderPassStatistics {
    this.#assertReady('execute a frame');
    if (!this.#commandEncoders.has(submission.commandEncoder)) {
      throw invalidArgument('Mock Command Encoder Handle is stale or foreign.');
    }
    let drawCalls = 0;
    let instances = 0;
    let triangles = 0;
    let vertices = 0;
    for (const renderPass of submission.renderPasses) {
      if ((renderPass.colorAttachment === undefined) === (renderPass.surface === undefined)) {
        throw invalidArgument('Mock Render Pass requires exactly one color target.');
      }
      let target: Readonly<{ format: BackendTextureFormat; height: number; width: number }>;
      if (renderPass.colorAttachment === undefined) {
        const surface = this.getSurfaceInfo(renderPass.surface);
        if (surface.size.suspended) {
          throw new KyxosEngineError('Mock Surface is suspended.', {
            code: 'INVALID_STATE',
            module: 'backend',
            recoverable: true,
          });
        }
        target = Object.freeze({
          format: surface.format,
          height: surface.size.physicalHeight,
          width: surface.size.physicalWidth,
        });
      } else {
        const loadOp = renderPass.colorAttachment.loadOp ?? 'clear';
        const storeOp = renderPass.colorAttachment.storeOp ?? 'store';
        if (
          (loadOp !== 'clear' && loadOp !== 'load') ||
          (storeOp !== 'discard' && storeOp !== 'store')
        ) {
          throw invalidArgument('Mock color attachment loadOp or storeOp is invalid.');
        }
        const texture = this.#textures.get(renderPass.colorAttachment.texture);
        const size = texture && renderAttachmentSize(renderPass.colorAttachment.view, texture);
        if (
          texture === undefined ||
          size === undefined ||
          !texture.usage.includes('render-attachment') ||
          texture.format === 'depth24plus' ||
          texture.format === 'depth32float' ||
          (texture.sampleCount ?? 1) !== 1
        ) {
          throw invalidArgument('Mock color attachment is invalid.');
        }
        target = Object.freeze({ format: texture.format, ...size });
      }
      const depthTexture =
        renderPass.depthAttachment === undefined
          ? undefined
          : this.#textures.get(renderPass.depthAttachment.texture);
      if (
        renderPass.depthAttachment !== undefined &&
        (depthTexture === undefined ||
          !depthTexture.usage.includes('render-attachment') ||
          (depthTexture.format !== 'depth24plus' && depthTexture.format !== 'depth32float') ||
          (depthTexture.sampleCount ?? 1) !== 1 ||
          depthTexture.size.width !== target.width ||
          depthTexture.size.height !== target.height)
      )
        throw invalidArgument('Mock depth attachment is invalid.');
      for (const draw of renderPass.draws ?? []) {
        const pipeline = this.#pipelines.get(draw.pipeline);
        if (pipeline === undefined) {
          throw invalidArgument('Mock Pipeline Handle is stale or foreign.');
        }
        const colorFormats = pipeline.fragment?.targets.map(({ format }) => format) ?? [];
        if (
          colorFormats.length > 1 ||
          (colorFormats.length === 1 && colorFormats[0] !== target.format)
        ) {
          throw invalidArgument('Mock Pipeline color target is incompatible.');
        }
        if (
          (pipeline.depthStencil !== undefined && depthTexture === undefined) ||
          (pipeline.depthStencil !== undefined &&
            depthTexture !== undefined &&
            pipeline.depthStencil.format !== depthTexture.format)
        )
          throw invalidArgument('Mock Pipeline depth attachment is missing or incompatible.');
        const groups = new Set<number>();
        for (const binding of draw.bindGroups ?? []) {
          const bindGroup = this.#bindGroups.get(binding.bindGroup);
          const resourcesActive = bindGroup?.entries.every((entry) => {
            const kind = bindGroupResourceKind(entry.resource);
            if (kind === 'buffer' && 'buffer' in entry.resource) {
              return this.#buffers.has(entry.resource.buffer);
            }
            if (kind === 'sampler' && 'sampler' in entry.resource) {
              return this.#samplers.has(entry.resource.sampler);
            }
            if (kind === 'texture' && 'texture' in entry.resource) {
              return this.#textures.has(entry.resource.texture);
            }
            return false;
          });
          if (
            bindGroup === undefined ||
            resourcesActive !== true ||
            groups.has(binding.group) ||
            bindGroup.group !== binding.group ||
            bindGroup.pipeline !== draw.pipeline
          )
            throw invalidArgument('Mock Draw Bind Group is stale or incompatible.');
          groups.add(binding.group);
        }
        for (const binding of draw.vertexBuffers ?? []) {
          if (!this.#buffers.has(binding.buffer)) {
            throw invalidArgument('Mock Vertex Buffer Handle is stale or foreign.');
          }
        }
        if (draw.indexBuffer !== undefined && !this.#buffers.has(draw.indexBuffer.buffer)) {
          throw invalidArgument('Mock Index Buffer Handle is stale or foreign.');
        }
        const count = draw.indexCount ?? draw.vertexCount ?? 0;
        const drawInstances = draw.instanceCount ?? 1;
        const topology = pipeline.primitive?.topology ?? 'triangle-list';
        drawCalls += 1;
        instances += drawInstances;
        vertices += count * drawInstances;
        triangles +=
          topology === 'triangle-list'
            ? Math.floor(count / 3) * drawInstances
            : topology === 'triangle-strip'
              ? Math.max(0, count - 2) * drawInstances
              : 0;
      }
    }
    this.destroyResource(submission.commandEncoder);
    return Object.freeze({ drawCalls, instances, triangles, vertices });
  }

  resizeSurface(handle: BackendSurfaceHandle, resize: BackendSurfaceResize): BackendSurfaceInfo {
    this.#assertReady('resize a surface');
    const record = this.#surfaces.get(handle);
    if (record === undefined) {
      return this.getSurfaceInfo(handle);
    }
    const size = normalizeBackendSurfaceSize(
      resize,
      this.capabilities.limits.maxTextureDimension2D,
    );
    const info = Object.freeze({ format: 'bgra8unorm' as const, size });
    record.target.width = size.physicalWidth;
    record.target.height = size.physicalHeight;
    record.info = info;
    return info;
  }

  simulateLoss(loss: Partial<BackendLossInfo> = {}): void {
    this.#assertReady('simulate device loss');
    this.#releaseAllResources();
    const info = Object.freeze({
      message: loss.message ?? 'Mock backend device lost.',
      reason: loss.reason ?? 'unknown',
      recoverable: loss.recoverable ?? true,
    }) satisfies BackendLossInfo;

    this.#setState('lost');
    this.#events.emit('lost', info);
  }

  debugSimulateDeviceLoss(): void {
    this.simulateLoss({ message: 'Mock diagnostic Device Lost simulation.', reason: 'destroyed' });
  }

  dispose(): void {
    if (this.#state === 'disposed') {
      return;
    }

    this.#releaseAllResources();
    this.#setState('disposed');
    this.#events.dispose();
  }

  #assertReady(action: string): void {
    if (this.#state !== 'ready') {
      throw this.#stateError(
        `Backend must be ready to ${action}; current state is "${this.#state}".`,
      );
    }
  }

  #releaseAllResources(): void {
    this.#destroyedTotal += this.#resources.size;
    this.#resources.clear();
    this.#bindGroups.clear();
    this.#buffers.clear();
    this.#commandEncoders.clear();
    this.#pipelines.clear();
    this.#samplers.clear();
    this.#shaderInfo.clear();
    this.#surfaces.clear();
    this.#textures.clear();
  }

  #setState(current: BackendLifecycleState): void {
    const previous = this.#state;
    if (previous === current) {
      return;
    }

    this.#state = current;
    this.#events.emit('statechange', Object.freeze({ current, previous }));
  }

  #stateError(
    message: string,
    code: 'ALREADY_DISPOSED' | 'INVALID_STATE' = 'INVALID_STATE',
  ): KyxosEngineError {
    return new KyxosEngineError(message, {
      code,
      module: 'backend',
      recoverable: false,
    });
  }
}
