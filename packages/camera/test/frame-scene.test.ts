import { createAabb, frustumContainsPoint } from '@kyxos/render-math';
import { Scene } from '@kyxos/render-scene';
import { describe, expect, it } from 'vitest';

import { PerspectiveCamera, frameScene } from '../src/index.js';

describe('frameScene', () => {
  it('returns null for an empty Scene without moving the camera', () => {
    const scene = new Scene();
    const camera = new PerspectiveCamera();
    const position = camera.position;

    expect(frameScene(camera, scene)).toBeNull();
    expect(camera.position).toBe(position);
  });

  it('frames only visible entities in the requested layer mask', () => {
    const scene = new Scene();
    const included = scene.createEntity({
      layerMask: 0b01,
      localBounds: createAabb([-1, -1, -1], [1, 1, 1]),
      transform: { translation: [10, 0, 0] },
    });
    scene.createEntity({
      layerMask: 0b10,
      localBounds: createAabb([-50, -50, -50], [50, 50, 50]),
    });
    const camera = new PerspectiveCamera({ aspect: 1.5 });

    const result = frameScene(camera, scene, { bounds: { layerMask: 0b01 } });

    expect(result?.center).toEqual([10, 0, 0]);
    expect(
      frustumContainsPoint(camera.frustum(), scene.worldBoundsOf(included)?.min ?? [0, 0, 0]),
    ).toBe(true);
    expect(
      frustumContainsPoint(camera.frustum(), scene.worldBoundsOf(included)?.max ?? [0, 0, 0]),
    ).toBe(true);
  });
});
