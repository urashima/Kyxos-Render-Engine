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
  TEMPORAL_HISTORY_SIGNATURE_FIELDS,
  createTemporalHistorySignature,
  temporalHistorySignaturesEqual,
  type TemporalHistorySignature,
  type TemporalHistorySignatureDescriptor,
  type TemporalHistorySignatureField,
} from './signature.js';
