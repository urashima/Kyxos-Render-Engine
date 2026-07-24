import { replaceExact } from './helpers.mjs';

await replaceExact(
  'packages/renderer/src/temporal-taa-settings.ts',
  `export interface TemporalTaaSettingsDescriptor extends Partial<TemporalTaaResolveOptions> {`,
  `export interface TemporalTaaAdvancedResolveSettings {
  /** Enables closest-depth velocity selection near geometry edges. 0 preserves the accepted Phase 4 path. */
  readonly edgeDepthDifference: number;
  /** Pixel velocity where History is fully replaced by the current frame. */
  readonly maxVelocityLength: number;
  /** Lower bound for current-frame contribution after all History weighting. */
  readonly minimumCurrentWeight: number;
  /** Standard-deviation multiplier for variance clipping. 0 preserves min/max clamping. */
  readonly varianceClipGamma: number;
  /** Strength of subpixel-motion correction. */
  readonly subpixelCorrection: number;
  /** Strength of luminance-weighted HDR flicker suppression. */
  readonly flickerReduction: number;
}

export interface TemporalTaaResolveSettings
  extends TemporalTaaResolveOptions,
    TemporalTaaAdvancedResolveSettings {}

export interface TemporalTaaSettingsDescriptor extends Partial<TemporalTaaResolveSettings> {`,
);
await replaceExact(
  'packages/renderer/src/temporal-taa-settings.ts',
  `  readonly resolve: TemporalTaaResolveOptions;`,
  `  readonly resolve: TemporalTaaResolveSettings;`,
);
await replaceExact(
  'packages/renderer/src/temporal-taa-settings.ts',
  `function cosine(value: number): number {`,
  `function nonNegative(value: number, label: string): number {
  finite(value, label);
  if (value < 0) invalid(\`${'${label}'} must be non-negative.\`);
  return value;
}

function positive(value: number, label: string): number {
  finite(value, label);
  if (value <= 0) invalid(\`${'${label}'} must be greater than zero.\`);
  return value;
}

function cosine(value: number): number {`,
);
await replaceExact(
  'packages/renderer/src/temporal-taa-settings.ts',
  `export const TEMPORAL_TAA_DEFAULT_SETTINGS: TemporalTaaSettings = Object.freeze({
  jitterScale: 1,
  resolve: TEMPORAL_TAA_DEFAULT_OPTIONS,
  responsiveMask: 0,
});`,
  `export const TEMPORAL_TAA_DEFAULT_SETTINGS: TemporalTaaSettings = Object.freeze({
  jitterScale: 1,
  resolve: Object.freeze({
    ...TEMPORAL_TAA_DEFAULT_OPTIONS,
    edgeDepthDifference: 0,
    flickerReduction: 0,
    maxVelocityLength: 128,
    minimumCurrentWeight: 0,
    subpixelCorrection: 0,
    varianceClipGamma: 0,
  }),
  responsiveMask: 0,
});`,
);
await replaceExact(
  'packages/renderer/src/temporal-taa-settings.ts',
  `    depthRelativeThreshold: unit(
      descriptor.depthRelativeThreshold ?? base.resolve.depthRelativeThreshold,
      'TAA relative Depth threshold',
    ),`,
  `    depthRelativeThreshold: unit(
      descriptor.depthRelativeThreshold ?? base.resolve.depthRelativeThreshold,
      'TAA relative Depth threshold',
    ),
    edgeDepthDifference: unit(
      descriptor.edgeDepthDifference ?? base.resolve.edgeDepthDifference,
      'TAA edge Depth difference',
    ),
    flickerReduction: unit(
      descriptor.flickerReduction ?? base.resolve.flickerReduction,
      'TAA flicker reduction',
    ),
    maxVelocityLength: positive(
      descriptor.maxVelocityLength ?? base.resolve.maxVelocityLength,
      'TAA maximum Velocity length',
    ),
    minimumCurrentWeight: unit(
      descriptor.minimumCurrentWeight ?? base.resolve.minimumCurrentWeight,
      'TAA minimum current weight',
    ),`,
);
await replaceExact(
  'packages/renderer/src/temporal-taa-settings.ts',
  `    responsiveHistoryReduction: unit(
      descriptor.responsiveHistoryReduction ?? base.resolve.responsiveHistoryReduction,
      'TAA responsive History reduction',
    ),`,
  `    responsiveHistoryReduction: unit(
      descriptor.responsiveHistoryReduction ?? base.resolve.responsiveHistoryReduction,
      'TAA responsive History reduction',
    ),
    subpixelCorrection: unit(
      descriptor.subpixelCorrection ?? base.resolve.subpixelCorrection,
      'TAA subpixel correction',
    ),
    varianceClipGamma: nonNegative(
      descriptor.varianceClipGamma ?? base.resolve.varianceClipGamma,
      'TAA variance clip gamma',
    ),`,
);

await replaceExact(
  'packages/camera/src/temporal-camera.ts',
  `  readonly previousJitterNdcOffset: TemporalVec2;
  readonly previousViewProjection: Mat4;`,
  `  readonly previousJitterNdcOffset: TemporalVec2;
  readonly previousUnjitteredViewProjection: Mat4;
  readonly previousViewProjection: Mat4;`,
);
await replaceExact(
  'packages/camera/src/temporal-camera.ts',
  `  readonly jitterNdcOffset: TemporalVec2;
  readonly projectionUpdateCount: number;`,
  `  readonly jitterNdcOffset: TemporalVec2;
  readonly projectionUpdateCount: number;
  readonly unjitteredViewProjection: Mat4;`,
);
await replaceExact(
  'packages/camera/src/temporal-camera.ts',
  `    const previousCameraRevision = reusablePrevious?.cameraRevision ?? cameraDiagnostics.revision;
    const previousJitterNdcOffset = reusablePrevious?.jitterNdcOffset ?? jitter.ndcOffset;`,
  `    const previousCameraRevision = reusablePrevious?.cameraRevision ?? cameraDiagnostics.revision;
    const previousJitterNdcOffset = reusablePrevious?.jitterNdcOffset ?? jitter.ndcOffset;
    const previousUnjitteredViewProjection =
      reusablePrevious?.unjitteredViewProjection ?? unjitteredViewProjection;`,
);
await replaceExact(
  'packages/camera/src/temporal-camera.ts',
  `      projectionUpdateCount: cameraDiagnostics.projectionMatrixUpdateCount,
      viewport,`,
  `      projectionUpdateCount: cameraDiagnostics.projectionMatrixUpdateCount,
      unjitteredViewProjection,
      viewport,`,
);
await replaceExact(
  'packages/camera/src/temporal-camera.ts',
  `      previousJitterNdcOffset,
      previousViewProjection,`,
  `      previousJitterNdcOffset,
      previousUnjitteredViewProjection,
      previousViewProjection,`,
);

await replaceExact(
  'packages/renderer/src/pbr-gpu-layout.ts',
  `  byteLength: 448,
  floatLength: 112,`,
  `  byteLength: 576,
  floatLength: 144,`,
);
await replaceExact(
  'packages/renderer/src/pbr-gpu-layout.ts',
  `    environmentControls: 108,
    textureUvRotations: 92,`,
  `    environmentControls: 108,
    currentMotionModelViewProjection: 112,
    previousMotionModelViewProjection: 128,
    textureUvRotations: 92,`,
);
await replaceExact(
  'packages/renderer/src/pbr-gpu-layout.ts',
  `  readonly output?: PbrOutputTransformDescriptor;
  readonly viewProjectionMatrix: Mat4;
  readonly worldMatrix: Mat4;`,
  `  readonly currentMotionViewProjectionMatrix?: Mat4;
  readonly output?: PbrOutputTransformDescriptor;
  readonly previousMotionViewProjectionMatrix?: Mat4;
  readonly previousWorldMatrix?: Mat4;
  readonly viewProjectionMatrix: Mat4;
  readonly worldMatrix: Mat4;`,
);
await replaceExact(
  'packages/renderer/src/pbr-gpu-layout.ts',
  `  result.set(
    [
      environment.intensity,
      environment.specularMipLevelCount - 1,
      output.exposureMultiplier,
      output.toneMapping === 'khronos-pbr-neutral' ? 1 : 0,
    ],
    offsets.environmentControls,
  );
  return result;`,
  `  result.set(
    [
      environment.intensity,
      environment.specularMipLevelCount - 1,
      output.exposureMultiplier,
      output.toneMapping === 'khronos-pbr-neutral' ? 1 : 0,
    ],
    offsets.environmentControls,
  );
  result.set(
    multiplyMat4(
      options.currentMotionViewProjectionMatrix ?? options.viewProjectionMatrix,
      options.worldMatrix,
    ),
    offsets.currentMotionModelViewProjection,
  );
  result.set(
    multiplyMat4(
      options.previousMotionViewProjectionMatrix ??
        options.currentMotionViewProjectionMatrix ??
        options.viewProjectionMatrix,
      options.previousWorldMatrix ?? options.worldMatrix,
    ),
    offsets.previousMotionModelViewProjection,
  );
  return result;`,
);
