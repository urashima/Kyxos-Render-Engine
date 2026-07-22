import type { MeshData } from './mesh-data.js';

const UV_EPSILON = 1e-12;

function fallbackTangent(
  normalX: number,
  normalY: number,
  normalZ: number,
): readonly [number, number, number] {
  const axisX = Math.abs(normalX) < 0.9 ? 1 : 0;
  const axisY = axisX === 0 ? 1 : 0;
  const projection = axisX * normalX + axisY * normalY;
  const x = axisX - normalX * projection;
  const y = axisY - normalY * projection;
  const z = -normalZ * projection;
  const length = Math.hypot(x, y, z);
  return [x / length, y / length, z / length];
}

/**
 * Generates an immutable vec4 tangent per vertex from Position, Normal, UV0,
 * and triangle indices. The W component is the bitangent handedness sign.
 */
export function generateMeshTangents(mesh: MeshData): readonly number[] {
  if (mesh.tangents !== null) return mesh.tangents;
  if (mesh.uv0 === null) {
    throw new RangeError(`Mesh "${mesh.name}" requires UV0 to generate Tangents.`);
  }

  const tangents = new Array<number>(mesh.vertexCount * 3).fill(0);
  const bitangents = new Array<number>(mesh.vertexCount * 3).fill(0);
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    const first = mesh.indices[offset] as number;
    const second = mesh.indices[offset + 1] as number;
    const third = mesh.indices[offset + 2] as number;
    const firstPosition = first * 3;
    const secondPosition = second * 3;
    const thirdPosition = third * 3;
    const firstUv = first * 2;
    const secondUv = second * 2;
    const thirdUv = third * 2;
    const edge1X =
      (mesh.positions[secondPosition] as number) - (mesh.positions[firstPosition] as number);
    const edge1Y =
      (mesh.positions[secondPosition + 1] as number) -
      (mesh.positions[firstPosition + 1] as number);
    const edge1Z =
      (mesh.positions[secondPosition + 2] as number) -
      (mesh.positions[firstPosition + 2] as number);
    const edge2X =
      (mesh.positions[thirdPosition] as number) - (mesh.positions[firstPosition] as number);
    const edge2Y =
      (mesh.positions[thirdPosition + 1] as number) - (mesh.positions[firstPosition + 1] as number);
    const edge2Z =
      (mesh.positions[thirdPosition + 2] as number) - (mesh.positions[firstPosition + 2] as number);
    const deltaU1 = (mesh.uv0[secondUv] as number) - (mesh.uv0[firstUv] as number);
    const deltaV1 = (mesh.uv0[secondUv + 1] as number) - (mesh.uv0[firstUv + 1] as number);
    const deltaU2 = (mesh.uv0[thirdUv] as number) - (mesh.uv0[firstUv] as number);
    const deltaV2 = (mesh.uv0[thirdUv + 1] as number) - (mesh.uv0[firstUv + 1] as number);
    const determinant = deltaU1 * deltaV2 - deltaV1 * deltaU2;
    if (!Number.isFinite(determinant) || Math.abs(determinant) <= UV_EPSILON) continue;
    const inverse = 1 / determinant;
    const tangent = [
      (edge1X * deltaV2 - edge2X * deltaV1) * inverse,
      (edge1Y * deltaV2 - edge2Y * deltaV1) * inverse,
      (edge1Z * deltaV2 - edge2Z * deltaV1) * inverse,
    ] as const;
    const bitangent = [
      (edge2X * deltaU1 - edge1X * deltaU2) * inverse,
      (edge2Y * deltaU1 - edge1Y * deltaU2) * inverse,
      (edge2Z * deltaU1 - edge1Z * deltaU2) * inverse,
    ] as const;
    for (const vertexIndex of [first, second, third]) {
      const target = vertexIndex * 3;
      for (let component = 0; component < 3; component += 1) {
        tangents[target + component] =
          (tangents[target + component] as number) + (tangent[component] as number);
        bitangents[target + component] =
          (bitangents[target + component] as number) + (bitangent[component] as number);
      }
    }
  }

  const result = new Array<number>(mesh.vertexCount * 4);
  for (let vertexIndex = 0; vertexIndex < mesh.vertexCount; vertexIndex += 1) {
    const source = vertexIndex * 3;
    const target = vertexIndex * 4;
    const normalX = mesh.normals[source] as number;
    const normalY = mesh.normals[source + 1] as number;
    const normalZ = mesh.normals[source + 2] as number;
    const accumulatedX = tangents[source] as number;
    const accumulatedY = tangents[source + 1] as number;
    const accumulatedZ = tangents[source + 2] as number;
    const projection = accumulatedX * normalX + accumulatedY * normalY + accumulatedZ * normalZ;
    let tangentX = accumulatedX - normalX * projection;
    let tangentY = accumulatedY - normalY * projection;
    let tangentZ = accumulatedZ - normalZ * projection;
    const length = Math.hypot(tangentX, tangentY, tangentZ);
    if (!Number.isFinite(length) || length <= UV_EPSILON) {
      [tangentX, tangentY, tangentZ] = fallbackTangent(normalX, normalY, normalZ);
    } else {
      tangentX /= length;
      tangentY /= length;
      tangentZ /= length;
    }
    const crossX = normalY * tangentZ - normalZ * tangentY;
    const crossY = normalZ * tangentX - normalX * tangentZ;
    const crossZ = normalX * tangentY - normalY * tangentX;
    const handedness =
      crossX * (bitangents[source] as number) +
        crossY * (bitangents[source + 1] as number) +
        crossZ * (bitangents[source + 2] as number) <
      0
        ? -1
        : 1;
    result[target] = tangentX === 0 ? 0 : tangentX;
    result[target + 1] = tangentY === 0 ? 0 : tangentY;
    result[target + 2] = tangentZ === 0 ? 0 : tangentZ;
    result[target + 3] = handedness;
  }
  return Object.freeze(result);
}
