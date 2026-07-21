import type {
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
  BackendTextureDescriptor,
  BackendTextureHandle,
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

function validateEstimatedBytes(estimatedBytes: number): void {
  if (!Number.isSafeInteger(estimatedBytes) || estimatedBytes < 0) {
    throw new KyxosEngineError('Resource estimatedBytes must be a non-negative safe integer.', {
      code: 'INVALID_ARGUMENT',
      module: 'backend',
      recoverable: false,
    });
  }
}

export class MockBackend implements GraphicsBackend {
  readonly #allocators = createAllocators();
  readonly #buffers = new Map<BackendBufferHandle, BackendBufferDescriptor>();
  readonly #commandEncoders = new Set<BackendCommandEncoderHandle>();
  readonly #events = new TypedEventEmitter<BackendEvents>();
  readonly #resources = new Map<BackendResourceHandle, MockResourceRecord>();
  readonly #pipelines = new Map<BackendPipelineHandle, BackendRenderPipelineDescriptor>();
  readonly #shaderInfo = new Map<BackendShaderModuleHandle, BackendShaderCompilationInfo>();
  readonly #surfaces = new Map<BackendSurfaceHandle, MockSurfaceRecord>();
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
      throw new KyxosEngineError('Mock Buffer size must be a positive safe integer.', {
        code: 'INVALID_ARGUMENT',
        module: 'backend',
        recoverable: false,
      });
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
    const layers = descriptor.size.depthOrArrayLayers ?? 1;
    const estimatedBytes =
      descriptor.size.width * descriptor.size.height * layers * (descriptor.sampleCount ?? 1) * 4;
    return this.createResource('texture', {
      estimatedBytes,
      ...(descriptor.label === undefined ? {} : { label: descriptor.label }),
    });
  }

  createSampler(descriptor: BackendSamplerDescriptor = {}): BackendSamplerHandle {
    return this.createResource(
      'sampler',
      descriptor.label === undefined ? {} : { label: descriptor.label },
    );
  }

  createShaderModule(descriptor: BackendShaderModuleDescriptor): BackendShaderModuleHandle {
    if (descriptor.code.trim().length === 0) {
      throw new KyxosEngineError('Mock Shader Module source must not be empty.', {
        code: 'INVALID_ARGUMENT',
        module: 'backend',
        recoverable: false,
      });
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
      throw new KyxosEngineError('Mock Shader Module handle is stale or foreign.', {
        code: 'INVALID_ARGUMENT',
        module: 'backend',
        recoverable: false,
      });
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
      throw new KyxosEngineError(`Unsupported mock resource kind: "${kind}".`, {
        code: 'INVALID_ARGUMENT',
        module: 'backend',
        recoverable: false,
      });
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
    if (handle.kind === backendResourceHandleKind('pipeline')) {
      this.#pipelines.delete(handle as BackendPipelineHandle);
    }
    if (handle.kind === backendResourceHandleKind('command-encoder')) {
      this.#commandEncoders.delete(handle as BackendCommandEncoderHandle);
    }
    this.#destroyedTotal += 1;
    return true;
  }

  getSurfaceInfo(handle: BackendSurfaceHandle): BackendSurfaceInfo {
    const record = this.#surfaces.get(handle);
    if (record === undefined) {
      throw new KyxosEngineError('Mock surface handle is stale or foreign.', {
        code: 'INVALID_ARGUMENT',
        module: 'backend',
        recoverable: false,
      });
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
    ) {
      throw new KyxosEngineError('Mock Buffer write is invalid or uses a foreign Handle.', {
        code: 'INVALID_ARGUMENT',
        module: 'backend',
        recoverable: false,
      });
    }
  }

  executeFrame(submission: BackendFrameSubmission): BackendRenderPassStatistics {
    this.#assertReady('execute a frame');
    if (!this.#commandEncoders.has(submission.commandEncoder)) {
      throw new KyxosEngineError('Mock Command Encoder Handle is stale or foreign.', {
        code: 'INVALID_ARGUMENT',
        module: 'backend',
        recoverable: false,
      });
    }
    let drawCalls = 0;
    let instances = 0;
    let triangles = 0;
    let vertices = 0;
    for (const renderPass of submission.renderPasses) {
      if (this.getSurfaceInfo(renderPass.surface).size.suspended) {
        throw new KyxosEngineError('Mock Surface is suspended.', {
          code: 'INVALID_STATE',
          module: 'backend',
          recoverable: true,
        });
      }
      for (const draw of renderPass.draws ?? []) {
        const pipeline = this.#pipelines.get(draw.pipeline);
        if (pipeline === undefined) {
          throw new KyxosEngineError('Mock Pipeline Handle is stale or foreign.', {
            code: 'INVALID_ARGUMENT',
            module: 'backend',
            recoverable: false,
          });
        }
        for (const binding of draw.vertexBuffers ?? []) {
          if (!this.#buffers.has(binding.buffer)) {
            throw new KyxosEngineError('Mock Vertex Buffer Handle is stale or foreign.', {
              code: 'INVALID_ARGUMENT',
              module: 'backend',
              recoverable: false,
            });
          }
        }
        if (draw.indexBuffer !== undefined && !this.#buffers.has(draw.indexBuffer.buffer)) {
          throw new KyxosEngineError('Mock Index Buffer Handle is stale or foreign.', {
            code: 'INVALID_ARGUMENT',
            module: 'backend',
            recoverable: false,
          });
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
    this.#buffers.clear();
    this.#commandEncoders.clear();
    this.#pipelines.clear();
    this.#shaderInfo.clear();
    this.#surfaces.clear();
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
