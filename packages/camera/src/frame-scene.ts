import type { Scene, SceneBoundsOptions } from '@kyxos/render-scene';
import type { CameraFitOptions, CameraFitResult, PerspectiveCamera } from './perspective-camera.js';

export interface FrameSceneOptions {
  readonly bounds?: SceneBoundsOptions;
  readonly fit?: CameraFitOptions;
}

export function frameScene(
  camera: PerspectiveCamera,
  scene: Scene,
  options: FrameSceneOptions = {},
): CameraFitResult | null {
  const bounds = scene.calculateWorldBounds(options.bounds);
  return bounds === null ? null : camera.fitBounds(bounds, options.fit);
}
