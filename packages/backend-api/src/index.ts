/** Stable package identity for diagnostics and boundary tests. */
export const BACKEND_API_PACKAGE_NAME = '@kyxos/render-backend-api' as const;

export type {
  BackendEvents,
  BackendLifecycleState,
  BackendLossInfo,
  BackendStateChange,
  GraphicsBackend,
} from './backend.js';
export type {
  BackendCapabilityReport,
  BackendCapabilityReportOptions,
  BackendFeature,
  BackendLimits,
  BackendType,
} from './capabilities.js';
export { BACKEND_FEATURES, createBackendCapabilityReport } from './capabilities.js';
export type {
  BackendResourceDescriptor,
  BackendResourceHandle,
  BackendResourceHandleKind,
  BackendResourceKind,
  BackendResourceKindStatistics,
  BackendResourceStatistics,
} from './resources.js';
export {
  BACKEND_RESOURCE_KINDS,
  backendResourceHandleKind,
  isBackendResourceHandle,
} from './resources.js';
