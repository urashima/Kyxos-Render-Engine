import type {
  BackendCapabilityReport,
  BackendLossInfo,
  BackendRenderPassStatistics,
  BackendResourceStatistics,
  BackendType,
  GraphicsBackend,
} from '@kyxos/render-backend-api';
import { FrameScheduler } from '@kyxos/render-frame-scheduler';
import type {
  DirtyFlag,
  FrameRequestDriver,
  RenderMode,
  ScheduledFrame,
} from '@kyxos/render-frame-scheduler';
import {
  DisposeBag,
  KyxosEngineError,
  TypedEventEmitter,
  toKyxosEngineError,
} from '@kyxos/render-core';
import type { Disposable, EventListener, Unsubscribe } from '@kyxos/render-core';

import type {
  AssetDecoder,
  MaterialExtension,
  PreviewPreset,
  RenderFeature,
} from './extensions.js';
import { ExtensionRegistry } from './extensions.js';

export type RendererLifecycleState = 'disposed' | 'initializing' | 'lost' | 'new' | 'ready';

export interface RendererFrameEvent extends ScheduledFrame {
  readonly frameIndex: number;
  readonly statistics: BackendRenderPassStatistics;
}

export interface RendererEvents {
  readonly 'device-lost': BackendLossInfo;
  readonly error: KyxosEngineError;
  readonly frame: RendererFrameEvent;
  readonly ready: undefined;
  readonly sleep: undefined;
  readonly wake: { readonly dirtyFlag: DirtyFlag };
}

export interface RendererRegistrationCounts {
  readonly assetDecoders: number;
  readonly materialExtensions: number;
  readonly previewPresets: number;
  readonly renderFeatures: number;
}

export interface RendererDiagnostics {
  readonly backend: {
    readonly capabilities: BackendCapabilityReport;
    readonly resources: BackendResourceStatistics;
    readonly type: BackendType;
  };
  readonly frameIndex: number;
  readonly lastCpuFrameTimeMs: number;
  readonly lastFrameStatistics: BackendRenderPassStatistics;
  readonly registrations: RendererRegistrationCounts;
  readonly renderMode: RenderMode;
  readonly state: RendererLifecycleState;
}

export interface KyxosRendererOptions {
  readonly backend: GraphicsBackend;
  readonly frameDriver: FrameRequestDriver;
  readonly now?: () => number;
}

const EMPTY_FRAME_STATISTICS: BackendRenderPassStatistics = Object.freeze({
  drawCalls: 0,
  instances: 0,
  triangles: 0,
  vertices: 0,
});

function addFrameStatistics(
  target: BackendRenderPassStatistics,
  addition: BackendRenderPassStatistics,
): BackendRenderPassStatistics {
  const result = {
    drawCalls: target.drawCalls + addition.drawCalls,
    instances: target.instances + addition.instances,
    triangles: target.triangles + addition.triangles,
    vertices: target.vertices + addition.vertices,
  };
  if (Object.values(result).some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new KyxosEngineError('Renderer frame statistics exceed the safe integer range.', {
      code: 'INTERNAL_ERROR',
      module: 'renderer',
      recoverable: false,
    });
  }
  return Object.freeze(result);
}

export class KyxosRenderer implements Disposable {
  readonly #assetDecoders = new ExtensionRegistry<AssetDecoder>('asset-decoder');
  readonly #backend: GraphicsBackend;
  readonly #events = new TypedEventEmitter<RendererEvents>();
  readonly #frameScheduler: FrameScheduler;
  readonly #materialExtensions = new ExtensionRegistry<MaterialExtension>('material-extension');
  readonly #now: () => number;
  readonly #owned = new DisposeBag();
  readonly #previewPresets = new ExtensionRegistry<PreviewPreset>('preview-preset');
  readonly #renderFeatures = new ExtensionRegistry<RenderFeature>('render-feature');
  #frameIndex = 0;
  #lastCpuFrameTimeMs = 0;
  #lastFrameStatistics = EMPTY_FRAME_STATISTICS;
  #state: RendererLifecycleState = 'new';

  constructor(options: KyxosRendererOptions) {
    this.#backend = options.backend;
    this.#now = options.now ?? (() => performance.now());
    this.#frameScheduler = new FrameScheduler({
      driver: options.frameDriver,
      onFrame: (frame) => this.#onFrame(frame),
    });

    this.#owned.add(this.#backend.on('lost', (loss) => this.#onBackendLost(loss)));
    this.#owned.add(this.#frameScheduler.on('wake', (event) => this.#events.emit('wake', event)));
    this.#owned.add(this.#frameScheduler.on('sleep', () => this.#events.emit('sleep', undefined)));
  }

  get disposed(): boolean {
    return this.#state === 'disposed';
  }

  get state(): RendererLifecycleState {
    return this.#state;
  }

  async initialize(): Promise<void> {
    if (this.#state === 'ready') {
      return;
    }

    if (this.#state === 'disposed') {
      throw new KyxosEngineError('Cannot initialize a disposed renderer.', {
        code: 'ALREADY_DISPOSED',
        module: 'renderer',
        recoverable: false,
      });
    }

    this.#state = 'initializing';
    try {
      await this.#backend.initialize();
      for (const feature of this.#renderFeatures.values()) {
        await feature.initialize?.({ backend: this.#backend });
      }
      this.#state = 'ready';
      this.#events.emit('ready', undefined);
    } catch (error) {
      this.#state = this.#backend.state === 'lost' ? 'lost' : 'new';
      const engineError = toKyxosEngineError(error, {
        code: 'BACKEND_INITIALIZATION_FAILED',
        message: 'Renderer backend initialization failed.',
        module: 'renderer',
        recoverable: true,
        suggestedAction: 'Inspect backend capabilities and choose an available fallback.',
      });
      this.#events.emit('error', engineError);
      throw engineError;
    }
  }

  on<EventName extends keyof RendererEvents>(
    eventName: EventName,
    listener: EventListener<RendererEvents[EventName]>,
  ): Unsubscribe {
    return this.#events.on(eventName, listener);
  }

  invalidate(dirtyFlag: DirtyFlag): void {
    if (this.#state !== 'ready') {
      throw new KyxosEngineError(
        `Renderer must be ready before invalidation; current state is "${this.#state}".`,
        {
          code: this.#state === 'disposed' ? 'ALREADY_DISPOSED' : 'INVALID_STATE',
          module: 'renderer',
          recoverable: false,
        },
      );
    }

    this.#frameScheduler.invalidate(dirtyFlag);
  }

  registerRenderFeature(feature: RenderFeature): Unsubscribe {
    return this.#renderFeatures.register(feature);
  }

  registerMaterialExtension(extension: MaterialExtension): Unsubscribe {
    return this.#materialExtensions.register(extension);
  }

  registerAssetDecoder(decoder: AssetDecoder): Unsubscribe {
    return this.#assetDecoders.register(decoder);
  }

  registerPreviewPreset(preset: PreviewPreset): Unsubscribe {
    return this.#previewPresets.register(preset);
  }

  getDiagnostics(): RendererDiagnostics {
    return Object.freeze({
      backend: Object.freeze({
        capabilities: this.#backend.capabilities,
        resources: this.#backend.getResourceStatistics(),
        type: this.#backend.type,
      }),
      frameIndex: this.#frameIndex,
      lastCpuFrameTimeMs: this.#lastCpuFrameTimeMs,
      lastFrameStatistics: this.#lastFrameStatistics,
      registrations: Object.freeze({
        assetDecoders: this.#assetDecoders.size,
        materialExtensions: this.#materialExtensions.size,
        previewPresets: this.#previewPresets.size,
        renderFeatures: this.#renderFeatures.size,
      }),
      renderMode: this.#frameScheduler.mode,
      state: this.#state,
    });
  }

  dispose(): void {
    if (this.#state === 'disposed') {
      return;
    }

    this.#state = 'disposed';
    const errors: unknown[] = [];
    const targets: readonly Disposable[] = [
      this.#frameScheduler,
      this.#renderFeatures,
      this.#materialExtensions,
      this.#assetDecoders,
      this.#previewPresets,
      this.#owned,
      this.#backend,
      this.#events,
    ];

    for (const target of targets) {
      try {
        target.dispose();
      } catch (error) {
        errors.push(error);
      }
    }

    if (errors.length === 1) {
      throw errors[0];
    }

    if (errors.length > 1) {
      throw new AggregateError(errors, 'Multiple renderer-owned components failed to dispose.');
    }
  }

  #onBackendLost(loss: BackendLossInfo): void {
    if (this.#state === 'disposed') {
      return;
    }

    this.#state = 'lost';
    this.#frameScheduler.suspend();
    for (const feature of this.#renderFeatures.values()) {
      try {
        feature.onBackendLost?.(loss);
      } catch (error) {
        this.#events.emit(
          'error',
          toKyxosEngineError(error, {
            code: 'RESOURCE_DISPOSE_FAILED',
            message: `Render feature "${feature.id}" failed to release lost-device state.`,
            module: 'renderer',
            recoverable: true,
          }),
        );
      }
    }
    this.#events.emit('device-lost', loss);
  }

  #onFrame(frame: ScheduledFrame): void {
    if (this.#state !== 'ready') {
      return;
    }

    const frameIndex = this.#frameIndex + 1;
    const cpuStartedAt = this.#now();
    let statistics = EMPTY_FRAME_STATISTICS;
    for (const feature of this.#renderFeatures.values()) {
      try {
        const result = feature.render?.({
          backend: this.#backend,
          dirtyFlags: frame.dirtyFlags,
          frameIndex,
          timestamp: frame.timestamp,
        });
        if (result !== undefined) {
          statistics = addFrameStatistics(statistics, result);
        }
      } catch (error) {
        this.#events.emit(
          'error',
          toKyxosEngineError(error, {
            code: 'INTERNAL_ERROR',
            message: `Render feature "${feature.id}" failed while rendering a frame.`,
            module: 'renderer',
            recoverable: true,
          }),
        );
      }
    }
    const cpuFrameTimeMs = this.#now() - cpuStartedAt;
    this.#lastCpuFrameTimeMs =
      Number.isFinite(cpuFrameTimeMs) && cpuFrameTimeMs >= 0 ? cpuFrameTimeMs : 0;
    this.#frameIndex = frameIndex;
    this.#lastFrameStatistics = statistics;
    this.#events.emit(
      'frame',
      Object.freeze({
        dirtyFlags: frame.dirtyFlags,
        frameIndex,
        statistics,
        timestamp: frame.timestamp,
      }),
    );
  }
}
