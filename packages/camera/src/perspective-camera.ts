import { KyxosEngineError, TypedEventEmitter } from '@kyxos/render-core';
import {
  aabbCenter,
  boundingSphereFromAabb,
  createVec3,
  extractFrustum,
  lookAtMat4,
  multiplyMat4,
  normalizeVec3,
  perspectiveMat4,
  scaleVec3,
  subtractVec3,
} from '@kyxos/render-math';

import type { Disposable, EventListener, Unsubscribe } from '@kyxos/render-core';
import type { Aabb, Frustum, Mat4, Vec3 } from '@kyxos/render-math';

export interface PerspectiveCameraOptions {
  readonly aspect?: number;
  readonly far?: number;
  readonly near?: number;
  readonly position?: Vec3;
  readonly target?: Vec3;
  readonly up?: Vec3;
  readonly verticalFieldOfViewRadians?: number;
}

export interface CameraPoseOptions {
  readonly position: Vec3;
  readonly target: Vec3;
  readonly up?: Vec3;
}

export interface CameraPerspectiveOptions {
  readonly aspect: number;
  readonly far: number;
  readonly near: number;
  readonly verticalFieldOfViewRadians: number;
}

export interface CameraFitOptions {
  readonly minimumDistance?: number;
  readonly minimumNear?: number;
  readonly padding?: number;
}

export interface CameraFitResult {
  readonly center: Vec3;
  readonly distance: number;
  readonly far: number;
  readonly near: number;
  readonly paddedRadius: number;
}

export type CameraChangeKind = 'pose' | 'projection';

export interface CameraChangeEvent {
  readonly kind: CameraChangeKind;
  readonly revision: number;
}

export interface CameraEvents {
  readonly changed: CameraChangeEvent;
}

export interface CameraDiagnostics {
  readonly projectionMatrixUpdateCount: number;
  readonly revision: number;
  readonly viewMatrixUpdateCount: number;
  readonly viewProjectionMatrixUpdateCount: number;
}

export class PerspectiveCamera implements Disposable {
  readonly #events = new TypedEventEmitter<CameraEvents>();
  #aspect: number;
  #disposed = false;
  #far: number;
  #frustum: Frustum | null = null;
  #near: number;
  #position: Vec3;
  #projectionMatrix: Mat4 | null = null;
  #projectionMatrixUpdateCount = 0;
  #revision = 0;
  #target: Vec3;
  #up: Vec3;
  #verticalFieldOfViewRadians: number;
  #viewMatrix: Mat4 | null = null;
  #viewMatrixUpdateCount = 0;
  #viewProjectionMatrix: Mat4 | null = null;
  #viewProjectionMatrixUpdateCount = 0;

  constructor(options: PerspectiveCameraOptions = {}) {
    const pose = this.#validatePose({
      position: options.position ?? [0, 0, 5],
      target: options.target ?? [0, 0, 0],
      up: options.up ?? [0, 1, 0],
    });
    const perspective = this.#validatePerspective({
      aspect: options.aspect ?? 1,
      far: options.far ?? 1_000,
      near: options.near ?? 0.1,
      verticalFieldOfViewRadians: options.verticalFieldOfViewRadians ?? Math.PI / 4,
    });
    this.#position = pose.position;
    this.#target = pose.target;
    this.#up = pose.up;
    this.#aspect = perspective.aspect;
    this.#far = perspective.far;
    this.#near = perspective.near;
    this.#verticalFieldOfViewRadians = perspective.verticalFieldOfViewRadians;
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  get revision(): number {
    return this.#revision;
  }

  get aspect(): number {
    this.#assertActive();
    return this.#aspect;
  }

  get far(): number {
    this.#assertActive();
    return this.#far;
  }

  get near(): number {
    this.#assertActive();
    return this.#near;
  }

  get position(): Vec3 {
    this.#assertActive();
    return this.#position;
  }

  get target(): Vec3 {
    this.#assertActive();
    return this.#target;
  }

  get up(): Vec3 {
    this.#assertActive();
    return this.#up;
  }

  get verticalFieldOfViewRadians(): number {
    this.#assertActive();
    return this.#verticalFieldOfViewRadians;
  }

  on<EventName extends keyof CameraEvents>(
    eventName: EventName,
    listener: EventListener<CameraEvents[EventName]>,
  ): Unsubscribe {
    this.#assertActive();
    return this.#events.on(eventName, listener);
  }

  setPose(options: CameraPoseOptions): void {
    this.#assertActive();
    const pose = this.#validatePose({ ...options, up: options.up ?? this.#up });
    if (
      this.#vectorsEqual(this.#position, pose.position) &&
      this.#vectorsEqual(this.#target, pose.target) &&
      this.#vectorsEqual(this.#up, pose.up)
    ) {
      return;
    }
    this.#position = pose.position;
    this.#target = pose.target;
    this.#up = pose.up;
    this.#invalidateView();
    this.#emitChange('pose');
  }

  setPerspective(options: CameraPerspectiveOptions): void {
    this.#assertActive();
    const perspective = this.#validatePerspective(options);
    if (
      this.#aspect === perspective.aspect &&
      this.#far === perspective.far &&
      this.#near === perspective.near &&
      this.#verticalFieldOfViewRadians === perspective.verticalFieldOfViewRadians
    ) {
      return;
    }
    this.#aspect = perspective.aspect;
    this.#far = perspective.far;
    this.#near = perspective.near;
    this.#verticalFieldOfViewRadians = perspective.verticalFieldOfViewRadians;
    this.#invalidateProjection();
    this.#emitChange('projection');
  }

  setAspect(aspect: number): void {
    this.setPerspective({
      aspect,
      far: this.#far,
      near: this.#near,
      verticalFieldOfViewRadians: this.#verticalFieldOfViewRadians,
    });
  }

  direction(): Vec3 {
    this.#assertActive();
    return normalizeVec3(subtractVec3(this.#target, this.#position));
  }

  viewMatrix(): Mat4 {
    this.#assertActive();
    if (this.#viewMatrix === null) {
      this.#viewMatrix = lookAtMat4(this.#position, this.#target, this.#up);
      this.#viewMatrixUpdateCount += 1;
    }
    return this.#viewMatrix;
  }

  projectionMatrix(): Mat4 {
    this.#assertActive();
    if (this.#projectionMatrix === null) {
      this.#projectionMatrix = perspectiveMat4(
        this.#verticalFieldOfViewRadians,
        this.#aspect,
        this.#near,
        this.#far,
      );
      this.#projectionMatrixUpdateCount += 1;
    }
    return this.#projectionMatrix;
  }

  viewProjectionMatrix(): Mat4 {
    this.#assertActive();
    if (this.#viewProjectionMatrix === null) {
      this.#viewProjectionMatrix = multiplyMat4(this.projectionMatrix(), this.viewMatrix());
      this.#viewProjectionMatrixUpdateCount += 1;
    }
    return this.#viewProjectionMatrix;
  }

  frustum(): Frustum {
    this.#assertActive();
    this.#frustum ??= extractFrustum(this.viewProjectionMatrix());
    return this.#frustum;
  }

  fitBounds(bounds: Aabb, options: CameraFitOptions = {}): CameraFitResult {
    this.#assertActive();
    const padding = this.#positiveFinite('padding', options.padding ?? 1.15);
    if (padding < 1) throw this.#error('padding must be at least 1.', 'INVALID_ARGUMENT');
    const minimumDistance = this.#positiveFinite(
      'minimumDistance',
      options.minimumDistance ?? 0.25,
    );
    const minimumNear = this.#positiveFinite('minimumNear', options.minimumNear ?? 0.01);
    const center = aabbCenter(bounds);
    const sphere = boundingSphereFromAabb(bounds);
    const paddedRadius = Math.max(sphere.radius * padding, minimumDistance * 0.01);
    const verticalHalfAngle = this.#verticalFieldOfViewRadians / 2;
    const horizontalHalfAngle = Math.atan(Math.tan(verticalHalfAngle) * this.#aspect);
    const limitingHalfAngle = Math.min(verticalHalfAngle, horizontalHalfAngle);
    const distance = Math.max(minimumDistance, paddedRadius / Math.sin(limitingHalfAngle));
    const direction = this.direction();
    const position = subtractVec3(center, scaleVec3(direction, distance));
    const depthPadding = Math.max(paddedRadius * 0.05, minimumNear);
    const near = Math.max(minimumNear, distance - paddedRadius - depthPadding);
    const far = Math.max(near + minimumNear, distance + paddedRadius + depthPadding);

    this.setPose({ position, target: center, up: this.#up });
    this.setPerspective({
      aspect: this.#aspect,
      far,
      near,
      verticalFieldOfViewRadians: this.#verticalFieldOfViewRadians,
    });
    return Object.freeze({ center, distance, far, near, paddedRadius });
  }

  diagnostics(): CameraDiagnostics {
    this.#assertActive();
    return Object.freeze({
      projectionMatrixUpdateCount: this.#projectionMatrixUpdateCount,
      revision: this.#revision,
      viewMatrixUpdateCount: this.#viewMatrixUpdateCount,
      viewProjectionMatrixUpdateCount: this.#viewProjectionMatrixUpdateCount,
    });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#events.dispose();
    this.#viewMatrix = null;
    this.#projectionMatrix = null;
    this.#viewProjectionMatrix = null;
    this.#frustum = null;
  }

  #validatePose(options: Required<CameraPoseOptions>): Required<CameraPoseOptions> {
    const position = createVec3(options.position[0], options.position[1], options.position[2]);
    const target = createVec3(options.target[0], options.target[1], options.target[2]);
    const up = createVec3(options.up[0], options.up[1], options.up[2]);
    lookAtMat4(position, target, up);
    return Object.freeze({ position, target, up });
  }

  #validatePerspective(options: CameraPerspectiveOptions): CameraPerspectiveOptions {
    if (!Number.isFinite(options.far)) {
      throw this.#error('Camera far plane must be finite.', 'INVALID_ARGUMENT');
    }
    perspectiveMat4(options.verticalFieldOfViewRadians, options.aspect, options.near, options.far);
    return Object.freeze({ ...options });
  }

  #invalidateView(): void {
    this.#viewMatrix = null;
    this.#viewProjectionMatrix = null;
    this.#frustum = null;
  }

  #invalidateProjection(): void {
    this.#projectionMatrix = null;
    this.#viewProjectionMatrix = null;
    this.#frustum = null;
  }

  #emitChange(kind: CameraChangeKind): void {
    this.#revision += 1;
    this.#events.emit('changed', Object.freeze({ kind, revision: this.#revision }));
  }

  #vectorsEqual(left: Vec3, right: Vec3): boolean {
    return left[0] === right[0] && left[1] === right[1] && left[2] === right[2];
  }

  #positiveFinite(name: string, value: number): number {
    if (!Number.isFinite(value) || value <= 0) {
      throw this.#error(`${name} must be finite and greater than zero.`, 'INVALID_ARGUMENT');
    }
    return value;
  }

  #assertActive(): void {
    if (this.#disposed) throw this.#error('Camera is disposed.', 'ALREADY_DISPOSED');
  }

  #error(message: string, code: 'ALREADY_DISPOSED' | 'INVALID_ARGUMENT'): KyxosEngineError {
    return new KyxosEngineError(message, { code, module: 'camera', recoverable: false });
  }
}
