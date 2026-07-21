import { createMeshData } from './mesh-data.js';

import type { MeshData } from './mesh-data.js';

export interface PlaneGeometryOptions {
  readonly depth?: number;
  readonly width?: number;
}

export interface CubeGeometryOptions {
  readonly depth?: number;
  readonly height?: number;
  readonly width?: number;
}

export interface UvSphereGeometryOptions {
  readonly heightSegments?: number;
  readonly radius?: number;
  readonly widthSegments?: number;
}

function positiveFinite(name: string, value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be finite and greater than zero.`);
  }
  return value;
}

function integerAtLeast(name: string, value: number, minimum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new RangeError(`${name} must be a safe integer of at least ${minimum}.`);
  }
  return value;
}

export function createPlaneGeometry(options: PlaneGeometryOptions = {}): MeshData {
  const width = positiveFinite('width', options.width ?? 1);
  const depth = positiveFinite('depth', options.depth ?? 1);
  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  return createMeshData({
    indices: [0, 1, 2, 0, 2, 3],
    name: 'plane',
    normals: [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0],
    positions: [
      -halfWidth,
      0,
      -halfDepth,
      -halfWidth,
      0,
      halfDepth,
      halfWidth,
      0,
      halfDepth,
      halfWidth,
      0,
      -halfDepth,
    ],
    uv0: [0, 0, 0, 1, 1, 1, 1, 0],
  });
}

export function createCubeGeometry(options: CubeGeometryOptions = {}): MeshData {
  const width = positiveFinite('width', options.width ?? 1);
  const height = positiveFinite('height', options.height ?? 1);
  const depth = positiveFinite('depth', options.depth ?? 1);
  const x = width / 2;
  const y = height / 2;
  const z = depth / 2;
  const faces = [
    {
      normal: [1, 0, 0],
      vertices: [
        [x, -y, -z],
        [x, y, -z],
        [x, y, z],
        [x, -y, z],
      ],
    },
    {
      normal: [-1, 0, 0],
      vertices: [
        [-x, -y, z],
        [-x, y, z],
        [-x, y, -z],
        [-x, -y, -z],
      ],
    },
    {
      normal: [0, 1, 0],
      vertices: [
        [-x, y, -z],
        [-x, y, z],
        [x, y, z],
        [x, y, -z],
      ],
    },
    {
      normal: [0, -1, 0],
      vertices: [
        [-x, -y, z],
        [-x, -y, -z],
        [x, -y, -z],
        [x, -y, z],
      ],
    },
    {
      normal: [0, 0, 1],
      vertices: [
        [x, -y, z],
        [x, y, z],
        [-x, y, z],
        [-x, -y, z],
      ],
    },
    {
      normal: [0, 0, -1],
      vertices: [
        [-x, -y, -z],
        [-x, y, -z],
        [x, y, -z],
        [x, -y, -z],
      ],
    },
  ] as const;
  const positions: number[] = [];
  const normals: number[] = [];
  const uv0: number[] = [];
  const indices: number[] = [];
  const faceUvs = [
    [0, 0],
    [0, 1],
    [1, 1],
    [1, 0],
  ] as const;
  for (const [faceIndex, face] of faces.entries()) {
    const base = faceIndex * 4;
    for (let corner = 0; corner < 4; corner += 1) {
      positions.push(...(face.vertices[corner] as readonly number[]));
      normals.push(...face.normal);
      uv0.push(...(faceUvs[corner] as readonly number[]));
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return createMeshData({ indices, name: 'cube', normals, positions, uv0 });
}

export function createUvSphereGeometry(options: UvSphereGeometryOptions = {}): MeshData {
  const radius = positiveFinite('radius', options.radius ?? 0.5);
  const widthSegments = integerAtLeast('widthSegments', options.widthSegments ?? 32, 3);
  const heightSegments = integerAtLeast('heightSegments', options.heightSegments ?? 16, 2);
  const positions: number[] = [];
  const normals: number[] = [];
  const uv0: number[] = [];
  const indices: number[] = [];
  const columns = widthSegments + 1;

  for (let row = 0; row <= heightSegments; row += 1) {
    const v = row / heightSegments;
    const theta = v * Math.PI;
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);
    for (let column = 0; column <= widthSegments; column += 1) {
      const u = column / widthSegments;
      const phi = u * Math.PI * 2;
      const normalX = sinTheta * Math.cos(phi);
      const normalY = cosTheta;
      const normalZ = sinTheta * Math.sin(phi);
      positions.push(normalX * radius, normalY * radius, normalZ * radius);
      normals.push(normalX, normalY, normalZ);
      uv0.push(u, 1 - v);
    }
  }

  for (let row = 0; row < heightSegments; row += 1) {
    for (let column = 0; column < widthSegments; column += 1) {
      const topLeft = row * columns + column;
      const topRight = topLeft + 1;
      const bottomLeft = (row + 1) * columns + column;
      const bottomRight = bottomLeft + 1;
      if (row !== 0) indices.push(topLeft, topRight, bottomLeft);
      if (row !== heightSegments - 1) indices.push(topRight, bottomRight, bottomLeft);
    }
  }

  return createMeshData({ indices, name: 'uv-sphere', normals, positions, uv0 });
}
