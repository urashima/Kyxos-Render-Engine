/** Stable package identity for diagnostics and boundary tests. */
export const RENDERER_PACKAGE_NAME = '@kyxos/render-renderer' as const;

export type { BasicGeometryFeatureOptions } from './basic-geometry-feature.js';
export { BASIC_GEOMETRY_FEATURE_ID, BasicGeometryFeature } from './basic-geometry-feature.js';
export {
  DeferredGBuffer,
  type DeferredGBufferDiagnostics,
  type DeferredGBufferFrame,
  type DeferredGBufferOptions,
  type DeferredGBufferSize,
} from './deferred-gbuffer.js';
export {
  DynamicTaaGpuHistory,
  type DynamicTaaGpuFrame,
  type DynamicTaaGpuHistoryDiagnostics,
  type DynamicTaaGpuHistoryOptions,
  type DynamicTaaGpuHistorySize,
} from './dynamic-taa-gpu-history.js';
export {
  DYNAMIC_TAA_PRESENT_UNIFORM_LAYOUT,
  DynamicTaaPresentPass,
  packDynamicTaaPresentUniforms,
  type DynamicTaaPresentPassDiagnostics,
  type DynamicTaaPresentPassInput,
  type DynamicTaaPresentPassOptions,
  type TemporalPresentColorFrame,
} from './dynamic-taa-present-pass.js';
export {
  DYNAMIC_TAA_RESOLVE_UNIFORM_LAYOUT,
  DynamicTaaResolvePass,
  packDynamicTaaResolveUniforms,
  type DynamicTaaResolvePassDiagnostics,
  type DynamicTaaResolvePassInput,
  type DynamicTaaResolvePassOptions,
} from './dynamic-taa-resolve-pass.js';
export {
  TEMPORAL_TAA_DEFAULT_SETTINGS,
  createTemporalTaaSettings,
  type TemporalTaaAdvancedResolveSettings,
  type TemporalTaaResolveSettings,
  type TemporalTaaSettings,
  type TemporalTaaSettingsDescriptor,
} from './temporal-taa-settings.js';
export {
  EnvironmentGpuCache,
  EnvironmentGpuLease,
  type EnvironmentGpuCacheDiagnostics,
  type EnvironmentGpuResources,
} from './environment-gpu-cache.js';
export type {
  BasicGeometryData,
  BasicGeometryPrimitive,
  BasicGeometryViewport,
  SphereGeometryOptions,
} from './basic-geometry.js';
export {
  BASIC_GEOMETRY_VERTEX_FLOATS,
  BASIC_GEOMETRY_VERTEX_STRIDE,
  createSphereGeometry,
  createTriangleGeometry,
  projectBasicGeometryVertices,
} from './basic-geometry.js';
export type {
  AssetDecoder,
  EngineExtension,
  ExtensionCategory,
  MaterialExtension,
  PreviewPreset,
  RenderFeature,
  RenderFeatureFrameContext,
  RenderFeatureInitializationContext,
} from './extensions.js';
export type {
  KyxosRendererOptions,
  RendererDiagnostics,
  RendererEvents,
  RendererFrameEvent,
  RendererLifecycleState,
  RendererRegistrationCounts,
} from './renderer.js';
export { KyxosRenderer } from './renderer.js';
export {
  PbrMaterialLibrary,
  type PbrMaterialLibraryChangeEvent,
  type PbrMaterialLibraryChangeKind,
  type PbrMaterialLibraryDiagnostics,
  type PbrMaterialLibraryEvents,
  type PbrMaterialLibraryOptions,
} from './pbr-material-library.js';
export {
  PBR_OBJECT_UNIFORM_LAYOUT,
  createPbrDirectionalLight,
  packPbrObjectUniforms,
  type PackPbrObjectUniformsOptions,
  type PbrDirectionalLight,
  type PbrDirectionalLightDescriptor,
  type PbrEnvironmentUniforms,
} from './pbr-gpu-layout.js';
export {
  PBR_RENDER_FEATURE_ID,
  PbrRenderFeature,
  type PbrDynamicTaaOutput,
  type PbrDynamicTaaSurface,
  type PbrEnvironmentDescriptor,
  type PbrEnvironmentState,
  type PbrRenderFeatureDiagnostics,
  type PbrRenderFeatureOptions,
} from './pbr-render-feature.js';
export {
  PbrTextureLibrary,
  PbrTextureSource,
  type PbrTextureLibraryChangeEvent,
  type PbrTextureLibraryDiagnostics,
  type PbrTextureLibraryEvents,
  type PbrNormalYDirection,
  type PbrTextureSourceDescriptor,
} from './pbr-texture-library.js';
export {
  SCENE_RENDER_FEATURE_ID,
  SceneRenderFeature,
  type SceneRenderFeatureDiagnostics,
  type SceneRenderFeatureOptions,
} from './scene-render-feature.js';
export {
  StaticAccumulationGpuHistory,
  type StaticAccumulationGpuFrame,
  type StaticAccumulationGpuHistoryDiagnostics,
  type StaticAccumulationGpuHistoryOptions,
  type StaticAccumulationGpuHistorySize,
} from './static-accumulation-gpu-history.js';
export {
  STATIC_ACCUMULATION_UNIFORM_LAYOUT,
  StaticAccumulationPass,
  packStaticAccumulationUniforms,
  type StaticAccumulationPassDiagnostics,
  type StaticAccumulationPassInput,
  type StaticAccumulationPassOptions,
} from './static-accumulation-pass.js';
export {
  TEMPORAL_PBR_RENDER_FEATURE_ID,
  TemporalPbrRenderFeature,
  type TemporalPbrRenderFeatureDiagnostics,
  type TemporalPbrRenderFeatureOptions,
} from './temporal-pbr-render-feature.js';
export {
  TemporalPipelineTransaction,
  type TemporalPipelineExecuteInput,
  type TemporalPipelineExecuteResult,
  type TemporalPipelineTransactionDiagnostics,
  type TemporalPipelineTransactionOptions,
} from './temporal-pipeline-transaction.js';
