import { crossVec3, dotVec3, lengthVec3, subtractVec3 } from '@kyxos/render-math';
import { describe, expect, it } from 'vitest';

import { createCubeGeometry, createPlaneGeometry, createUvSphereGeometry } from '../src/index.js';

import type { MeshData } from '../src/index.js';
import type { Vec3 } from '@kyxos/render-math';

function vertex(values: readonly number[], index: number): Vec3 {
  const offset = index * 3;
  return [values[offset] as number, values[offset + 1] as number, values[offset + 2] as number];
}

function expectWindingMatchesNormals(mesh: MeshData): void {
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    const first = mesh.indices[offset] as number;
    const second = mesh.indices[offset + 1] as number;
    const third = mesh.indices[offset + 2] as number;
    const faceNormal = crossVec3(
      subtractVec3(vertex(mesh.positions, second), vertex(mesh.positions, first)),
      subtractVec3(vertex(mesh.positions, third), vertex(mesh.positions, first)),
    );
    expect(dotVec3(faceNormal, vertex(mesh.normals, first))).toBeGreaterThan(0);
  }
}

describe('primitive geometry', () => {
  it('builds a Y-up plane with CCW winding and +Y normals', () => {
    const plane = createPlaneGeometry({ depth: 4, width: 2 });

    expect(plane.vertexCount).toBe(4);
    expect(plane.triangleCount).toBe(2);
    expect(plane.bounds).toEqual({ min: [-1, 0, -2], max: [1, 0, 2] });
    expect(plane.normals).toEqual([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]);
    expectWindingMatchesNormals(plane);
  });

  it('builds a sharp-normal cube with six outward faces', () => {
    const cube = createCubeGeometry({ depth: 6, height: 4, width: 2 });

    expect(cube.vertexCount).toBe(24);
    expect(cube.indexCount).toBe(36);
    expect(cube.triangleCount).toBe(12);
    expect(cube.bounds).toEqual({ min: [-1, -2, -3], max: [1, 2, 3] });
    expectWindingMatchesNormals(cube);
    for (let vertexIndex = 0; vertexIndex < cube.vertexCount; vertexIndex += 1) {
      expect(lengthVec3(vertex(cube.normals, vertexIndex))).toBeCloseTo(1, 12);
    }
  });

  it('builds a seam-safe UV sphere without degenerate polar triangles', () => {
    const sphere = createUvSphereGeometry({ heightSegments: 4, radius: 2, widthSegments: 8 });

    expect(sphere.vertexCount).toBe(45);
    expect(sphere.triangleCount).toBe(48);
    expect(sphere.indexCount).toBe(144);
    expect(sphere.bounds.min[0]).toBeCloseTo(-2, 12);
    expect(sphere.bounds.min[1]).toBeCloseTo(-2, 12);
    expect(sphere.bounds.min[2]).toBeCloseTo(-2, 12);
    expect(sphere.bounds.max[0]).toBeCloseTo(2, 12);
    expect(sphere.bounds.max[1]).toBeCloseTo(2, 12);
    expect(sphere.bounds.max[2]).toBeCloseTo(2, 12);
    expectWindingMatchesNormals(sphere);
    for (let vertexIndex = 0; vertexIndex < sphere.vertexCount; vertexIndex += 1) {
      expect(lengthVec3(vertex(sphere.normals, vertexIndex))).toBeCloseTo(1, 12);
    }
  });

  it('rejects invalid primitive dimensions and segment counts', () => {
    expect(() => createPlaneGeometry({ width: 0 })).toThrow(/width/u);
    expect(() => createCubeGeometry({ height: Number.NaN })).toThrow(/height/u);
    expect(() => createUvSphereGeometry({ radius: -1 })).toThrow(/radius/u);
    expect(() => createUvSphereGeometry({ widthSegments: 2 })).toThrow(/at least 3/u);
    expect(() => createUvSphereGeometry({ heightSegments: 1 })).toThrow(/at least 2/u);
  });
});
