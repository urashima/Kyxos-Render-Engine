import { read, replaceExact, replaceRegex, write, writeGeneratedMirror } from './helpers.mjs';

await replaceExact(
  'packages/renderer/src/dynamic-taa-resolve-pass.ts',
  `import type { TemporalTaaResolveOptions } from '@kyxos/render-temporal';`,
  `import type { TemporalVec2 } from '@kyxos/render-temporal';`,
);
await replaceExact(
  'packages/renderer/src/dynamic-taa-resolve-pass.ts',
  `import { createTemporalTaaSettings } from './temporal-taa-settings.js';`,
  `import { createTemporalTaaSettings } from './temporal-taa-settings.js';
import type { TemporalTaaResolveSettings } from './temporal-taa-settings.js';`,
);
await replaceRegex(
  'packages/renderer/src/dynamic-taa-resolve-pass.ts',
  /export const DYNAMIC_TAA_RESOLVE_UNIFORM_LAYOUT = Object\.freeze\(\{[\s\S]*?\n\}\);/u,
  `export const DYNAMIC_TAA_RESOLVE_UNIFORM_LAYOUT = Object.freeze({
  byteLength: 84 * FLOAT_BYTES,
  currentInverseViewProjectionOffset: 0,
  previousViewProjectionOffset: 16 * FLOAT_BYTES,
  currentViewProjectionOffset: 32 * FLOAT_BYTES,
  previousInverseViewProjectionOffset: 48 * FLOAT_BYTES,
  viewportHistoryResponsiveOffset: 64 * FLOAT_BYTES,
  jitterOffsetsOffset: 68 * FLOAT_BYTES,
  options0Offset: 72 * FLOAT_BYTES,
  options1Offset: 76 * FLOAT_BYTES,
  options2Offset: 80 * FLOAT_BYTES,
});`,
);
await replaceRegex(
  'packages/renderer/src/dynamic-taa-resolve-pass.ts',
  /export interface DynamicTaaResolvePassInput \{[\s\S]*?\n\}/u,
  `export interface DynamicTaaResolvePassInput {
  readonly currentInverseViewProjection: Mat4;
  readonly currentJitterNdcOffset?: TemporalVec2;
  readonly currentViewProjection: Mat4;
  readonly frame: DynamicTaaGpuFrame;
  readonly options?: Partial<TemporalTaaResolveSettings>;
  readonly previousInverseViewProjection: Mat4;
  readonly previousJitterNdcOffset?: TemporalVec2;
  readonly previousViewProjection: Mat4;
  readonly responsiveMask?: number;
}`,
);
await replaceExact(
  'packages/renderer/src/dynamic-taa-resolve-pass.ts',
  `function copyMatrix(target: Float32Array, offset: number, matrix: Mat4, label: string): void {`,
  `function copyVector2(
  target: Float32Array,
  offset: number,
  vector: TemporalVec2 | undefined,
  label: string,
): void {
  const resolved = vector ?? ([0, 0] as const);
  for (let index = 0; index < 2; index += 1) {
    const value = resolved[index] as number;
    if (!Number.isFinite(value)) {
      throw error(\`${'${label}'}[${'${index}'}] must be finite.\`, 'INVALID_ARGUMENT');
    }
    target[offset + index] = value;
  }
}

function copyMatrix(target: Float32Array, offset: number, matrix: Mat4, label: string): void {`,
);
await replaceExact(
  'packages/renderer/src/dynamic-taa-resolve-pass.ts',
  `export function packDynamicTaaResolveUniforms(input: DynamicTaaResolvePassInput): Float32Array {
  const responsiveMask = validateResponsiveMask(input.responsiveMask ?? 0);
  const options = createTemporalTaaSettings(input.options).resolve;
  const { frame } = input;
  if (
    !Number.isSafeInteger(frame.size.width) ||
    frame.size.width < 1 ||
    !Number.isSafeInteger(frame.size.height) ||
    frame.size.height < 1
  ) {
    throw error('Dynamic TAA Resolve frame size is invalid.', 'INVALID_ARGUMENT');
  }
  const values = new Float32Array(DYNAMIC_TAA_RESOLVE_UNIFORM_LAYOUT.byteLength / FLOAT_BYTES);
  copyMatrix(values, 0, input.currentInverseViewProjection, 'Current inverse View-Projection');
  copyMatrix(values, MATRIX_FLOATS, input.previousViewProjection, 'Previous View-Projection');
  values[32] = frame.size.width;
  values[33] = frame.size.height;
  values[34] = frame.historyValid ? 1 : 0;
  values[35] = responsiveMask;
  values[36] = options.baseHistoryWeight;
  values[37] = options.depthAbsoluteThreshold;
  values[38] = options.depthRelativeThreshold;
  values[39] = options.normalRejectionCosine;
  values[40] = options.responsiveHistoryReduction;
  return values;
}`,
  `export function packDynamicTaaResolveUniforms(input: DynamicTaaResolvePassInput): Float32Array {
  const responsiveMask = validateResponsiveMask(input.responsiveMask ?? 0);
  const options = createTemporalTaaSettings(input.options).resolve;
  const { frame } = input;
  if (
    !Number.isSafeInteger(frame.size.width) ||
    frame.size.width < 1 ||
    !Number.isSafeInteger(frame.size.height) ||
    frame.size.height < 1
  ) {
    throw error('Dynamic TAA Resolve frame size is invalid.', 'INVALID_ARGUMENT');
  }
  const values = new Float32Array(DYNAMIC_TAA_RESOLVE_UNIFORM_LAYOUT.byteLength / FLOAT_BYTES);
  copyMatrix(values, 0, input.currentInverseViewProjection, 'Current inverse View-Projection');
  copyMatrix(values, 16, input.previousViewProjection, 'Previous View-Projection');
  copyMatrix(values, 32, input.currentViewProjection, 'Current View-Projection');
  copyMatrix(
    values,
    48,
    input.previousInverseViewProjection,
    'Previous inverse View-Projection',
  );
  values[64] = frame.size.width;
  values[65] = frame.size.height;
  values[66] = frame.historyValid ? 1 : 0;
  values[67] = responsiveMask;
  copyVector2(values, 68, input.currentJitterNdcOffset, 'Current jitter NDC');
  copyVector2(values, 70, input.previousJitterNdcOffset, 'Previous jitter NDC');
  values[72] = options.baseHistoryWeight;
  values[73] = options.depthAbsoluteThreshold;
  values[74] = options.depthRelativeThreshold;
  values[75] = options.normalRejectionCosine;
  values[76] = options.responsiveHistoryReduction;
  values[77] = options.edgeDepthDifference;
  values[78] = options.maxVelocityLength;
  values[79] = options.minimumCurrentWeight;
  values[80] = options.varianceClipGamma;
  values[81] = options.subpixelCorrection;
  values[82] = options.flickerReduction;
  return values;
}`,
);
await replaceExact(
  'packages/renderer/src/dynamic-taa-resolve-pass.ts',
  `      frame.writeNormalTexture.id,
      frame.readColorTexture.id,`,
  `      frame.writeNormalTexture.id,
      frame.currentVelocityTexture.id,
      frame.readColorTexture.id,`,
);
await replaceExact(
  'packages/renderer/src/dynamic-taa-resolve-pass.ts',
  `        { binding: 3, resource: { texture: frame.writeNormalTexture } },
        { binding: 4, resource: { texture: frame.readColorTexture } },
        { binding: 5, resource: { texture: frame.readDepthTexture } },
        { binding: 6, resource: { texture: frame.readNormalTexture } },
        { binding: 7, resource: { sampler: frame.sampler } },`,
  `        { binding: 3, resource: { texture: frame.writeNormalTexture } },
        { binding: 4, resource: { texture: frame.currentVelocityTexture } },
        { binding: 5, resource: { texture: frame.readColorTexture } },
        { binding: 6, resource: { texture: frame.readDepthTexture } },
        { binding: 7, resource: { texture: frame.readNormalTexture } },
        { binding: 8, resource: { sampler: frame.sampler } },`,
);

const shader = await read('.github/scripts/phase-04-final/phase-04-taa-resolve.wgsl');
await write('shaders/webgpu/phase-04-taa-resolve.wgsl', shader);
await writeGeneratedMirror(
  'shaders/webgpu/phase-04-taa-resolve.wgsl',
  'packages/renderer/src/generated/phase-04-taa-resolve.wgsl.ts',
  'PHASE_04_TAA_RESOLVE_WGSL',
);
