/** Stable package identity for diagnostics and boundary tests. */
export const ENVIRONMENT_PACKAGE_NAME = '@kyxos/render-environment' as const;

export {
  EnvironmentLibrary,
  type EnvironmentLibraryChangeEvent,
  type EnvironmentLibraryDiagnostics,
  type EnvironmentLibraryEvents,
  type EnvironmentReference,
} from './environment-library.js';
export {
  ENVIRONMENT_CUBE_FACES,
  EnvironmentSource,
  type EnvironmentBrdfLutDescriptor,
  type EnvironmentCubeFace,
  type EnvironmentCubeFaceData,
  type EnvironmentCubeLevelDescriptor,
  type EnvironmentDiffuseIrradianceDescriptor,
  type EnvironmentFloatData,
  type EnvironmentSourceDescriptor,
  type EnvironmentSourceDiagnostics,
  type EnvironmentSpecularPrefilterDescriptor,
} from './environment-source.js';
export { encodeFloat16, float16BitsToFloat32, float32ToFloat16Bits } from './float16.js';
