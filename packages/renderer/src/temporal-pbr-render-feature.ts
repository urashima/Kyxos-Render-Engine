import type {
  BackendRenderPassStatistics,
  BackendSurfaceInfo,
  BackendSurfaceResize,
} from '@kyxos/render-backend-api';
import { TemporalCameraMatrixTracker } from '@kyxos/render-camera';
import { KyxosEngineError } from '@kyxos/render-core';
import { inverseMat4 } from '@kyxos/render-math';
import type { Mat4 } from '@kyxos/render-math';
import {
  type TemporalConvergenceOptions,
  type TemporalConvergenceSnapshot,
  type TemporalHistorySignatureDescriptor,
  type TemporalJitterSample,
  type TemporalVec2,
  createTemporalJitterSample,
} from '@kyxos/render-temporal';

import type { DynamicTaaGpuFrame } from './dynamic-taa-gpu-history.js';
import { createTemporalTaaSettings } from './temporal-taa-settings.js';
import type {
  TemporalTaaSettings,
  TemporalTaaSettingsDescriptor,
} from './temporal-taa-settings.js';
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
    readonly taa?: TemporalTaaSettingsDescriptor;
    readonly width: number;
  };

export interface TemporalPbrRenderFeatureDiagnostics {
  readonly pbr: PbrRenderFeatureDiagnostics | null;
  readonly pipeline: TemporalPipelineTransactionDiagnostics;
  readonly taa: TemporalTaaSettings;
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

function scaleJitterSample(sample: TemporalJitterSample, scale: number): TemporalJitterSample {
  if (scale === 1) return sample;
  const rasterOffsetPixels = Object.freeze([
    sample.rasterOffsetPixels[0] * scale,
    sample.rasterOffsetPixels[1] * scale,
  ]) as TemporalVec2;
  const unitSample = Object.freeze([
    rasterOffsetPixels[0] + 0.5,
    rasterOffsetPixels[1] + 0.5,
  ]) as TemporalVec2;
  return Object.freeze({
    rasterOffsetPixels,
    sampleIndex: sample.sampleIndex,
    unitSample,
  });
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
  #taaSettings: TemporalTaaSettings;
  #activeCurrentMotionViewProjection: Mat4 | undefined;
  #activeFrame: DynamicTaaGpuFrame | undefined;
  #activePreviousMotionViewProjection: Mat4 | undefined;
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
      taa,
      targetSamples,
      width,
      ...pbrOptions
    } = options;
    this.#signature = signature;
    this.#convergenceError = convergenceError;
    this.#reportConvergence = reportConvergence;
    this.#responsiveMask = responsiveMask;
    this.#taaSettings = createTemporalTaaSettings(taa);
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
        acquireCurrentMotionViewProjectionMatrix: () =>
          this.#requireActiveCurrentMotionViewProjection(),
        acquireFrame: () => this.#requireActiveFrame(),
        acquirePreviousMotionViewProjectionMatrix: () =>
          this.#requireActivePreviousMotionViewProjection(),
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

  get taaSettings(): TemporalTaaSettings {
    this.#assertActive();
    return this.#taaSettings;
  }

  setTaaSettings(descriptor: TemporalTaaSettingsDescriptor): TemporalTaaSettings {
    this.#assertActive();
    this.#taaSettings = createTemporalTaaSettings(descriptor, this.#taaSettings);
    return this.#taaSettings;
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
      jitter: scaleJitterSample(
        createTemporalJitterSample(jitterSampleIndex(context)),
        this.#taaSettings.jitterScale,
      ),
      viewport: {
        height: surface.size.physicalHeight,
        width: surface.size.physicalWidth,
      },
    });
    const convergenceError = this.#convergenceError?.(context);
    const result = this.#transaction.execute({
      ...(convergenceError === undefined ? {} : { convergenceError }),
      currentInverseViewProjection: matrices.currentInverseViewProjection,
      currentJitterNdcOffset: matrices.jitter.ndcOffset,
      currentViewProjection: matrices.currentViewProjection,
      dirtyFlags: context.dirtyFlags,
      previousInverseViewProjection: inverseMat4(matrices.previousViewProjection),
      previousJitterNdcOffset: matrices.previousJitterNdcOffset,
      previousViewProjection: matrices.previousViewProjection,
      renderCurrent: (frame) => {
        if (
          this.#activeCurrentMotionViewProjection !== undefined ||
          this.#activeFrame !== undefined ||
          this.#activePreviousMotionViewProjection !== undefined ||
          this.#activeViewProjection !== undefined
        ) {
          throw error('Temporal PBR current-frame callback is already active.', 'INVALID_STATE');
        }
        this.#activeCurrentMotionViewProjection = matrices.unjitteredViewProjection;
        this.#activeFrame = frame;
        this.#activePreviousMotionViewProjection = matrices.previousUnjitteredViewProjection;
        this.#activeViewProjection = matrices.currentViewProjection;
        try {
          return this.#pbr.render(context);
        } finally {
          this.#activeCurrentMotionViewProjection = undefined;
          this.#activeFrame = undefined;
          this.#activePreviousMotionViewProjection = undefined;
          this.#activeViewProjection = undefined;
        }
      },
      responsiveMask: Math.max(
        this.#taaSettings.responsiveMask,
        this.#responsiveMask?.(context) ?? 0,
      ),
      signature: this.#signature(context),
      taaResolveOptions: this.#taaSettings.resolve,
      temporal,
    });
    if (temporal.mode === 'accumulating') {
      this.#reportConvergence?.(result.diagnostics.staticHistory.convergence);
    }
    return result.statistics;
  }

  getDiagnostics(): TemporalPbrRenderFeatureDiagnostics {
    this.#assertActive();
    const pipeline = this.#transaction.getDiagnostics();
    return Object.freeze({
      pbr: pipeline.state === 'ready' ? this.#pbr.getDiagnostics() : null,
      pipeline,
      taa: this.#taaSettings,
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
    this.#activeCurrentMotionViewProjection = undefined;
    this.#activeFrame = undefined;
    this.#activePreviousMotionViewProjection = undefined;
    this.#activeViewProjection = undefined;
    this.#cameraTracker.reset();
    this.#transaction.cancelFrame();
    this.#pbr.onBackendLost();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#activeCurrentMotionViewProjection = undefined;
    this.#activeFrame = undefined;
    this.#activePreviousMotionViewProjection = undefined;
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

  #requireActiveCurrentMotionViewProjection(): Mat4 {
    const matrix = this.#activeCurrentMotionViewProjection;
    if (matrix === undefined) {
      throw error(
        'Temporal PBR current Motion View-Projection is unavailable outside the current transaction.',
        'INVALID_STATE',
      );
    }
    return matrix;
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

  #requireActivePreviousMotionViewProjection(): Mat4 {
    const matrix = this.#activePreviousMotionViewProjection;
    if (matrix === undefined) {
      throw error(
        'Temporal PBR previous Motion View-Projection is unavailable outside the current transaction.',
        'INVALID_STATE',
      );
    }
    return matrix;
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
