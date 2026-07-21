/** Stable package identity for diagnostics and boundary tests. */
export const SDK_PACKAGE_NAME = '@kyxos/render-sdk' as const;

export type {
  BackendCapabilityReport,
  BackendEvents,
  BackendLifecycleState,
  BackendLossInfo,
  BackendResourceDescriptor,
  BackendResourceHandle,
  BackendResourceKind,
  BackendResourceStatistics,
  BackendSurfaceDescriptor,
  BackendSurfaceHandle,
  BackendSurfaceInfo,
  BackendSurfaceResize,
  BackendSurfaceSize,
  BackendSurfaceTarget,
  BackendType,
  GraphicsBackend,
} from '@kyxos/render-backend-api';
export { BACKEND_RESOURCE_KINDS, createBackendCapabilityReport } from '@kyxos/render-backend-api';
export type { DirtyFlag, FrameRequestDriver, RenderMode } from '@kyxos/render-frame-scheduler';
export type {
  AssetDecoder,
  MaterialExtension,
  PreviewPreset,
  RenderFeature,
  RendererDiagnostics,
  RendererEvents,
  RendererLifecycleState,
} from '@kyxos/render-renderer';
export { KyxosRenderer } from '@kyxos/render-renderer';
export { createBrowserFrameDriver } from './browser-frame-driver.js';
export type { CreateKyxosRendererOptions } from './create-renderer.js';
export { createKyxosRenderer } from './create-renderer.js';
