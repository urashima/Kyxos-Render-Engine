/** Stable package identity for diagnostics and boundary tests. */
export const RENDERER_PACKAGE_NAME = '@kyxos/render-renderer' as const;

export type { BasicGeometryFeatureOptions } from './basic-geometry-feature.js';
export { BASIC_GEOMETRY_FEATURE_ID, BasicGeometryFeature } from './basic-geometry-feature.js';
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
