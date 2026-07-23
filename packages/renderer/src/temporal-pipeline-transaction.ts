import type {
  BackendRenderPassStatistics,
  BackendSurfaceDescriptor,
  GraphicsBackend,
} from '@kyxos/render-backend-api';
import type { DirtyFlag, TemporalFrameMetadata } from '@kyxos/render-frame-scheduler';
import { KyxosEngineError } from '@kyxos/render-core';
import type { Disposable } from '@kyxos/render-core';
import type { PbrOutputTransformDescriptor } from '@kyxos/render-material-pbr';
import type { Mat4 } from '@kyxos/render-math';
import type {
  TemporalConvergenceOptions,
  TemporalHistoryInvalidationReason,
  TemporalHistorySignatureDescriptor,
} from '@kyxos/render-temporal';

import { DynamicTaaGpuHistory } from './dynamic-taa-gpu-history.js';
import type { DynamicTaaGpuFrame } from './dynamic-taa-gpu-history.js';
import { DynamicTaaPresentPass } from './dynamic-taa-present-pass.js';
import { DynamicTaaResolvePass } from './dynamic-taa-resolve-pass.js';
import { StaticAccumulationGpuHistory } from './static-accumulation-gpu-history.js';
import { StaticAccumulationPass } from './static-accumulation-pass.js';

const EMPTY_STATISTICS: BackendRenderPassStatistics = Object.freeze({
  drawCalls: 0,
  instances: 0,
  triangles: 0,
  vertices: 0,
});

const HISTORY_RESET_PRIORITY: readonly DirtyFlag[] = Object.freeze([
  'viewport',
  'camera',
  'animation',
  'transform',
  'geometry',
  'material',
  'texture',
  'environment',
  'light',
  'post-process',
  'accumulation',
]);

export interface TemporalPipelineTransactionOptions extends TemporalConvergenceOptions {
  readonly height: number;
  readonly output?: PbrOutputTransformDescriptor;
  readonly ownerId: string;
  readonly surface: BackendSurfaceDescriptor;
  readonly width: number;
}

export interface TemporalPipelineExecuteInput {
  readonly convergenceError?: number;
  readonly currentInverseViewProjection: Mat4;
  readonly dirtyFlags: readonly DirtyFlag[];
  readonly previousViewProjection: Mat4;
  readonly renderCurrent: (frame: DynamicTaaGpuFrame) => BackendRenderPassStatistics;
  readonly responsiveMask?: number;
  readonly signature: TemporalHistorySignatureDescriptor;
  readonly temporal: TemporalFrameMetadata;
}

export interface TemporalPipelineTransactionDiagnostics {
  readonly dynamicHistory: ReturnType<DynamicTaaGpuHistory['getDiagnostics']>;
  readonly historyGeneration: number | null;
  readonly open: boolean;
  readonly ownerId: string;
  readonly present: ReturnType<DynamicTaaPresentPass['getDiagnostics']>;
  readonly resolve: ReturnType<DynamicTaaResolvePass['getDiagnostics']>;
  readonly state: 'detached' | 'disposed' | 'ready';
  readonly staticHistory: ReturnType<StaticAccumulationGpuHistory['getDiagnostics']>;
  readonly staticPass: ReturnType<StaticAccumulationPass['getDiagnostics']>;
}

export interface TemporalPipelineExecuteResult {
  readonly diagnostics: TemporalPipelineTransactionDiagnostics;
  readonly presentedHistory: 'dynamic' | 'static';
  readonly statistics: BackendRenderPassStatistics;
}

interface OpenTemporalTransaction {
  readonly dynamicFrame: DynamicTaaGpuFrame;
  readonly signature: TemporalHistorySignatureDescriptor;
  readonly temporal: TemporalFrameMetadata;
}

function error(
  message: string,
  code: 'ALREADY_DISPOSED' | 'INVALID_ARGUMENT' | 'INVALID_STATE',
  recoverable = false,
): KyxosEngineError {
  return new KyxosEngineError(message, {
    code,
    module: 'renderer',
    recoverable,
  });
}

function addStatistics(
  first: BackendRenderPassStatistics,
  second: BackendRenderPassStatistics,
): BackendRenderPassStatistics {
  return Object.freeze({
    drawCalls: first.drawCalls + second.drawCalls,
    instances: first.instances + second.instances,
    triangles: first.triangles + second.triangles,
    vertices: first.vertices + second.vertices,
  });
}

function resetReason(dirtyFlags: readonly DirtyFlag[]): TemporalHistoryInvalidationReason {
  for (const candidate of HISTORY_RESET_PRIORITY) {
    if (dirtyFlags.includes(candidate)) return candidate as TemporalHistoryInvalidationReason;
  }
  return 'accumulation';
}

function validateConvergenceError(value: number | undefined): void {
  if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
    throw error(
      'Temporal pipeline convergence error must be finite and non-negative.',
      'INVALID_ARGUMENT',
    );
  }
}

/**
 * Owns the ordered temporal transaction around one caller-provided current-frame renderer.
 * The current renderer may be PBR, another Render Feature, or a deterministic test producer.
 */
export class TemporalPipelineTransaction implements Disposable {
  readonly #dynamicHistory: DynamicTaaGpuHistory;
  readonly #ownerId: string;
  readonly #present: DynamicTaaPresentPass;
  readonly #resolve: DynamicTaaResolvePass;
  readonly #staticHistory: StaticAccumulationGpuHistory;
  readonly #staticPass: StaticAccumulationPass;
  #backend: GraphicsBackend | undefined;
  #disposed = false;
  #historyGeneration: number | undefined;
  #open: OpenTemporalTransaction | undefined;

  constructor(options: TemporalPipelineTransactionOptions) {
    this.#ownerId = options.ownerId.trim();
    if (this.#ownerId.length === 0) {
      throw error('Temporal pipeline ownerId must not be empty.', 'INVALID_ARGUMENT');
    }
    this.#dynamicHistory = new DynamicTaaGpuHistory({
      height: options.height,
      ownerId: this.#ownerId,
      width: options.width,
    });
    this.#resolve = new DynamicTaaResolvePass({ ownerId: this.#ownerId });
    this.#staticHistory = new StaticAccumulationGpuHistory({
      ...(options.errorThreshold === undefined ? {} : { errorThreshold: options.errorThreshold }),
      height: options.height,
      ...(options.minimumSamples === undefined ? {} : { minimumSamples: options.minimumSamples }),
      ownerId: this.#ownerId,
      ...(options.stableSamples === undefined ? {} : { stableSamples: options.stableSamples }),
      targetSamples: options.targetSamples,
      width: options.width,
    });
    this.#staticPass = new StaticAccumulationPass({ ownerId: this.#ownerId });
    this.#present = new DynamicTaaPresentPass({
      ...(options.output === undefined ? {} : { output: options.output }),
      ownerId: this.#ownerId,
      surface: options.surface,
    });
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  async initialize(backend: GraphicsBackend): Promise<void> {
    this.#assertActive();
    if (backend.state !== 'ready') {
      throw error('Temporal pipeline requires a ready Backend.', 'INVALID_STATE', true);
    }
    if (this.#backend === backend && this.getDiagnostics().state === 'ready') return;
    if (this.#backend !== undefined && this.#backend !== backend) {
      throw error('Temporal pipeline is attached to another Backend.', 'INVALID_STATE');
    }

    this.#dynamicHistory.initialize(backend);
    await this.#resolve.initialize(backend);
    this.#staticHistory.initialize(backend);
    await this.#staticPass.initialize(backend);
    await this.#present.initialize(backend);
    this.#backend = backend;
  }

  execute(input: TemporalPipelineExecuteInput): TemporalPipelineExecuteResult {
    this.#assertActive();
    if (this.#backend === undefined || this.getDiagnostics().state !== 'ready') {
      throw error('Temporal pipeline resources are unavailable.', 'INVALID_STATE', true);
    }
    if (this.#open !== undefined) {
      throw error('Temporal pipeline already has an open frame.', 'INVALID_STATE');
    }
    if (
      input.temporal.targetSamples !==
      this.#staticHistory.getDiagnostics().convergence.targetSamples
    ) {
      throw error(
        'Temporal scheduler targetSamples must match Static Accumulation targetSamples.',
        'INVALID_ARGUMENT',
      );
    }
    validateConvergenceError(input.convergenceError);

    if (
      input.temporal.historyReset ||
      (this.#historyGeneration !== undefined &&
        input.temporal.historyGeneration !== this.#historyGeneration)
    ) {
      const reason = resetReason(input.dirtyFlags);
      this.#dynamicHistory.invalidate(reason);
      this.#staticHistory.invalidate(reason);
    }
    this.#historyGeneration = input.temporal.historyGeneration;

    const dynamicFrame = this.#dynamicHistory.prepareFrame(input.signature);
    this.#open = Object.freeze({
      dynamicFrame,
      signature: input.signature,
      temporal: input.temporal,
    });

    let statistics = EMPTY_STATISTICS;
    let staticPrepared = false;
    try {
      statistics = addStatistics(statistics, input.renderCurrent(dynamicFrame));
      statistics = addStatistics(
        statistics,
        this.#resolve.execute({
          currentInverseViewProjection: input.currentInverseViewProjection,
          frame: dynamicFrame,
          previousViewProjection: input.previousViewProjection,
          ...(input.responsiveMask === undefined ? {} : { responsiveMask: input.responsiveMask }),
        }),
      );

      let presentedHistory: TemporalPipelineExecuteResult['presentedHistory'] = 'dynamic';
      if (input.temporal.mode === 'accumulating') {
        const staticFrame = this.#staticHistory.prepareFrame(input.signature);
        staticPrepared = true;
        statistics = addStatistics(
          statistics,
          this.#staticPass.execute({
            currentColorTexture: dynamicFrame.writeColorTexture,
            frame: staticFrame,
          }),
        );
        statistics = addStatistics(statistics, this.#present.execute({ frame: staticFrame }));
        this.#staticHistory.commitFrame(input.convergenceError);
        staticPrepared = false;
        presentedHistory = 'static';
      } else {
        statistics = addStatistics(statistics, this.#present.execute({ frame: dynamicFrame }));
      }

      this.#dynamicHistory.commitFrame();
      this.#open = undefined;
      return Object.freeze({
        diagnostics: this.getDiagnostics(),
        presentedHistory,
        statistics,
      });
    } catch (cause) {
      if (staticPrepared) this.#staticHistory.cancelFrame();
      this.#dynamicHistory.cancelFrame();
      this.#open = undefined;
      throw cause;
    }
  }

  cancelFrame(): void {
    this.#assertActive();
    if (this.#open === undefined) return;
    if (this.#staticHistory.getDiagnostics().frameOpen) this.#staticHistory.cancelFrame();
    if (this.#dynamicHistory.getDiagnostics().frameOpen) this.#dynamicHistory.cancelFrame();
    this.#open = undefined;
  }

  getDiagnostics(): TemporalPipelineTransactionDiagnostics {
    const dynamicHistory = this.#dynamicHistory.getDiagnostics();
    const resolve = this.#resolve.getDiagnostics();
    const staticHistory = this.#staticHistory.getDiagnostics();
    const staticPass = this.#staticPass.getDiagnostics();
    const present = this.#present.getDiagnostics();
    const ready =
      dynamicHistory.state === 'ready' &&
      resolve.state === 'ready' &&
      staticHistory.state === 'ready' &&
      staticPass.state === 'ready' &&
      present.state === 'ready';
    return Object.freeze({
      dynamicHistory,
      historyGeneration: this.#historyGeneration ?? null,
      open: this.#open !== undefined,
      ownerId: this.#ownerId,
      present,
      resolve,
      state: this.#disposed ? 'disposed' : ready ? 'ready' : 'detached',
      staticHistory,
      staticPass,
    });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.cancelFrame();
    this.#disposed = true;
    this.#backend = undefined;
    const errors: unknown[] = [];
    for (const target of [
      this.#present,
      this.#staticPass,
      this.#staticHistory,
      this.#resolve,
      this.#dynamicHistory,
    ]) {
      try {
        target.dispose();
      } catch (cause) {
        errors.push(cause);
      }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(errors, 'Temporal pipeline disposal failed.');
    }
  }

  #assertActive(): void {
    if (this.#disposed) {
      throw error('Temporal pipeline is disposed.', 'ALREADY_DISPOSED');
    }
  }
}
