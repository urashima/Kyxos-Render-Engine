import { approximatelyEqualVec3, createAabb } from '@kyxos/render-math';
import { describe, expect, it } from 'vitest';

import { OrbitController, PerspectiveCamera } from '../src/index.js';

describe('OrbitController', () => {
  it('maps yaw and pitch to deterministic Y-up spherical positions', () => {
    const orbit = new OrbitController({ distance: 5 });
    expect(orbit.position()).toEqual([0, 0, 5]);

    orbit.orbit(Math.PI / 2, 0);
    expect(approximatelyEqualVec3(orbit.position(), [5, 0, 0])).toBe(true);
    orbit.orbit(0, Math.PI / 6);
    expect(orbit.position()[1]).toBeCloseTo(2.5, 12);
  });

  it('clamps pitch and distance to configured limits', () => {
    const orbit = new OrbitController({
      distance: 5,
      maxDistance: 10,
      maxPitchRadians: 0.5,
      minDistance: 2,
      minPitchRadians: -0.25,
    });

    orbit.orbit(0, 100);
    expect(orbit.state().pitchRadians).toBe(0.5);
    orbit.dolly(100);
    expect(orbit.state().distance).toBe(10);
    orbit.dolly(0.001);
    expect(orbit.state().distance).toBe(2);
  });

  it('pans in the current camera plane without changing orbit distance', () => {
    const orbit = new OrbitController({ distance: 5 });
    orbit.pan(2, 3);

    expect(orbit.state().target).toEqual([2, 3, 0]);
    expect(orbit.position()).toEqual([2, 3, 5]);
    expect(orbit.state().distance).toBe(5);
  });

  it('applies to and synchronizes from a camera without DOM input', () => {
    const camera = new PerspectiveCamera();
    const orbit = new OrbitController({ distance: 8, pitchRadians: 0.25, yawRadians: 0.75 });
    orbit.applyTo(camera);

    expect(camera.target).toEqual([0, 0, 0]);
    expect(approximatelyEqualVec3(camera.position, orbit.position())).toBe(true);

    camera.setPose({ position: [5, 0, 0], target: [1, 0, 0] });
    orbit.syncFrom(camera);
    expect(orbit.state().distance).toBe(4);
    expect(orbit.state().yawRadians).toBeCloseTo(Math.PI / 2, 12);
    expect(approximatelyEqualVec3(orbit.position(), [5, 0, 0])).toBe(true);
  });

  it('keeps orbit state aligned after automatic framing', () => {
    const camera = new PerspectiveCamera({ aspect: 2 });
    const orbit = new OrbitController();
    const result = orbit.fitBounds(camera, createAabb([-2, -1, -1], [2, 1, 1]));

    expect(orbit.state().target).toEqual([0, 0, 0]);
    expect(orbit.state().distance).toBeCloseTo(result.distance, 12);
    expect(approximatelyEqualVec3(orbit.position(), camera.position)).toBe(true);
  });

  it('rejects nonfinite motion and inconsistent limits', () => {
    expect(() => new OrbitController({ maxDistance: 1, minDistance: 2 })).toThrow(/maxDistance/u);
    expect(() => new OrbitController({ maxPitchRadians: 0, minPitchRadians: 0 })).toThrow(
      /maxPitch/u,
    );
    const orbit = new OrbitController();
    expect(() => orbit.orbit(Number.NaN, 0)).toThrow(/finite/u);
    expect(() => orbit.dolly(0)).toThrow(/greater than zero/u);
    expect(() => orbit.pan(0, Number.POSITIVE_INFINITY)).toThrow(/finite/u);
  });
});
