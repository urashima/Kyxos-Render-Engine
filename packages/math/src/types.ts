export type Vec3 = readonly [x: number, y: number, z: number];

export type Quaternion = readonly [x: number, y: number, z: number, w: number];

export type Mat4 = readonly [
  m00: number,
  m01: number,
  m02: number,
  m03: number,
  m10: number,
  m11: number,
  m12: number,
  m13: number,
  m20: number,
  m21: number,
  m22: number,
  m23: number,
  m30: number,
  m31: number,
  m32: number,
  m33: number,
];

export interface Aabb {
  readonly min: Vec3;
  readonly max: Vec3;
}

export interface BoundingSphere {
  readonly center: Vec3;
  readonly radius: number;
}

export interface Plane {
  readonly normal: Vec3;
  readonly constant: number;
}

export type FrustumPlanes = readonly [
  left: Plane,
  right: Plane,
  bottom: Plane,
  top: Plane,
  near: Plane,
  far: Plane,
];

export interface Frustum {
  readonly planes: FrustumPlanes;
}
