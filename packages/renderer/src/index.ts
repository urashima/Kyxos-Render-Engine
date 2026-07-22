/** Stable package identity for diagnostics and boundary tests. */
export const RENDERER_PACKAGE_NAME = '@kyxos/render-renderer' as const;

export type { BasicGeometryFeatureOptions } from './basic-geometry-feature.js';
export { BASIC_GEOMETRY_FEATURE_ID, BasicGeometryFeature } from './basic-geometry-feature.js';
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
} from './pbr-gpu-layout.js';
export {
  PBR_RENDER_FEATURE_ID,
  PbrRenderFeature,
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
