import { describe, expect, it } from 'vitest';

import { createMeshData } from '../src/index.js';

describe('MeshData', () => {
  it('copies caller data, generates normals from CCW winding, and derives bounds', () => {
    const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0];
    const mesh = createMeshData({ name: 'custom-triangle', positions });
    positions[0] = 100;

    expect(mesh.name).toBe('custom-triangle');
    expect(mesh.positions).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(mesh.normals).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1]);
    expect(mesh.indices).toEqual([0, 1, 2]);
    expect(mesh.bounds).toEqual({ min: [0, 0, 0], max: [1, 1, 0] });
    expect(mesh.vertexCount).toBe(3);
    expect(mesh.indexCount).toBe(3);
    expect(mesh.triangleCount).toBe(1);
    expect(mesh.indexFormat).toBe('uint16');
    expect(Object.isFrozen(mesh.positions)).toBe(true);
    expect(Object.isFrozen(mesh)).toBe(true);
  });

  it('normalizes explicit normals and preserves optional UV data', () => {
    const mesh = createMeshData({
      indices: new Uint16Array([0, 1, 2]),
      normals: new Float32Array([0, 0, 2, 0, 0, 2, 0, 0, 2]),
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      uv0: new Float32Array([0, 0, 1, 0, 0, 1]),
    });

    expect(mesh.normals).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1]);
    expect(mesh.uv0).toEqual([0, 0, 1, 0, 0, 1]);
  });

  it('selects 32-bit indices only when an addressed vertex requires them', () => {
    const vertexCount = 65_537;
    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    for (let vertex = 0; vertex < vertexCount; vertex += 1) normals[vertex * 3 + 2] = 1;
    positions[65_535 * 3] = 1;
    positions[65_536 * 3 + 1] = 1;

    const mesh = createMeshData({ indices: [0, 65_535, 65_536], normals, positions });

    expect(mesh.indexFormat).toBe('uint32');
    expect(mesh.vertexCount).toBe(vertexCount);
  });

  it('rejects malformed attributes, indices, and degenerate triangles', () => {
    expect(() => createMeshData({ positions: [] })).toThrow(/positions/u);
    expect(() => createMeshData({ positions: [0, 0, 0, 1] })).toThrow(/complete XYZ/u);
    expect(() => createMeshData({ positions: [0, 0, 0, 1, 0, 0] })).toThrow(/divisible by 3/u);
    expect(() =>
      createMeshData({ indices: [0, 1], positions: [0, 0, 0, 1, 0, 0, 0, 1, 0] }),
    ).toThrow(/complete triangles/u);
    expect(() =>
      createMeshData({ indices: [0, 1, 3], positions: [0, 0, 0, 1, 0, 0, 0, 1, 0] }),
    ).toThrow(/exceeds vertex count/u);
    expect(() =>
      createMeshData({ indices: [0, 1.5, 2], positions: [0, 0, 0, 1, 0, 0, 0, 1, 0] }),
    ).toThrow(/safe integer/u);
    expect(() =>
      createMeshData({ indices: [0, 1, 2], positions: [0, 0, 0, 1, 0, 0, 2, 0, 0] }),
    ).toThrow(/degenerate/u);
    expect(() =>
      createMeshData({
        normals: [0, 0, 1],
        positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
      }),
    ).toThrow(/exactly 9/u);
    expect(() =>
      createMeshData({
        positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
        uv0: [0, 0],
      }),
    ).toThrow(/exactly 6/u);
  });
});
