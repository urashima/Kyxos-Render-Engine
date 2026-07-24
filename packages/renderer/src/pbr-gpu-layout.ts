import { KyxosEngineError } from '@kyxos/render-core';
import { createLinearRgb } from '@kyxos/render-material-core';
import { createPbrOutputTransform } from '@kyxos/render-material-pbr';
import { createVec3, multiplyMat4, normalMatrixMat4, normalizeVec3 } from '@kyxos/render-math';

import type { MaterialTextureBinding, RgbColor } from '@kyxos/render-material-core';
import type { PbrMaterialSnapshot, PbrOutputTransformDescriptor } from '@kyxos/render-material-pbr';
import type { Mat4, Vec3 } from '@kyxos/render-math';
import type { PbrNormalYDirection } from './pbr-texture-library.js';

export const PBR_OBJECT_UNIFORM_LAYOUT = Object.freeze({
  byteLength: 576,
  floatLength: 144,
  offsets: Object.freeze({
    baseColor: 48,
    baseColorUvOffsetScale: 76,
    cameraPosition: 64,
    emissiveUvOffsetScale: 88,
    emissiveAndStrength: 52,
    lightColor: 72,
    lightDirectionAndIntensity: 68,
    metallicRoughnessAlphaCutoff: 56,
    metallicRoughnessUvOffsetScale: 80,
    model: 16,
    modelViewProjection: 0,
    normalEmissiveUvRotations: 96,
    normalMatrix: 32,
    normalOcclusion: 60,
    normalUvOffsetScale: 84,
    occlusionEnvironmentRotations: 104,
    occlusionUvOffsetScale: 100,
    environmentControls: 108,
    currentMotionModelViewProjection: 112,
    previousMotionModelViewProjection: 128,
    textureUvRotations: 92,
  }),
} as const);

interface PackedTextureTransform {
  readonly offsetScale: readonly [number, number, number, number];
  readonly rotation: readonly [number, number];
}

function packTextureTransform(
  binding: MaterialTextureBinding | null,
  label: string,
): PackedTextureTransform {
  if (binding === null) {
    return Object.freeze({
      offsetScale: Object.freeze([0, 0, 1, 1] as const),
      rotation: Object.freeze([1, 0] as const),
    });
  }
  if (binding.transform.texCoord !== 0) {
    throw new KyxosEngineError(`${label} currently requires UV set 0.`, {
      code: 'UNSUPPORTED_CAPABILITY',
      module: 'renderer',
      recoverable: true,
      suggestedAction: 'Use texCoord 0 until additional Mesh UV sets are implemented.',
    });
  }
  return Object.freeze({
    offsetScale: Object.freeze([
      binding.transform.offset[0],
      binding.transform.offset[1],
      binding.transform.scale[0],
      binding.transform.scale[1],
    ] as const),
    rotation: Object.freeze([
      Math.cos(binding.transform.rotation),
      Math.sin(binding.transform.rotation),
    ] as const),
  });
}

export interface PbrDirectionalLight {
  /** Normalized world-space direction from the shaded point toward the light. */
  readonly direction: Vec3;
  readonly color: RgbColor;
  readonly intensity: number;
}

export interface PbrDirectionalLightDescriptor {
  readonly direction?: Vec3;
  readonly color?: RgbColor;
  readonly intensity?: number;
}

export interface PackPbrObjectUniformsOptions {
  readonly cameraPosition: Vec3;
  readonly environment?: PbrEnvironmentUniforms;
  readonly light: PbrDirectionalLight;
  readonly material: PbrMaterialSnapshot;
  /** Asset-boundary Normal convention metadata; defaults to the engine's Y-up convention. */
  readonly normalYDirection?: PbrNormalYDirection;
  readonly currentMotionViewProjectionMatrix?: Mat4;
  readonly output?: PbrOutputTransformDescriptor;
  readonly previousMotionViewProjectionMatrix?: Mat4;
  readonly previousWorldMatrix?: Mat4;
  readonly viewProjectionMatrix: Mat4;
  readonly worldMatrix: Mat4;
}

export interface PbrEnvironmentUniforms {
  readonly intensity: number;
  readonly rotation: number;
  readonly specularMipLevelCount: number;
}

export function createPbrDirectionalLight(
  descriptor: PbrDirectionalLightDescriptor = {},
): PbrDirectionalLight {
  const intensity = descriptor.intensity ?? 3;
  if (!Number.isFinite(intensity) || intensity < 0) {
    throw new KyxosEngineError('PBR direct-light intensity must be finite and nonnegative.', {
      code: 'INVALID_ARGUMENT',
      module: 'renderer',
      recoverable: false,
    });
  }
  let direction: Vec3;
  try {
    direction = normalizeVec3(
      createVec3(...(descriptor.direction ?? ([0.35, 0.8, 0.48] as const))),
    );
  } catch (cause) {
    throw new KyxosEngineError('PBR direct-light direction must be finite and nonzero.', {
      cause,
      code: 'INVALID_ARGUMENT',
      module: 'renderer',
      recoverable: false,
    });
  }
  return Object.freeze({
    color: createLinearRgb(descriptor.color ?? [1, 1, 1], 'PBR direct-light color'),
    direction,
    intensity,
  });
}

export function packPbrObjectUniforms(options: PackPbrObjectUniformsOptions): Float32Array {
  const normalYDirection = options.normalYDirection ?? 'up';
  if (normalYDirection !== 'down' && normalYDirection !== 'up') {
    throw new KyxosEngineError('PBR normalYDirection must be "up" or "down".', {
      code: 'INVALID_ARGUMENT',
      module: 'renderer',
      recoverable: false,
    });
  }
  const environment = options.environment ?? {
    intensity: 0,
    rotation: 0,
    specularMipLevelCount: 1,
  };
  const output = createPbrOutputTransform(options.output);
  if (!Number.isFinite(environment.intensity) || environment.intensity < 0) {
    throw new KyxosEngineError('PBR environment intensity must be finite and nonnegative.', {
      code: 'INVALID_ARGUMENT',
      module: 'renderer',
      recoverable: false,
    });
  }
  if (!Number.isFinite(environment.rotation)) {
    throw new KyxosEngineError('PBR environment rotation must be finite.', {
      code: 'INVALID_ARGUMENT',
      module: 'renderer',
      recoverable: false,
    });
  }
  if (
    !Number.isSafeInteger(environment.specularMipLevelCount) ||
    environment.specularMipLevelCount < 1
  ) {
    throw new KyxosEngineError('PBR environment mip count must be a positive safe integer.', {
      code: 'INVALID_ARGUMENT',
      module: 'renderer',
      recoverable: false,
    });
  }
  const result = new Float32Array(PBR_OBJECT_UNIFORM_LAYOUT.floatLength);
  const offsets = PBR_OBJECT_UNIFORM_LAYOUT.offsets;
  result.set(
    multiplyMat4(options.viewProjectionMatrix, options.worldMatrix),
    offsets.modelViewProjection,
  );
  result.set(options.worldMatrix, offsets.model);
  try {
    result.set(normalMatrixMat4(options.worldMatrix), offsets.normalMatrix);
  } catch (cause) {
    throw new KyxosEngineError('PBR Entity world transform cannot produce a normal Matrix.', {
      cause,
      code: 'INVALID_ARGUMENT',
      module: 'renderer',
      recoverable: false,
    });
  }
  result.set(options.material.baseColorFactor, offsets.baseColor);
  result.set(
    [...options.material.emissiveFactor, options.material.emissiveStrength],
    offsets.emissiveAndStrength,
  );
  result.set(
    [
      options.material.metallicFactor,
      options.material.roughnessFactor,
      options.material.alphaCutoff,
      0,
    ],
    offsets.metallicRoughnessAlphaCutoff,
  );
  result.set(
    [
      options.material.normalScale,
      options.material.occlusionStrength,
      options.material.textures.normal === null ? 0 : 1,
      normalYDirection === 'up' ? 1 : -1,
    ],
    offsets.normalOcclusion,
  );
  result.set([...options.cameraPosition, 1], offsets.cameraPosition);
  result.set(
    [...options.light.direction, options.light.intensity],
    offsets.lightDirectionAndIntensity,
  );
  result.set([...options.light.color, 0], offsets.lightColor);
  const baseColorTransform = packTextureTransform(
    options.material.textures['base-color'],
    'PBR base-color Texture',
  );
  const metallicRoughnessTransform = packTextureTransform(
    options.material.textures['metallic-roughness'],
    'PBR metallic-roughness Texture',
  );
  const normalTransform = packTextureTransform(
    options.material.textures.normal,
    'PBR Normal Texture',
  );
  const emissiveTransform = packTextureTransform(
    options.material.textures.emissive,
    'PBR Emissive Texture',
  );
  const occlusionTransform = packTextureTransform(
    options.material.textures.occlusion,
    'PBR Occlusion Texture',
  );
  result.set(baseColorTransform.offsetScale, offsets.baseColorUvOffsetScale);
  result.set(metallicRoughnessTransform.offsetScale, offsets.metallicRoughnessUvOffsetScale);
  result.set(normalTransform.offsetScale, offsets.normalUvOffsetScale);
  result.set(emissiveTransform.offsetScale, offsets.emissiveUvOffsetScale);
  result.set(
    [...baseColorTransform.rotation, ...metallicRoughnessTransform.rotation],
    offsets.textureUvRotations,
  );
  result.set(
    [...normalTransform.rotation, ...emissiveTransform.rotation],
    offsets.normalEmissiveUvRotations,
  );
  result.set(occlusionTransform.offsetScale, offsets.occlusionUvOffsetScale);
  result.set(
    [
      ...occlusionTransform.rotation,
      Math.cos(environment.rotation),
      Math.sin(environment.rotation),
    ],
    offsets.occlusionEnvironmentRotations,
  );
  result.set(
    [
      environment.intensity,
      environment.specularMipLevelCount - 1,
      output.exposureMultiplier,
      output.toneMapping === 'khronos-pbr-neutral' ? 1 : 0,
    ],
    offsets.environmentControls,
  );
  result.set(
    multiplyMat4(
      options.currentMotionViewProjectionMatrix ?? options.viewProjectionMatrix,
      options.worldMatrix,
    ),
    offsets.currentMotionModelViewProjection,
  );
  result.set(
    multiplyMat4(
      options.previousMotionViewProjectionMatrix ??
        options.currentMotionViewProjectionMatrix ??
        options.viewProjectionMatrix,
      options.previousWorldMatrix ?? options.worldMatrix,
    ),
    offsets.previousMotionModelViewProjection,
  );
  return result;
}
