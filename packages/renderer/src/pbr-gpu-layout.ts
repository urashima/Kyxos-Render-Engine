import { KyxosEngineError } from '@kyxos/render-core';
import { createLinearRgb } from '@kyxos/render-material-core';
import { createVec3, multiplyMat4, normalMatrixMat4, normalizeVec3 } from '@kyxos/render-math';

import type { RgbColor } from '@kyxos/render-material-core';
import type { PbrMaterialSnapshot } from '@kyxos/render-material-pbr';
import type { Mat4, Vec3 } from '@kyxos/render-math';

export const PBR_OBJECT_UNIFORM_LAYOUT = Object.freeze({
  byteLength: 304,
  floatLength: 76,
  offsets: Object.freeze({
    baseColor: 48,
    cameraPosition: 64,
    emissiveAndStrength: 52,
    lightColor: 72,
    lightDirectionAndIntensity: 68,
    metallicRoughnessAlphaCutoff: 56,
    model: 16,
    modelViewProjection: 0,
    normalMatrix: 32,
    normalOcclusion: 60,
  }),
} as const);

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
  readonly light: PbrDirectionalLight;
  readonly material: PbrMaterialSnapshot;
  readonly viewProjectionMatrix: Mat4;
  readonly worldMatrix: Mat4;
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
    [options.material.normalScale, options.material.occlusionStrength, 0, 0],
    offsets.normalOcclusion,
  );
  result.set([...options.cameraPosition, 1], offsets.cameraPosition);
  result.set(
    [...options.light.direction, options.light.intensity],
    offsets.lightDirectionAndIntensity,
  );
  result.set([...options.light.color, 0], offsets.lightColor);
  return result;
}
