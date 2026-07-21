import { KyxosEngineError } from '@kyxos/render-core';

export const BASIC_GEOMETRY_VERTEX_FLOATS = 9;
export const BASIC_GEOMETRY_VERTEX_STRIDE =
  BASIC_GEOMETRY_VERTEX_FLOATS * Float32Array.BYTES_PER_ELEMENT;

export type BasicGeometryPrimitive = 'sphere' | 'triangle';

export interface BasicGeometryData {
  readonly indexCount: number;
  readonly indices: Uint16Array | undefined;
  readonly primitive: BasicGeometryPrimitive;
  readonly vertexCount: number;
  readonly vertices: Float32Array;
}

export interface SphereGeometryOptions {
  readonly latitudeSegments?: number;
  readonly longitudeSegments?: number;
  readonly radius?: number;
}

function requireSegmentCount(name: string, value: number, minimum: number): void {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new KyxosEngineError(
      `${name} must be a safe integer greater than or equal to ${minimum}.`,
      {
        code: 'INVALID_ARGUMENT',
        module: 'renderer',
        recoverable: false,
      },
    );
  }
}

export function createTriangleGeometry(): BasicGeometryData {
  const vertices = new Float32Array([
    // position          normal       color
    0, 0.72, 0, 0, 0, 1, 0.2, 0.82, 1, -0.72, -0.62, 0, 0, 0, 1, 0.46, 0.3, 1, 0.72, -0.62, 0, 0, 0,
    1, 1, 0.38, 0.58,
  ]);
  return Object.freeze({
    indexCount: 0,
    indices: undefined,
    primitive: 'triangle',
    vertexCount: 3,
    vertices,
  });
}

export function createSphereGeometry(options: SphereGeometryOptions = {}): BasicGeometryData {
  const latitudeSegments = options.latitudeSegments ?? 16;
  const longitudeSegments = options.longitudeSegments ?? 32;
  const radius = options.radius ?? 0.72;
  requireSegmentCount('Sphere latitudeSegments', latitudeSegments, 2);
  requireSegmentCount('Sphere longitudeSegments', longitudeSegments, 3);
  if (!Number.isFinite(radius) || radius <= 0 || radius > 1) {
    throw new KyxosEngineError('Sphere radius must be finite, greater than 0, and at most 1.', {
      code: 'INVALID_ARGUMENT',
      module: 'renderer',
      recoverable: false,
    });
  }

  const vertexCount = (latitudeSegments + 1) * (longitudeSegments + 1);
  if (!Number.isSafeInteger(vertexCount) || vertexCount > 65_535) {
    throw new KyxosEngineError('Sphere segment counts exceed the Uint16 vertex-index limit.', {
      code: 'INVALID_ARGUMENT',
      module: 'renderer',
      recoverable: false,
    });
  }
  const indexCount = latitudeSegments * longitudeSegments * 6;
  if (!Number.isSafeInteger(indexCount)) {
    throw new KyxosEngineError('Sphere index count exceeds the safe integer range.', {
      code: 'INVALID_ARGUMENT',
      module: 'renderer',
      recoverable: false,
    });
  }

  const vertices = new Float32Array(vertexCount * BASIC_GEOMETRY_VERTEX_FLOATS);
  let vertexOffset = 0;
  for (let latitude = 0; latitude <= latitudeSegments; latitude += 1) {
    const vertical = latitude / latitudeSegments;
    const theta = vertical * Math.PI;
    const sinTheta = Math.sin(theta);
    const normalY = Math.cos(theta);
    for (let longitude = 0; longitude <= longitudeSegments; longitude += 1) {
      const horizontal = longitude / longitudeSegments;
      const phi = horizontal * Math.PI * 2;
      const normalX = sinTheta * Math.cos(phi);
      const normalZ = sinTheta * Math.sin(phi);
      vertices.set(
        [
          normalX * radius,
          normalY * radius,
          normalZ * radius,
          normalX,
          normalY,
          normalZ,
          0.28 + (normalX * 0.5 + 0.5) * 0.5,
          0.26 + (normalY * 0.5 + 0.5) * 0.58,
          0.48 + (normalZ * 0.5 + 0.5) * 0.48,
        ],
        vertexOffset,
      );
      vertexOffset += BASIC_GEOMETRY_VERTEX_FLOATS;
    }
  }

  const indices = new Uint16Array(indexCount);
  let indexOffset = 0;
  for (let latitude = 0; latitude < latitudeSegments; latitude += 1) {
    for (let longitude = 0; longitude < longitudeSegments; longitude += 1) {
      const topLeft = latitude * (longitudeSegments + 1) + longitude;
      const bottomLeft = topLeft + longitudeSegments + 1;
      indices.set(
        [topLeft, bottomLeft, topLeft + 1, topLeft + 1, bottomLeft, bottomLeft + 1],
        indexOffset,
      );
      indexOffset += 6;
    }
  }

  return Object.freeze({
    indexCount,
    indices,
    primitive: 'sphere',
    vertexCount,
    vertices,
  });
}
