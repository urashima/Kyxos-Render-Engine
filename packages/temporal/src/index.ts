/** Stable package identity for diagnostics and boundary tests. */
export const TEMPORAL_PACKAGE_NAME = '@kyxos/render-temporal' as const;

export {
  TEMPORAL_SAMPLE_LIMIT,
  TemporalConvergenceTracker,
  type TemporalConvergenceOptions,
  type TemporalConvergenceReason,
  type TemporalConvergenceSnapshot,
} from './convergence.js';
export {
  TEMPORAL_HISTORY_INVALIDATION_REASONS,
  TEMPORAL_HISTORY_KINDS,
  TemporalHistory,
  type TemporalHistoryInvalidationReason,
  type TemporalHistoryKind,
  type TemporalHistoryOptions,
  type TemporalHistorySnapshot,
} from './history.js';
export {
  TEMPORAL_JITTER_SEQUENCE,
  createTemporalJitterSample,
  createTemporalJitterSequence,
  radicalInverse,
  temporalJitterToNdc,
  type TemporalJitterNdc,
  type TemporalJitterSample,
  type TemporalVec2,
  type TemporalViewportSize,
} from './jitter.js';
export {
  TEMPORAL_HISTORY_SIGNATURE_FIELDS,
  createTemporalHistorySignature,
  temporalHistorySignaturesEqual,
  type TemporalHistorySignature,
  type TemporalHistorySignatureDescriptor,
  type TemporalHistorySignatureField,
} from './signature.js';
export {
  TEMPORAL_TAA_DEFAULT_OPTIONS,
  TEMPORAL_TAA_REFERENCE_CASES,
  TEMPORAL_TAA_REFERENCE_OUTPUT_FIELDS,
  evaluateDeterministicTemporalTaaReference,
  resolveTemporalTaa,
  type DeterministicTemporalTaaReference,
  type TemporalTaaNeighborhood,
  type TemporalTaaReferenceCase,
  type TemporalTaaRejectionReason,
  type TemporalTaaResolveInput,
  type TemporalTaaResolveOptions,
  type TemporalTaaResolveResult,
  type TemporalTaaRgb,
  type TemporalTaaRgba,
  type TemporalTaaVec3,
} from './taa-resolve.js';
