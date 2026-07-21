import { createAabb, frustumContainsPoint, transformPointMat4 } from '@kyxos/render-math';
import { describe, expect, it, vi } from 'vitest';

import { PerspectiveCamera } from '../src/index.js';

import type { Aabb, Vec3 } from '@kyxos/render-math';

function corners(bounds: Aabb): readonly Vec3[] {
  const { min, max } = bounds;
  return [
    [min[0], min[1], min[2]],
    [max[0], min[1], min[2]],
    [min[0], max[1], min[2]],
    [max[0], max[1], min[2]],
    [min[0], min[1], max[2]],
    [max[0], min[1], max[2]],
    [min[0], max[1], max[2]],
    [max[0], max[1], max[2]],
  ];
}

describe('PerspectiveCamera', () => {
  it('uses a right-handed negative-Z view and zero-to-one depth', () => {
    const camera = new PerspectiveCamera({
      aspect: 1,
      far: 100,
      near: 0.1,
      position: [0, 0, 5],
      target: [0, 0, 0],
      verticalFieldOfViewRadians: Math.PI / 2,
    });

    expect(transformPointMat4(camera.viewMatrix(), [0, 0, 0])).toEqual([0, 0, -5]);
    expect(transformPointMat4(camera.projectionMatrix(), [0, 0, -0.1])[2]).toBeCloseTo(0, 12);
    expect(transformPointMat4(camera.projectionMatrix(), [0, 0, -100])[2]).toBeCloseTo(1, 12);
  });

  it('caches matrices and invalidates only the affected chain', () => {
    const camera = new PerspectiveCamera();
    camera.viewProjectionMatrix();
    camera.viewProjectionMatrix();
    expect(camera.diagnostics()).toMatchObject({
      projectionMatrixUpdateCount: 1,
      viewMatrixUpdateCount: 1,
      viewProjectionMatrixUpdateCount: 1,
    });

    camera.setAspect(2);
    camera.viewProjectionMatrix();
    expect(camera.diagnostics()).toMatchObject({
      projectionMatrixUpdateCount: 2,
      viewMatrixUpdateCount: 1,
      viewProjectionMatrixUpdateCount: 2,
    });

    camera.setPose({ position: [1, 0, 5], target: [0, 0, 0] });
    camera.viewProjectionMatrix();
    expect(camera.diagnostics()).toMatchObject({
      projectionMatrixUpdateCount: 2,
      viewMatrixUpdateCount: 2,
      viewProjectionMatrixUpdateCount: 3,
    });
  });

  it('emits revisioned changes and ignores identical setters', () => {
    const camera = new PerspectiveCamera();
    const listener = vi.fn();
    camera.on('changed', listener);

    camera.setAspect(1);
    camera.setAspect(2);
    camera.setPose({ position: camera.position, target: camera.target });
    camera.setPose({ position: [0, 1, 5], target: [0, 0, 0] });

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls.map(([event]) => event)).toEqual([
      { kind: 'projection', revision: 1 },
      { kind: 'pose', revision: 2 },
    ]);
  });

  it('fits every AABB corner across portrait, square, and landscape aspects', () => {
    const bounds = createAabb([-4, -2, -1], [6, 3, 5]);
    for (const aspect of [0.5, 1, 2]) {
      const camera = new PerspectiveCamera({ aspect, position: [5, 4, 9], target: [0, 0, 0] });
      const result = camera.fitBounds(bounds);

      expect(result.distance).toBeGreaterThan(result.paddedRadius);
      expect(result.near).toBeGreaterThan(0);
      expect(result.far).toBeGreaterThan(result.near);
      for (const corner of corners(bounds)) {
        expect(frustumContainsPoint(camera.frustum(), corner)).toBe(true);
      }
    }
  });

  it('fits degenerate point bounds with a finite nonzero clip range', () => {
    const camera = new PerspectiveCamera();
    const result = camera.fitBounds(createAabb([2, 3, 4], [2, 3, 4]));

    expect(camera.target).toEqual([2, 3, 4]);
    expect(result.distance).toBeGreaterThanOrEqual(0.25);
    expect(Number.isFinite(result.near)).toBe(true);
    expect(Number.isFinite(result.far)).toBe(true);
  });

  it('rejects invalid poses, infinite far planes, and post-disposal use', () => {
    expect(() => new PerspectiveCamera({ position: [0, 0, 0], target: [0, 0, 0] })).toThrow(
      /zero-length/u,
    );
    expect(() => new PerspectiveCamera({ far: Number.POSITIVE_INFINITY })).toThrow(/finite/u);
    const camera = new PerspectiveCamera();
    expect(() => camera.setAspect(0)).toThrow(/aspect/u);
    expect(() => camera.fitBounds(createAabb([-1, -1, -1], [1, 1, 1]), { padding: 0.5 })).toThrow(
      /at least 1/u,
    );
    camera.dispose();
    camera.dispose();
    expect(() => camera.viewMatrix()).toThrow(/disposed/u);
  });
});
