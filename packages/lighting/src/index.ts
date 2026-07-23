/** Stable package identity for diagnostics and boundary tests. */
export const LIGHTING_PACKAGE_NAME = '@kyxos/render-lighting' as const;

export {
  ALL_LIGHT_LAYERS,
  LIGHT_SHADOW_MODES,
  LightRegistry,
  type CreateDirectionalLightOptions,
  type CreateSpotLightOptions,
  type DirectionalLightPatch,
  type DirectionalLightSnapshot,
  type LightChangeEvent,
  type LightChangeKind,
  type LightHandle,
  type LightKind,
  type LightRegistryDiagnostics,
  type LightRegistryEvents,
  type LightShadowMode,
  type LightSnapshot,
  type LightSnapshotOptions,
  type SpotLightPatch,
  type SpotLightSnapshot,
} from './light-registry.js';
