import { KyxosEngineError } from '@kyxos/render-core';
import type { Disposable } from '@kyxos/render-core';
import { inverseMat4, multiplyMat4 } from '@kyxos/render-math';
import type { Mat4 } from '@kyxos/render-math';
import { temporalJitterToNdc } from '@kyxos/render-temporal';
import type {
  TemporalJitterNdc,
  TemporalJitterSample,
  TemporalVec2,
  TemporalViewportSize,
} from '@kyxos/render-temporal';

import type { PerspectiveCamera } from './perspective-camera.js';

export type TemporalCameraResetReason =
  'first-frame' | 'history-generation' | 'projection' | 'viewport';

export interface TemporalCameraMatrixTrackerOptions {
  /** Caller-owned Camera. The tracker never disposes it. */
  readonly camera: PerspectiveCamera;
}

export interface TemporalCameraFrameOptions {
  readonly historyGeneration: number;
  readonly jitter?: TemporalJitterSample;
  readonly viewport: TemporalViewportSize;
}

export interface TemporalCameraFrameMatrices {
  readonly cameraRevision: number;
  readonly currentViewProjection: Mat4;
  readonly currentInverseViewProjection: Mat4;
  readonly historyGeneration: number;
  readonly historyReset: boolean;
  readonly historyResetReason: TemporalCameraResetReason | null;
  readonly jitter: TemporalJitterNdc;
  readonly jitteredProjection: Mat4;
  readonly previousCameraRevision: number;
  readonly previousJitterNdcOffset: TemporalVec2;
  readonly previousUnjitteredViewProjection: Mat4;
  readonly previousViewProjection: Mat4;
  readonly unjitteredProjection: Mat4;
  readonly unjitteredViewProjection: Mat4;
  readonly view: Mat4;
  readonly viewport: TemporalViewportSize;
}

interface StoredCameraFrame {
  readonly cameraRevision: number;
  readonly currentViewProjection: Mat4;
  readonly historyGeneration: number;
  readonly jitterNdcOffset: TemporalVec2;
  readonly projectionUpdateCount: number;
  readonly unjitteredViewProjection: Mat4;
  readonly viewport: TemporalViewportSize;
}

const ZERO_JITTER = Object.freeze([0, 0]) as TemporalVec2;

function assertHistoryGeneration(generation: number): void {
  if (!Number.isSafeInteger(generation) || generation < 0) {
    throw new KyxosEngineError('Camera historyGeneration must be a non-negative safe integer.', {
      code: 'INVALID_ARGUMENT',
      module: 'camera',
      recoverable: false,
    });
  }
}

function createViewport(viewport: TemporalViewportSize): TemporalViewportSize {
  if (
    !Number.isSafeInteger(viewport.width) ||
    viewport.width <= 0 ||
    !Number.isSafeInteger(viewport.height) ||
    viewport.height <= 0
  ) {
    throw new KyxosEngineError(
      'Temporal Camera viewport must use positive safe-integer dimensions.',
      {
        code: 'INVALID_ARGUMENT',
        module: 'camera',
        recoverable: false,
      },
    );
  }
  return Object.freeze({ height: viewport.height, width: viewport.width });
}

function resetReason(
  previous: StoredCameraFrame | undefined,
  generation: number,
  projectionUpdateCount: number,
  viewport: TemporalViewportSize,
): TemporalCameraResetReason | null {
  if (previous === undefined) return 'first-frame';
  if (previous.historyGeneration !== generation) return 'history-generation';
  if (previous.projectionUpdateCount !== projectionUpdateCount) return 'projection';
  if (previous.viewport.width !== viewport.width || previous.viewport.height !== viewport.height) {
    return 'viewport';
  }
  return null;
}

/** Applies a canonical NDC translation without mutating the unjittered projection. */
export function applyProjectionJitter(projection: Mat4, ndcOffset: TemporalVec2): Mat4 {
  const [x, y] = ndcOffset;
  if (![x, y].every(Number.isFinite) || Math.abs(x) > 1 || Math.abs(y) > 1) {
    throw new KyxosEngineError('Projection jitter NDC offsets must be finite within [-1, 1].', {
      code: 'INVALID_ARGUMENT',
      module: 'camera',
      recoverable: false,
    });
  }
  if (x === 0 && y === 0) return projection;
  const result = [...projection];
  result[8] = projection[8] - x;
  result[9] = projection[9] - y;
  return Object.freeze(result) as unknown as Mat4;
}

/** CPU matrix history for reprojection. It owns no Camera or GPU resource. */
export class TemporalCameraMatrixTracker implements Disposable {
  readonly #camera: PerspectiveCamera;
  #disposed = false;
  #previous: StoredCameraFrame | undefined;

  constructor(options: TemporalCameraMatrixTrackerOptions) {
    this.#camera = options.camera;
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  update(options: TemporalCameraFrameOptions): TemporalCameraFrameMatrices {
    this.#assertActive();
    assertHistoryGeneration(options.historyGeneration);
    const viewport = createViewport(options.viewport);
    const jitter =
      options.jitter === undefined
        ? Object.freeze({
            ndcOffset: ZERO_JITTER,
            rasterOffsetPixels: ZERO_JITTER,
            sampleIndex: 0,
          })
        : temporalJitterToNdc(options.jitter, viewport);
    const view = this.#camera.viewMatrix();
    const unjitteredProjection = this.#camera.projectionMatrix();
    const unjitteredViewProjection = this.#camera.viewProjectionMatrix();
    const cameraDiagnostics = this.#camera.diagnostics();
    const jitteredProjection = applyProjectionJitter(unjitteredProjection, jitter.ndcOffset);
    const currentViewProjection =
      jitteredProjection === unjitteredProjection
        ? unjitteredViewProjection
        : multiplyMat4(jitteredProjection, view);
    const currentInverseViewProjection = inverseMat4(currentViewProjection);
    const reason = resetReason(
      this.#previous,
      options.historyGeneration,
      cameraDiagnostics.projectionMatrixUpdateCount,
      viewport,
    );
    const reusablePrevious = reason === null ? this.#previous : undefined;
    const previousViewProjection = reusablePrevious?.currentViewProjection ?? currentViewProjection;
    const previousCameraRevision = reusablePrevious?.cameraRevision ?? cameraDiagnostics.revision;
    const previousJitterNdcOffset = reusablePrevious?.jitterNdcOffset ?? jitter.ndcOffset;
    const previousUnjitteredViewProjection =
      reusablePrevious?.unjitteredViewProjection ?? unjitteredViewProjection;

    this.#previous = Object.freeze({
      cameraRevision: cameraDiagnostics.revision,
      currentViewProjection,
      historyGeneration: options.historyGeneration,
      jitterNdcOffset: jitter.ndcOffset,
      projectionUpdateCount: cameraDiagnostics.projectionMatrixUpdateCount,
      unjitteredViewProjection,
      viewport,
    });

    return Object.freeze({
      cameraRevision: cameraDiagnostics.revision,
      currentInverseViewProjection,
      currentViewProjection,
      historyGeneration: options.historyGeneration,
      historyReset: reason !== null,
      historyResetReason: reason,
      jitter,
      jitteredProjection,
      previousCameraRevision,
      previousJitterNdcOffset,
      previousUnjitteredViewProjection,
      previousViewProjection,
      unjitteredProjection,
      unjitteredViewProjection,
      view,
      viewport,
    });
  }

  reset(): void {
    this.#assertActive();
    this.#previous = undefined;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#previous = undefined;
    this.#disposed = true;
  }

  #assertActive(): void {
    if (this.#disposed) {
      throw new KyxosEngineError('Temporal Camera matrix tracker is disposed.', {
        code: 'ALREADY_DISPOSED',
        module: 'camera',
        recoverable: false,
      });
    }
  }
}
