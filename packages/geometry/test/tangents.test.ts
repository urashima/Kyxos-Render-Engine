import { describe, expect, it } from 'vitest';

import { createMeshData, generateMeshTangents } from '../src/index.js';

function triangle(uv0: readonly number[]) {
  return createMeshData({
    normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
    positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
    uv0,
  });
}

describe('Mesh Tangent generation', () => {
  it('derives orthonormal +X Tangents with positive bitangent handedness', () => {
    const tangents = generateMeshTangents(triangle([0, 0, 1, 0, 0, 1]));

    expect(tangents).toEqual([1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1]);
    expect(Object.isFrozen(tangents)).toBe(true);
  });

  it('records negative handedness for mirrored UV orientation', () => {
    const tangents = generateMeshTangents(triangle([0, 0, 0, 1, 1, 0]));

    expect(tangents).toEqual([0, 1, 0, -1, 0, 1, 0, -1, 0, 1, 0, -1]);
  });

  it('uses supplied Tangents and provides a deterministic fallback for collapsed UVs', () => {
    const supplied = createMeshData({
      normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
      positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
      tangents: [0, 2, 0, -1, 0, 2, 0, -1, 0, 2, 0, -1],
      uv0: [0, 0, 1, 0, 0, 1],
    });
    expect(generateMeshTangents(supplied)).toBe(supplied.tangents);

    expect(generateMeshTangents(triangle([0, 0, 0, 0, 0, 0]))).toEqual([
      1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1,
    ]);
  });

  it('fails closed when a Mesh has no UV0', () => {
    const mesh = createMeshData({ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0] });
    expect(() => generateMeshTangents(mesh)).toThrow('requires UV0');
  });
});
