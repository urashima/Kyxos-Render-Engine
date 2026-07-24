import { replaceExact } from './helpers.mjs';

await replaceExact(
  'packages/renderer/src/temporal-pipeline-transaction.ts',
  `  TemporalHistorySignatureDescriptor,
  TemporalTaaResolveOptions,
} from '@kyxos/render-temporal';`,
  `  TemporalHistorySignatureDescriptor,
  TemporalVec2,
} from '@kyxos/render-temporal';`,
);
await replaceExact(
  'packages/renderer/src/temporal-pipeline-transaction.ts',
  `import { StaticAccumulationPass } from './static-accumulation-pass.js';`,
  `import { StaticAccumulationPass } from './static-accumulation-pass.js';
import type { TemporalTaaResolveSettings } from './temporal-taa-settings.js';`,
);
await replaceExact(
  'packages/renderer/src/temporal-pipeline-transaction.ts',
  `export interface TemporalPipelineExecuteInput {
  readonly convergenceError?: number;
  readonly currentInverseViewProjection: Mat4;
  readonly dirtyFlags: readonly DirtyFlag[];
  readonly previousViewProjection: Mat4;
  readonly renderCurrent: (frame: DynamicTaaGpuFrame) => BackendRenderPassStatistics;
  readonly responsiveMask?: number;
  readonly signature: TemporalHistorySignatureDescriptor;
  readonly taaResolveOptions?: Partial<TemporalTaaResolveOptions>;
  readonly temporal: TemporalFrameMetadata;
}`,
  `export interface TemporalPipelineExecuteInput {
  readonly convergenceError?: number;
  readonly currentInverseViewProjection: Mat4;
  readonly currentJitterNdcOffset?: TemporalVec2;
  readonly currentViewProjection: Mat4;
  readonly dirtyFlags: readonly DirtyFlag[];
  readonly previousInverseViewProjection: Mat4;
  readonly previousJitterNdcOffset?: TemporalVec2;
  readonly previousViewProjection: Mat4;
  readonly renderCurrent: (frame: DynamicTaaGpuFrame) => BackendRenderPassStatistics;
  readonly responsiveMask?: number;
  readonly signature: TemporalHistorySignatureDescriptor;
  readonly taaResolveOptions?: Partial<TemporalTaaResolveSettings>;
  readonly temporal: TemporalFrameMetadata;
}`,
);
await replaceExact(
  'packages/renderer/src/temporal-pipeline-transaction.ts',
  `        this.#resolve.execute({
          currentInverseViewProjection: input.currentInverseViewProjection,
          frame: dynamicFrame,
          ...(input.taaResolveOptions === undefined ? {} : { options: input.taaResolveOptions }),
          previousViewProjection: input.previousViewProjection,
          ...(input.responsiveMask === undefined ? {} : { responsiveMask: input.responsiveMask }),
        }),`,
  `        this.#resolve.execute({
          currentInverseViewProjection: input.currentInverseViewProjection,
          ...(input.currentJitterNdcOffset === undefined
            ? {}
            : { currentJitterNdcOffset: input.currentJitterNdcOffset }),
          currentViewProjection: input.currentViewProjection,
          frame: dynamicFrame,
          ...(input.taaResolveOptions === undefined ? {} : { options: input.taaResolveOptions }),
          previousInverseViewProjection: input.previousInverseViewProjection,
          ...(input.previousJitterNdcOffset === undefined
            ? {}
            : { previousJitterNdcOffset: input.previousJitterNdcOffset }),
          previousViewProjection: input.previousViewProjection,
          ...(input.responsiveMask === undefined ? {} : { responsiveMask: input.responsiveMask }),
        }),`,
);

await replaceExact(
  'packages/renderer/src/temporal-pbr-render-feature.ts',
  `import type { Mat4 } from '@kyxos/render-math';`,
  `import { inverseMat4 } from '@kyxos/render-math';
import type { Mat4 } from '@kyxos/render-math';`,
);
await replaceExact(
  'packages/renderer/src/temporal-pbr-render-feature.ts',
  `  #taaSettings: TemporalTaaSettings;
  #activeFrame: DynamicTaaGpuFrame | undefined;
  #activeViewProjection: Mat4 | undefined;`,
  `  #taaSettings: TemporalTaaSettings;
  #activeCurrentMotionViewProjection: Mat4 | undefined;
  #activeFrame: DynamicTaaGpuFrame | undefined;
  #activePreviousMotionViewProjection: Mat4 | undefined;
  #activeViewProjection: Mat4 | undefined;`,
);
await replaceExact(
  'packages/renderer/src/temporal-pbr-render-feature.ts',
  `      dynamicTaaOutput: {
        acquireFrame: () => this.#requireActiveFrame(),
        acquireViewProjectionMatrix: () => this.#requireActiveViewProjection(),`,
  `      dynamicTaaOutput: {
        acquireCurrentMotionViewProjectionMatrix: () =>
          this.#requireActiveCurrentMotionViewProjection(),
        acquireFrame: () => this.#requireActiveFrame(),
        acquirePreviousMotionViewProjectionMatrix: () =>
          this.#requireActivePreviousMotionViewProjection(),
        acquireViewProjectionMatrix: () => this.#requireActiveViewProjection(),`,
);
await replaceExact(
  'packages/renderer/src/temporal-pbr-render-feature.ts',
  `      currentInverseViewProjection: matrices.currentInverseViewProjection,
      dirtyFlags: context.dirtyFlags,
      previousViewProjection: matrices.previousViewProjection,`,
  `      currentInverseViewProjection: matrices.currentInverseViewProjection,
      currentJitterNdcOffset: matrices.jitter.ndcOffset,
      currentViewProjection: matrices.currentViewProjection,
      dirtyFlags: context.dirtyFlags,
      previousInverseViewProjection: inverseMat4(matrices.previousViewProjection),
      previousJitterNdcOffset: matrices.previousJitterNdcOffset,
      previousViewProjection: matrices.previousViewProjection,`,
);
await replaceExact(
  'packages/renderer/src/temporal-pbr-render-feature.ts',
  `        if (this.#activeFrame !== undefined || this.#activeViewProjection !== undefined) {
          throw error('Temporal PBR current-frame callback is already active.', 'INVALID_STATE');
        }
        this.#activeFrame = frame;
        this.#activeViewProjection = matrices.currentViewProjection;`,
  `        if (
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
        this.#activeViewProjection = matrices.currentViewProjection;`,
);
await replaceExact(
  'packages/renderer/src/temporal-pbr-render-feature.ts',
  `        } finally {
          this.#activeFrame = undefined;
          this.#activeViewProjection = undefined;
        }`,
  `        } finally {
          this.#activeCurrentMotionViewProjection = undefined;
          this.#activeFrame = undefined;
          this.#activePreviousMotionViewProjection = undefined;
          this.#activeViewProjection = undefined;
        }`,
);
await replaceExact(
  'packages/renderer/src/temporal-pbr-render-feature.ts',
  `    this.#activeFrame = undefined;
    this.#activeViewProjection = undefined;
    this.#cameraTracker.reset();`,
  `    this.#activeCurrentMotionViewProjection = undefined;
    this.#activeFrame = undefined;
    this.#activePreviousMotionViewProjection = undefined;
    this.#activeViewProjection = undefined;
    this.#cameraTracker.reset();`,
);
await replaceExact(
  'packages/renderer/src/temporal-pbr-render-feature.ts',
  `    this.#activeFrame = undefined;
    this.#activeViewProjection = undefined;
    const errors: unknown[] = [];`,
  `    this.#activeCurrentMotionViewProjection = undefined;
    this.#activeFrame = undefined;
    this.#activePreviousMotionViewProjection = undefined;
    this.#activeViewProjection = undefined;
    const errors: unknown[] = [];`,
);
await replaceExact(
  'packages/renderer/src/temporal-pbr-render-feature.ts',
  `  #requireActiveFrame(): DynamicTaaGpuFrame {`,
  `  #requireActiveCurrentMotionViewProjection(): Mat4 {
    const matrix = this.#activeCurrentMotionViewProjection;
    if (matrix === undefined) {
      throw error(
        'Temporal PBR current Motion View-Projection is unavailable outside the current transaction.',
        'INVALID_STATE',
      );
    }
    return matrix;
  }

  #requireActiveFrame(): DynamicTaaGpuFrame {`,
);
await replaceExact(
  'packages/renderer/src/temporal-pbr-render-feature.ts',
  `  #requireActiveViewProjection(): Mat4 {`,
  `  #requireActivePreviousMotionViewProjection(): Mat4 {
    const matrix = this.#activePreviousMotionViewProjection;
    if (matrix === undefined) {
      throw error(
        'Temporal PBR previous Motion View-Projection is unavailable outside the current transaction.',
        'INVALID_STATE',
      );
    }
    return matrix;
  }

  #requireActiveViewProjection(): Mat4 {`,
);
