import type {
  BackendCapabilityReport,
  BackendEvents,
  BackendFeature,
  BackendLifecycleState,
  BackendResourceDescriptor,
  BackendResourceHandle,
  BackendResourceKind,
  BackendResourceStatistics,
  GraphicsBackend,
} from '@kyxos/render-backend-api';
import { BACKEND_FEATURES, createBackendCapabilityReport } from '@kyxos/render-backend-api';
import { KyxosEngineError, TypedEventEmitter, toKyxosEngineError } from '@kyxos/render-core';
import type { EventListener, Unsubscribe } from '@kyxos/render-core';

import { createBrowserWebGpuPlatform } from './browser-platform.js';
import type { WebGpuDevicePort, WebGpuPlatformPort, WebGpuPowerPreference } from './platform.js';
import { WebGpuResourceRegistry } from './resource-registry.js';

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

  destroyResource(handle: BackendResourceHandle): boolean {
    return this.#resources.destroy(handle);
  }

  getResourceStatistics(): BackendResourceStatistics {
    return this.#resources.getStatistics();
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
