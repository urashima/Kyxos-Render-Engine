import type {
  BackendRenderPassStatistics,
  BackendSurfaceInfo,
  BackendSurfaceResize,
} from '@kyxos/render-backend-api';
import { TemporalCameraMatrixTracker } from '@kyxos/render-camera';
import { KyxosEngineError } from '@kyxos/render-core';
import type { Mat4 } from '@kyxos/render-math';
import {
  type TemporalConvergenceOptions,
  type TemporalConvergenceSnapshot,
  type TemporalHistorySignatureDescriptor,
  createTemporalJitterSample,
} from '@kyxos/render-temporal';

import type { DynamicTaaGpuFrame } from './dynamic-taa-gpu-history.js';
import type {
  RenderFeature,
  RenderFeatureFrameContext,
  RenderFeatureInitializationContext,
} from './extensions.js';
import { PbrRenderFeature } from './pbr-render-feature.js';
import type { PbrRenderFeatureDiagnostics, PbrRenderFeatureOptions } from './pbr-render-feature.js';
import { TemporalPipelineTransaction } from './temporal-pipeline-transaction.js';
import type { TemporalPipelineTransactionDiagnostics } from './temporal-pipeline-transaction.js';

export const TEMPORAL_PBR_RENDER_FEATURE_ID = 'kyxos.pbr-temporal' as const;

const TEMPORAL_JITTER_SEQUENCE_LENGTH = 256;

export type TemporalPbrRenderFeatureOptions = Omit<PbrRenderFeatureOptions, 'dynamicTaaOutput'> &
  TemporalConvergenceOptions & {
    readonly convergenceError?: (context: RenderFeatureFrameContext) => number | undefined;
    readonly height: number;
    readonly ownerId: string;
    readonly reportConvergence?: (snapshot: TemporalConvergenceSnapshot) => void;
    readonly responsiveMask?: (context: RenderFeatureFrameContext) => number;
    readonly signature: (context: RenderFeatureFrameContext) => TemporalHistorySignatureDescriptor;
    readonly width: number;
  };

export interface TemporalPbrRenderFeatureDiagnostics {
  readonly pbr: PbrRenderFeatureDiagnostics;
  readonly pipeline: TemporalPipelineTransactionDiagnostics;
}

function error(message: string, code: 'ALREADY_DISPOSED' | 'INVALID_STATE'): KyxosEngineError {
  return new KyxosEngineError(message, {
    code,
    module: 'renderer',
    recoverable: false,
  });
}

function jitterSampleIndex(context: RenderFeatureFrameContext): number {
  const requested =
    context.temporal?.mode === 'accumulating'
      ? context.temporal.sampleIndex
      : context.frameIndex + 1;
  const positive = Math.max(1, requested);
  return ((positive - 1) % TEMPORAL_JITTER_SEQUENCE_LENGTH) + 1;
}

/**
 * Product-neutral PBR temporal feature.
 *
 * It keeps the accepted direct PBR feature unchanged and composes its opt-in MRT path with the
 * scheduler-driven Dynamic TAA, optional Static Accumulation, and final Present transaction.
 */
export class TemporalPbrRenderFeature implements RenderFeature {
  readonly #cameraTracker: TemporalCameraMatrixTracker;
  readonly #convergenceError:
    ((context: RenderFeatureFrameContext) => number | undefined) | undefined;
  readonly #pbr: PbrRenderFeature;
  readonly #reportConvergence: ((snapshot: TemporalConvergenceSnapshot) => void) | undefined;
  readonly #responsiveMask: ((context: RenderFeatureFrameContext) => number) | undefined;
  readonly #signature: (context: RenderFeatureFrameContext) => TemporalHistorySignatureDescriptor;
  readonly #transaction: TemporalPipelineTransaction;
  readonly id = TEMPORAL_PBR_RENDER_FEATURE_ID;
  #activeFrame: DynamicTaaGpuFrame | undefined;
  #activeViewProjection: Mat4 | undefined;
  #disposed = false;

  constructor(options: TemporalPbrRenderFeatureOptions) {
    const {
      convergenceError,
      errorThreshold,
      height,
      minimumSamples,
      ownerId,
      reportConvergence,
      responsiveMask,
      signature,
      stableSamples,
      targetSamples,
      width,
      ...pbrOptions
    } = options;
    this.#signature = signature;
    this.#convergenceError = convergenceError;
    this.#reportConvergence = reportConvergence;
    this.#responsiveMask = responsiveMask;
    this.#transaction = new TemporalPipelineTransaction({
      ...(errorThreshold === undefined ? {} : { errorThreshold }),
      height,
      ...(minimumSamples === undefined ? {} : { minimumSamples }),
      ...(pbrOptions.output === undefined ? {} : { output: pbrOptions.output }),
      ownerId,
      ...(stableSamples === undefined ? {} : { stableSamples }),
      surface: pbrOptions.surface,
      targetSamples,
      width,
    });
    this.#cameraTracker = new TemporalCameraMatrixTracker({ camera: pbrOptions.camera });
    this.#pbr = new PbrRenderFeature({
      ...pbrOptions,
      dynamicTaaOutput: {
        acquireFrame: () => this.#requireActiveFrame(),
        acquireViewProjectionMatrix: () => this.#requireActiveViewProjection(),
        surface: {
          getSurfaceInfo: () => this.#transaction.getSurfaceInfo(),
          resize: (resize) => this.#transaction.resize(resize),
        },
      },
    });
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  get pbr(): PbrRenderFeature {
    this.#assertActive();
    return this.#pbr;
  }

  async initialize(context: RenderFeatureInitializationContext): Promise<void> {
    this.#assertActive();
    await this.#transaction.initialize(context.backend);
    await this.#pbr.initialize(context);
    const surface = this.#transaction.getSurfaceInfo();
    const dynamicSize = this.#transaction.getDiagnostics().dynamicHistory.size;
    if (
      !surface.size.suspended &&
      (surface.size.physicalWidth !== dynamicSize.width ||
        surface.size.physicalHeight !== dynamicSize.height)
    ) {
      throw new KyxosEngineError(
        `Temporal PBR initial History ${dynamicSize.width}x${dynamicSize.height} does not match Surface ${surface.size.physicalWidth}x${surface.size.physicalHeight}.`,
        {
          code: 'INVALID_ARGUMENT',
          module: 'renderer',
          recoverable: false,
        },
      );
    }
  }

  render(context: RenderFeatureFrameContext): BackendRenderPassStatistics {
    this.#assertActive();
    const temporal = context.temporal;
    if (temporal === undefined) {
      throw error('Temporal PBR requires Temporal Scheduler frame metadata.', 'INVALID_STATE');
    }
    const surface = this.#transaction.getSurfaceInfo();
    if (surface.size.suspended) {
      return Object.freeze({ drawCalls: 0, instances: 0, triangles: 0, vertices: 0 });
    }
    const matrices = this.#cameraTracker.update({
      historyGeneration: temporal.historyGeneration,
      jitter: createTemporalJitterSample(jitterSampleIndex(context)),
      viewport: {
        height: surface.size.physicalHeight,
        width: surface.size.physicalWidth,
      },
    });
    const result = this.#transaction.execute({
      ...(this.#convergenceError === undefined
        ? {}
        : { convergenceError: this.#convergenceError(context) }),
      currentInverseViewProjection: matrices.currentInverseViewProjection,
      dirtyFlags: context.dirtyFlags,
      previousViewProjection: matrices.previousViewProjection,
      renderCurrent: (frame) => {
        if (this.#activeFrame !== undefined || this.#activeViewProjection !== undefined) {
          throw error('Temporal PBR current-frame callback is already active.', 'INVALID_STATE');
        }
        this.#activeFrame = frame;
        this.#activeViewProjection = matrices.currentViewProjection;
        try {
          return this.#pbr.render(context);
        } finally {
          this.#activeFrame = undefined;
          this.#activeViewProjection = undefined;
        }
      },
      ...(this.#responsiveMask === undefined
        ? {}
        : { responsiveMask: this.#responsiveMask(context) }),
      signature: this.#signature(context),
      temporal,
    });
    if (temporal.mode === 'accumulating') {
      this.#reportConvergence?.(result.diagnostics.staticHistory.convergence);
    }
    return result.statistics;
  }

  getDiagnostics(): TemporalPbrRenderFeatureDiagnostics {
    this.#assertActive();
    return Object.freeze({
      pbr: this.#pbr.getDiagnostics(),
      pipeline: this.#transaction.getDiagnostics(),
    });
  }

  getSurfaceInfo(): BackendSurfaceInfo {
    this.#assertActive();
    return this.#transaction.getSurfaceInfo();
  }

  resize(resize: BackendSurfaceResize): BackendSurfaceInfo {
    this.#assertActive();
    return this.#pbr.resize(resize);
  }

  onBackendLost(): void {
    if (this.#disposed) return;
    this.#activeFrame = undefined;
    this.#activeViewProjection = undefined;
    this.#cameraTracker.reset();
    this.#transaction.cancelFrame();
    this.#pbr.onBackendLost();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#activeFrame = undefined;
    this.#activeViewProjection = undefined;
    const errors: unknown[] = [];
    for (const target of [this.#pbr, this.#transaction, this.#cameraTracker]) {
      try {
        target.dispose();
      } catch (cause) {
        errors.push(cause);
      }
    }
    this.#disposed = true;
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(errors, 'Temporal PBR disposal failed.');
    }
  }

  #requireActiveFrame(): DynamicTaaGpuFrame {
    const frame = this.#activeFrame;
    if (frame === undefined) {
      throw error(
        'Temporal PBR frame is unavailable outside the current transaction.',
        'INVALID_STATE',
      );
    }
    return frame;
  }

  #requireActiveViewProjection(): Mat4 {
    const matrix = this.#activeViewProjection;
    if (matrix === undefined) {
      throw error(
        'Temporal PBR View-Projection is unavailable outside the current transaction.',
        'INVALID_STATE',
      );
    }
    return matrix;
  }

  #assertActive(): void {
    if (this.#disposed) {
      throw error('Temporal PBR Render Feature is disposed.', 'ALREADY_DISPOSED');
    }
  }
}
