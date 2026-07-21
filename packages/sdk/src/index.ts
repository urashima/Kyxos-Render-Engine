/** Stable package identity for diagnostics and boundary tests. */
export const SDK_PACKAGE_NAME = '@kyxos/render-sdk' as const;

export type {
  BackendBindGroupDescriptor,
  BackendBindGroupHandle,
  BackendBufferData,
  BackendBufferDescriptor,
  BackendBufferHandle,
  BackendCapabilityReport,
  BackendClearColor,
  BackendCommandEncoderDescriptor,
  BackendCommandEncoderHandle,
  BackendDrawCommand,
  BackendEvents,
  BackendFrameSubmission,
  BackendLifecycleState,
  BackendLossInfo,
  BackendPipelineHandle,
  BackendRenderPipelineDescriptor,
  BackendRenderPassDescriptor,
  BackendRenderPassStatistics,
  BackendResourceDescriptor,
  BackendResourceHandle,
  BackendResourceKind,
  BackendResourceStatistics,
  BackendSamplerDescriptor,
  BackendSamplerHandle,
  BackendShaderCompilationInfo,
  BackendShaderModuleDescriptor,
  BackendShaderModuleHandle,
  BackendSurfaceDescriptor,
  BackendSurfaceHandle,
  BackendSurfaceInfo,
  BackendSurfaceResize,
  BackendSurfaceSize,
  BackendSurfaceTarget,
  BackendTextureDescriptor,
  BackendTextureHandle,
  BackendType,
  GraphicsBackend,
} from '@kyxos/render-backend-api';
export { BACKEND_RESOURCE_KINDS, createBackendCapabilityReport } from '@kyxos/render-backend-api';
export type { DirtyFlag, FrameRequestDriver, RenderMode } from '@kyxos/render-frame-scheduler';
export type {
  AssetDecoder,
  BasicGeometryPrimitive,
  MaterialExtension,
  PreviewPreset,
  RenderFeature,
  RendererDiagnostics,
  RendererEvents,
  RendererLifecycleState,
} from '@kyxos/render-renderer';
export { KyxosRenderer } from '@kyxos/render-renderer';
export { createBrowserFrameDriver } from './browser-frame-driver.js';
export type { KyxosCanvasRendererOptions } from './canvas-renderer.js';
export { KyxosCanvasRenderer } from './canvas-renderer.js';
export type { CreateKyxosInjectedRendererOptions } from './create-renderer-from-backend.js';
export { createKyxosRendererFromBackend } from './create-renderer-from-backend.js';
export type {
  CreateKyxosCanvasRendererOptions,
  CreateKyxosRendererOptions,
  KyxosBackendSelection,
} from './create-renderer.js';
export { createKyxosRenderer } from './create-renderer.js';
