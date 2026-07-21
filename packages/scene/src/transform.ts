import { createQuaternion, createVec3 } from '@kyxos/render-math';

import type { Quaternion, Vec3 } from '@kyxos/render-math';

export interface LocalTransform {
  readonly rotation: Quaternion;
  readonly scale: Vec3;
  readonly translation: Vec3;
}

export interface LocalTransformOptions {
  readonly rotation?: Quaternion;
  readonly scale?: Vec3;
  readonly translation?: Vec3;
}

export function createLocalTransform(options: LocalTransformOptions = {}): LocalTransform {
  const translation = options.translation ?? [0, 0, 0];
  const rotation = options.rotation ?? [0, 0, 0, 1];
  const scale = options.scale ?? [1, 1, 1];
  return Object.freeze({
    rotation: createQuaternion(rotation[0], rotation[1], rotation[2], rotation[3]),
    scale: createVec3(scale[0], scale[1], scale[2]),
    translation: createVec3(translation[0], translation[1], translation[2]),
  });
}

export function localTransformsEqual(left: LocalTransform, right: LocalTransform): boolean {
  return (
    left.translation.every((value, index) => value === right.translation[index]) &&
    left.rotation.every((value, index) => value === right.rotation[index]) &&
    left.scale.every((value, index) => value === right.scale[index])
  );
}
