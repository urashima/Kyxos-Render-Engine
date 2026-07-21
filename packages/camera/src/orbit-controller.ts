import {
  addVec3,
  createVec3,
  crossVec3,
  distanceVec3,
  normalizeVec3,
  scaleVec3,
  subtractVec3,
} from '@kyxos/render-math';

import type { Vec3 } from '@kyxos/render-math';
import type { CameraFitOptions, CameraFitResult, PerspectiveCamera } from './perspective-camera.js';

export interface OrbitControllerOptions {
  readonly distance?: number;
  readonly maxDistance?: number;
  readonly maxPitchRadians?: number;
  readonly minDistance?: number;
  readonly minPitchRadians?: number;
  readonly pitchRadians?: number;
  readonly target?: Vec3;
  readonly yawRadians?: number;
}

export interface OrbitState {
  readonly distance: number;
  readonly pitchRadians: number;
  readonly revision: number;
  readonly target: Vec3;
  readonly yawRadians: number;
}

export class OrbitController {
  readonly #maxDistance: number;
  readonly #maxPitchRadians: number;
  readonly #minDistance: number;
  readonly #minPitchRadians: number;
  #distance: number;
  #pitchRadians: number;
  #revision = 0;
  #target: Vec3;
  #yawRadians: number;

  constructor(options: OrbitControllerOptions = {}) {
    this.#minDistance = this.#positiveFinite('minDistance', options.minDistance ?? 0.01);
    this.#maxDistance = this.#positiveFinite('maxDistance', options.maxDistance ?? 1_000_000);
    if (this.#maxDistance < this.#minDistance) {
      throw new RangeError('maxDistance must be greater than or equal to minDistance.');
    }
    this.#minPitchRadians = this.#finite(
      'minPitchRadians',
      options.minPitchRadians ?? -Math.PI / 2 + 0.001,
    );
    this.#maxPitchRadians = this.#finite(
      'maxPitchRadians',
      options.maxPitchRadians ?? Math.PI / 2 - 0.001,
    );
    if (this.#maxPitchRadians <= this.#minPitchRadians) {
      throw new RangeError('maxPitchRadians must be greater than minPitchRadians.');
    }
    this.#target = this.#copyTarget(options.target ?? [0, 0, 0]);
    this.#distance = this.#clampDistance(options.distance ?? 5);
    this.#yawRadians = this.#finite('yawRadians', options.yawRadians ?? 0);
    this.#pitchRadians = this.#clampPitch(options.pitchRadians ?? 0);
  }

  state(): OrbitState {
    return Object.freeze({
      distance: this.#distance,
      pitchRadians: this.#pitchRadians,
      revision: this.#revision,
      target: this.#target,
      yawRadians: this.#yawRadians,
    });
  }

  position(): Vec3 {
    const horizontalDistance = this.#distance * Math.cos(this.#pitchRadians);
    return createVec3(
      this.#target[0] + horizontalDistance * Math.sin(this.#yawRadians),
      this.#target[1] + this.#distance * Math.sin(this.#pitchRadians),
      this.#target[2] + horizontalDistance * Math.cos(this.#yawRadians),
    );
  }

  setTarget(target: Vec3): void {
    const next = this.#copyTarget(target);
    if (this.#vectorsEqual(next, this.#target)) return;
    this.#target = next;
    this.#revision += 1;
  }

  setDistance(distance: number): void {
    const next = this.#clampDistance(distance);
    if (next === this.#distance) return;
    this.#distance = next;
    this.#revision += 1;
  }

  orbit(deltaYawRadians: number, deltaPitchRadians: number): void {
    const yaw = this.#yawRadians + this.#finite('deltaYawRadians', deltaYawRadians);
    const pitch = this.#clampPitch(
      this.#pitchRadians + this.#finite('deltaPitchRadians', deltaPitchRadians),
    );
    if (yaw === this.#yawRadians && pitch === this.#pitchRadians) return;
    this.#yawRadians = yaw;
    this.#pitchRadians = pitch;
    this.#revision += 1;
  }

  dolly(scale: number): void {
    const validated = this.#positiveFinite('scale', scale);
    this.setDistance(this.#distance * validated);
  }

  pan(rightDistance: number, upDistance: number): void {
    const rightDelta = this.#finite('rightDistance', rightDistance);
    const upDelta = this.#finite('upDistance', upDistance);
    if (rightDelta === 0 && upDelta === 0) return;
    const position = this.position();
    const forward = normalizeVec3(subtractVec3(this.#target, position));
    const right = normalizeVec3(crossVec3(forward, [0, 1, 0]));
    const cameraUp = normalizeVec3(crossVec3(right, forward));
    this.#target = addVec3(
      this.#target,
      addVec3(scaleVec3(right, rightDelta), scaleVec3(cameraUp, upDelta)),
    );
    this.#revision += 1;
  }

  applyTo(camera: PerspectiveCamera): void {
    camera.setPose({ position: this.position(), target: this.#target, up: [0, 1, 0] });
  }

  syncFrom(camera: PerspectiveCamera): void {
    const target = this.#copyTarget(camera.target);
    const offset = subtractVec3(camera.position, target);
    const distance = distanceVec3(camera.position, target);
    const yaw = Math.atan2(offset[0], offset[2]);
    const pitch = Math.asin(Math.max(-1, Math.min(1, offset[1] / distance)));
    const nextDistance = this.#clampDistance(distance);
    const nextPitch = this.#clampPitch(pitch);
    if (
      this.#vectorsEqual(this.#target, target) &&
      this.#distance === nextDistance &&
      this.#yawRadians === yaw &&
      this.#pitchRadians === nextPitch
    ) {
      return;
    }
    this.#target = target;
    this.#distance = nextDistance;
    this.#yawRadians = yaw;
    this.#pitchRadians = nextPitch;
    this.#revision += 1;
  }

  fitBounds(
    camera: PerspectiveCamera,
    bounds: Parameters<PerspectiveCamera['fitBounds']>[0],
    options?: CameraFitOptions,
  ): CameraFitResult {
    const result = camera.fitBounds(bounds, options);
    this.syncFrom(camera);
    return result;
  }

  #copyTarget(value: Vec3): Vec3 {
    return createVec3(value[0], value[1], value[2]);
  }

  #clampDistance(value: number): number {
    return Math.max(
      this.#minDistance,
      Math.min(this.#maxDistance, this.#positiveFinite('distance', value)),
    );
  }

  #clampPitch(value: number): number {
    return Math.max(
      this.#minPitchRadians,
      Math.min(this.#maxPitchRadians, this.#finite('pitch', value)),
    );
  }

  #finite(name: string, value: number): number {
    if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite.`);
    return value;
  }

  #positiveFinite(name: string, value: number): number {
    if (!Number.isFinite(value) || value <= 0) {
      throw new RangeError(`${name} must be finite and greater than zero.`);
    }
    return value;
  }

  #vectorsEqual(left: Vec3, right: Vec3): boolean {
    return left[0] === right[0] && left[1] === right[1] && left[2] === right[2];
  }
}
