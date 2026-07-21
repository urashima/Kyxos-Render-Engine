import type {
  BackendResourceDescriptor,
  BackendResourceHandle,
  BackendResourceHandleKind,
  BackendResourceKind,
  BackendResourceKindStatistics,
  BackendResourceStatistics,
} from '@kyxos/render-backend-api';
import { BACKEND_RESOURCE_KINDS, backendResourceHandleKind } from '@kyxos/render-backend-api';
import { HandleAllocator, KyxosEngineError } from '@kyxos/render-core';

interface ResourceRecord<NativeResource = unknown> {
  readonly destroyNative: (() => void) | undefined;
  readonly estimatedBytes: number;
  readonly handle: BackendResourceHandle;
  readonly kind: BackendResourceKind;
  readonly label: string | undefined;
  readonly native: NativeResource;
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

export class WebGpuResourceRegistry {
  readonly #allocators = createAllocators();
  readonly #resources = new Map<BackendResourceHandle, ResourceRecord>();
  #createdTotal = 0;
  #destroyedTotal = 0;

  register<Kind extends BackendResourceKind, NativeResource>(
    kind: Kind,
    descriptor: BackendResourceDescriptor,
    native: NativeResource,
    destroyNative?: () => void,
  ): BackendResourceHandle<Kind> {
    const estimatedBytes = descriptor.estimatedBytes ?? 0;
    validateEstimatedBytes(estimatedBytes);
    const allocator = this.#allocators.get(kind);
    if (allocator === undefined) {
      throw new KyxosEngineError(`Unsupported WebGPU resource kind: "${kind}".`, {
        code: 'INVALID_ARGUMENT',
        module: 'backend',
        recoverable: false,
      });
    }

    const handle = allocator.create() as BackendResourceHandle<Kind>;
    this.#resources.set(handle, {
      destroyNative,
      estimatedBytes,
      handle,
      kind,
      label: descriptor.label,
      native,
    });
    this.#createdTotal += 1;
    return handle;
  }

  resolve<Kind extends BackendResourceKind, NativeResource>(
    handle: BackendResourceHandle<Kind>,
    expectedKind: Kind,
  ): NativeResource {
    const record = this.#resources.get(handle);
    if (record === undefined || record.kind !== expectedKind) {
      throw new KyxosEngineError(
        `WebGPU ${expectedKind} handle is stale, foreign, or has the wrong resource kind.`,
        {
          code: 'INVALID_ARGUMENT',
          module: 'backend',
          recoverable: false,
        },
      );
    }
    return record.native as NativeResource;
  }

  destroy(handle: BackendResourceHandle): boolean {
    const record = this.#resources.get(handle);
    if (record === undefined) {
      return false;
    }

    try {
      record.destroyNative?.();
    } catch (cause) {
      throw new KyxosEngineError(
        `Failed to dispose WebGPU ${record.kind} resource${record.label === undefined ? '' : ` "${record.label}"`}.`,
        {
          cause,
          code: 'RESOURCE_DISPOSE_FAILED',
          module: 'backend',
          recoverable: false,
        },
      );
    }

    this.#resources.delete(handle);
    this.#destroyedTotal += 1;
    return true;
  }

  releaseAll(destroyNative: boolean): void {
    const errors: unknown[] = [];
    for (const record of [...this.#resources.values()]) {
      if (!destroyNative) {
        this.#resources.delete(record.handle);
        this.#destroyedTotal += 1;
        continue;
      }

      try {
        this.destroy(record.handle);
      } catch (error) {
        errors.push(error);
      }
    }

    if (errors.length === 1) {
      throw errors[0];
    }
    if (errors.length > 1) {
      throw new AggregateError(errors, 'Multiple WebGPU resources failed to dispose.');
    }
  }

  getStatistics(): BackendResourceStatistics {
    const mutableByKind = Object.fromEntries(
      BACKEND_RESOURCE_KINDS.map((kind) => [kind, { activeCount: 0, activeEstimatedBytes: 0 }]),
    ) as Record<BackendResourceKind, { activeCount: number; activeEstimatedBytes: number }>;
    let activeEstimatedBytes = 0;
    for (const record of this.#resources.values()) {
      mutableByKind[record.kind].activeCount += 1;
      mutableByKind[record.kind].activeEstimatedBytes += record.estimatedBytes;
      activeEstimatedBytes += record.estimatedBytes;
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
}
