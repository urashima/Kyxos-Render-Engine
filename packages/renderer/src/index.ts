/** Stable package identity for diagnostics and boundary tests. */
export const RENDERER_PACKAGE_NAME = '@kyxos/render-renderer' as const;

export type {
  AssetDecoder,
  EngineExtension,
  ExtensionCategory,
  MaterialExtension,
  PreviewPreset,
  RenderFeature,
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
