import { ManualFrameDriver, MockBackend } from '@kyxos/render-testing';
import { describe, expect, it, vi } from 'vitest';

import {
  BASIC_GEOMETRY_VERTEX_FLOATS,
  BasicGeometryFeature,
  KyxosRenderer,
  createSphereGeometry,
  createTriangleGeometry,
  projectBasicGeometryVertices,
} from '../src/index.js';

const target = {
  getContext: () => ({}),
  height: 0,
  width: 0,
};

describe('Phase 1 basic geometry', () => {
  it('generates deterministic interleaved triangle and Uint16 sphere meshes', () => {
    const triangle = createTriangleGeometry();
    expect(triangle).toMatchObject({ indexCount: 0, primitive: 'triangle', vertexCount: 3 });
    expect(triangle.indices).toBeUndefined();
    expect(triangle.vertices).toHaveLength(3 * BASIC_GEOMETRY_VERTEX_FLOATS);

    const sphere = createSphereGeometry({ latitudeSegments: 4, longitudeSegments: 8 });
    expect(sphere).toMatchObject({ indexCount: 192, primitive: 'sphere', vertexCount: 45 });
    expect(sphere.vertices).toHaveLength(45 * BASIC_GEOMETRY_VERTEX_FLOATS);
    const indices = sphere.indices;
    expect(indices).toBeInstanceOf(Uint16Array);
    if (indices === undefined) throw new Error('Expected generated sphere indices.');
    expect(indices).toHaveLength(192);
    expect(indices.byteLength % 4).toBe(0);
    expect(Math.max(...indices)).toBeLessThan(sphere.vertexCount);

    const normal = sphere.vertices.slice(3, 6);
    expect(Math.hypot(...normal)).toBeCloseTo(1, 6);
    expect(() => createSphereGeometry({ latitudeSegments: 1 })).toThrow(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    );
    expect(() => createSphereGeometry({ latitudeSegments: 255, longitudeSegments: 255 })).toThrow(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    );

    const landscape = projectBasicGeometryVertices(triangle, { height: 180, width: 320 });
    expect(landscape[9]).toBeCloseTo(-0.72 * (180 / 320), 6);
    expect(landscape[10]).toBeCloseTo(-0.62, 6);
    const portrait = projectBasicGeometryVertices(triangle, { height: 320, width: 180 });
    expect(portrait[9]).toBeCloseTo(-0.72, 6);
    expect(portrait[10]).toBeCloseTo(-0.62 * (180 / 320), 6);
    expect(() => projectBasicGeometryVertices(triangle, { height: 0, width: 320 })).toThrow(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    );
  });

  it('renders triangle and sphere, suspends at zero size, and restores after device loss', async () => {
    const backend = new MockBackend();
    const writeBuffer = vi.spyOn(backend, 'writeBuffer');
    const frameDriver = new ManualFrameDriver();
    const renderer = new KyxosRenderer({ backend, frameDriver });
    const feature = new BasicGeometryFeature({
      surface: {
        cssHeight: 180,
        cssWidth: 320,
        devicePixelRatio: 2,
        target,
      },
    });
    renderer.registerRenderFeature(feature);
    const onFrame = vi.fn();
    renderer.on('frame', onFrame);

    await renderer.initialize();
    expect(writeBuffer).toHaveBeenCalledTimes(3);
    const initialTriangleUpload = writeBuffer.mock.calls[0]?.[1];
    expect(initialTriangleUpload).toBeInstanceOf(Float32Array);
    expect((initialTriangleUpload as Float32Array)[9]).toBeCloseTo(-0.72 * (180 / 320), 6);
    expect(renderer.getDiagnostics()).toMatchObject({
      backend: { resources: { activeCount: 6 }, type: 'mock' },
      registrations: { renderFeatures: 1 },
      state: 'ready',
    });

    renderer.invalidate('geometry');
    frameDriver.flush(16);
    expect(onFrame).toHaveBeenLastCalledWith(
      expect.objectContaining({
        frameIndex: 1,
        statistics: { drawCalls: 1, instances: 1, triangles: 1, vertices: 3 },
      }),
    );

    feature.setPrimitive('sphere');
    renderer.invalidate('geometry');
    frameDriver.flush(32);
    expect(onFrame).toHaveBeenLastCalledWith(
      expect.objectContaining({
        frameIndex: 2,
        statistics: { drawCalls: 1, instances: 1, triangles: 1024, vertices: 3072 },
      }),
    );

    const suspended = feature.resize({
      cssHeight: 0,
      cssWidth: 320,
      devicePixelRatio: 2,
    });
    expect(suspended.size.suspended).toBe(true);
    expect(writeBuffer).toHaveBeenCalledTimes(3);
    renderer.invalidate('viewport');
    frameDriver.flush(48);
    expect(renderer.getDiagnostics().lastFrameStatistics).toEqual({
      drawCalls: 0,
      instances: 0,
      triangles: 0,
      vertices: 0,
    });

    feature.resize({ cssHeight: 180, cssWidth: 320, devicePixelRatio: 1 });
    expect(writeBuffer).toHaveBeenCalledTimes(3);
    feature.resize({ cssHeight: 320, cssWidth: 180, devicePixelRatio: 1 });
    expect(writeBuffer).toHaveBeenCalledTimes(5);
    const portraitTriangleUpload = writeBuffer.mock.calls[3]?.[1];
    expect(portraitTriangleUpload).toBeInstanceOf(Float32Array);
    expect((portraitTriangleUpload as Float32Array)[10]).toBeCloseTo(-0.62 * (180 / 320), 6);
    backend.simulateLoss({ message: 'phase-01 recovery' });
    expect(renderer.state).toBe('lost');
    expect(backend.getResourceStatistics().activeCount).toBe(0);
    await renderer.initialize();
    expect(backend.getResourceStatistics().activeCount).toBe(6);
    renderer.invalidate('geometry');
    frameDriver.flush(64);
    expect(renderer.getDiagnostics().lastFrameStatistics.triangles).toBe(1024);

    renderer.dispose();
    expect(feature.disposed).toBe(true);
    expect(backend.getResourceStatistics()).toMatchObject({
      activeCount: 0,
      activeEstimatedBytes: 0,
    });
  });
});
