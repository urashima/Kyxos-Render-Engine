import { boundingSphereFromAabb, createAabb } from '@kyxos/render-math';

import type { Aabb, BoundingSphere } from '@kyxos/render-math';

export type MeshIndexFormat = 'uint16' | 'uint32';

export interface MeshDataDescriptor {
  readonly indices?: ArrayLike<number>;
  readonly name?: string;
  readonly normals?: ArrayLike<number>;
  readonly positions: ArrayLike<number>;
  readonly uv0?: ArrayLike<number>;
}

export interface MeshData {
  readonly bounds: Aabb;
  readonly boundingSphere: BoundingSphere;
  readonly indexCount: number;
  readonly indexFormat: MeshIndexFormat;
  readonly indices: readonly number[];
  readonly name: string;
  readonly normals: readonly number[];
  readonly positions: readonly number[];
  readonly triangleCount: number;
  readonly uv0: readonly number[] | null;
  readonly vertexCount: number;
}

const VECTOR_EPSILON = 1e-12;

function copyFiniteValues(values: ArrayLike<number>, name: string): number[] {
  const result = new Array<number>(values.length);
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === undefined || !Number.isFinite(value)) {
      throw new RangeError(`${name}[${index}] must be finite; received ${String(value)}.`);
    }
    result[index] = value;
  }
  return result;
}

function createIndices(values: ArrayLike<number> | undefined, vertexCount: number): number[] {
  if (values === undefined) {
    if (vertexCount % 3 !== 0) {
      throw new RangeError('A non-indexed triangle list requires a vertex count divisible by 3.');
    }
    return Array.from({ length: vertexCount }, (_, index) => index);
  }

  const result = new Array<number>(values.length);
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === undefined || !Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(`${nameForIndex(index)} must be a non-negative safe integer.`);
    }
    if (value >= vertexCount) {
      throw new RangeError(`${nameForIndex(index)} ${value} exceeds vertex count ${vertexCount}.`);
    }
    result[index] = value;
  }
  return result;
}

function nameForIndex(index: number): string {
  return `indices[${index}]`;
}

function triangleNormal(
  positions: readonly number[],
  first: number,
  second: number,
  third: number,
  triangleIndex: number,
): readonly [number, number, number] {
  const firstOffset = first * 3;
  const secondOffset = second * 3;
  const thirdOffset = third * 3;
  const edgeAx = (positions[secondOffset] as number) - (positions[firstOffset] as number);
  const edgeAy = (positions[secondOffset + 1] as number) - (positions[firstOffset + 1] as number);
  const edgeAz = (positions[secondOffset + 2] as number) - (positions[firstOffset + 2] as number);
  const edgeBx = (positions[thirdOffset] as number) - (positions[firstOffset] as number);
  const edgeBy = (positions[thirdOffset + 1] as number) - (positions[firstOffset + 1] as number);
  const edgeBz = (positions[thirdOffset + 2] as number) - (positions[firstOffset + 2] as number);
  const x = edgeAy * edgeBz - edgeAz * edgeBy;
  const y = edgeAz * edgeBx - edgeAx * edgeBz;
  const z = edgeAx * edgeBy - edgeAy * edgeBx;
  const length = Math.hypot(x, y, z);
  if (!Number.isFinite(length) || length <= VECTOR_EPSILON) {
    throw new RangeError(`Triangle ${triangleIndex} is degenerate or nonfinite.`);
  }
  return [x, y, z];
}

function validateTriangles(positions: readonly number[], indices: readonly number[]): void {
  for (let offset = 0; offset < indices.length; offset += 3) {
    triangleNormal(
      positions,
      indices[offset] as number,
      indices[offset + 1] as number,
      indices[offset + 2] as number,
      offset / 3,
    );
  }
}

function generateNormals(
  positions: readonly number[],
  indices: readonly number[],
  vertexCount: number,
): number[] {
  const normals = new Array<number>(vertexCount * 3).fill(0);
  for (let offset = 0; offset < indices.length; offset += 3) {
    const first = indices[offset] as number;
    const second = indices[offset + 1] as number;
    const third = indices[offset + 2] as number;
    const normal = triangleNormal(positions, first, second, third, offset / 3);
    for (const vertexIndex of [first, second, third]) {
      const normalOffset = vertexIndex * 3;
      normals[normalOffset] = (normals[normalOffset] as number) + normal[0];
      normals[normalOffset + 1] = (normals[normalOffset + 1] as number) + normal[1];
      normals[normalOffset + 2] = (normals[normalOffset + 2] as number) + normal[2];
    }
  }
  return normalizeNormals(normals, vertexCount, 'generated normals');
}

function normalizeNormals(values: readonly number[], vertexCount: number, name: string): number[] {
  const result = new Array<number>(vertexCount * 3);
  for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1) {
    const offset = vertexIndex * 3;
    const x = values[offset] as number;
    const y = values[offset + 1] as number;
    const z = values[offset + 2] as number;
    const length = Math.hypot(x, y, z);
    if (!Number.isFinite(length) || length <= VECTOR_EPSILON) {
      throw new RangeError(`${name} contains a zero-length value at vertex ${vertexIndex}.`);
    }
    result[offset] = x / length;
    result[offset + 1] = y / length;
    result[offset + 2] = z / length;
  }
  return result;
}

function calculateBounds(positions: readonly number[]): Aabb {
  let minX = positions[0] as number;
  let minY = positions[1] as number;
  let minZ = positions[2] as number;
  let maxX = minX;
  let maxY = minY;
  let maxZ = minZ;
  for (let offset = 3; offset < positions.length; offset += 3) {
    const x = positions[offset] as number;
    const y = positions[offset + 1] as number;
    const z = positions[offset + 2] as number;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }
  return createAabb([minX, minY, minZ], [maxX, maxY, maxZ]);
}

export function createMeshData(descriptor: MeshDataDescriptor): MeshData {
  const positions = copyFiniteValues(descriptor.positions, 'positions');
  if (positions.length === 0 || positions.length % 3 !== 0) {
    throw new RangeError('positions must contain one or more complete XYZ vertices.');
  }
  const vertexCount = positions.length / 3;
  const indices = createIndices(descriptor.indices, vertexCount);
  if (indices.length === 0 || indices.length % 3 !== 0) {
    throw new RangeError('indices must contain one or more complete triangles.');
  }
  validateTriangles(positions, indices);

  let normals: number[];
  if (descriptor.normals === undefined) {
    normals = generateNormals(positions, indices, vertexCount);
  } else {
    const copiedNormals = copyFiniteValues(descriptor.normals, 'normals');
    if (copiedNormals.length !== vertexCount * 3) {
      throw new RangeError(`normals must contain exactly ${vertexCount * 3} values.`);
    }
    normals = normalizeNormals(copiedNormals, vertexCount, 'normals');
  }

  let uv0: number[] | null = null;
  if (descriptor.uv0 !== undefined) {
    uv0 = copyFiniteValues(descriptor.uv0, 'uv0');
    if (uv0.length !== vertexCount * 2) {
      throw new RangeError(`uv0 must contain exactly ${vertexCount * 2} values.`);
    }
  }

  let maximumIndex = 0;
  for (const index of indices) maximumIndex = Math.max(maximumIndex, index);
  const bounds = calculateBounds(positions);
  const name = descriptor.name?.trim() ?? 'mesh';
  if (name.length === 0) throw new RangeError('name must not be empty.');

  return Object.freeze({
    bounds,
    boundingSphere: boundingSphereFromAabb(bounds),
    indexCount: indices.length,
    indexFormat: maximumIndex <= 65_535 ? 'uint16' : 'uint32',
    indices: Object.freeze(indices),
    name,
    normals: Object.freeze(normals),
    positions: Object.freeze(positions),
    triangleCount: indices.length / 3,
    uv0: uv0 === null ? null : Object.freeze(uv0),
    vertexCount,
  });
}
