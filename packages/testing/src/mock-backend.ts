import type {
  BackendCapabilityReport,
  BackendEvents,
  BackendLifecycleState,
  BackendLossInfo,
  BackendResourceDescriptor,
  BackendResourceHandle,
  BackendResourceHandleKind,
  BackendResourceKind,
  BackendResourceKindStatistics,
  BackendResourceStatistics,
  BackendSurfaceDescriptor,
  BackendSurfaceHandle,
  BackendSurfaceInfo,
  BackendSurfaceResize,
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
  readonly #events = new TypedEventEmitter<BackendEvents>();
  readonly #resources = new Map<BackendResourceHandle, MockResourceRecord>();
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
