export {
  STATIC_ACCUMULATION_REFERENCE_CASES,
  STATIC_ACCUMULATION_REFERENCE_OUTPUT_FIELDS,
  accumulateStaticSample,
  evaluateDeterministicStaticAccumulationReference,
  type DeterministicStaticAccumulationReference,
  type StaticAccumulationInput,
  type StaticAccumulationReferenceCase,
  type StaticAccumulationResult,
  type StaticAccumulationRgba,
} from '@kyxos/render-temporal';

export {
  STATIC_ACCUMULATION_UNIFORM_LAYOUT,
  StaticAccumulationGpuHistory,
  StaticAccumulationPass,
  packStaticAccumulationUniforms,
  type StaticAccumulationGpuFrame,
  type StaticAccumulationGpuHistoryDiagnostics,
  type StaticAccumulationGpuHistoryOptions,
  type StaticAccumulationGpuHistorySize,
  type StaticAccumulationPassDiagnostics,
  type StaticAccumulationPassInput,
  type StaticAccumulationPassOptions,
} from '@kyxos/render-renderer';
