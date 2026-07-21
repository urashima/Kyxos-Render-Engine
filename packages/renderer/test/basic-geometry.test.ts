import { ManualFrameDriver, MockBackend } from '@kyxos/render-testing';
import { describe, expect, it, vi } from 'vitest';

import {
  BASIC_GEOMETRY_VERTEX_FLOATS,
  BasicGeometryFeature,
  KyxosRenderer,
  createSphereGeometry,
  createTriangleGeometry,
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
  });

  it('renders triangle and sphere, suspends at zero size, and restores after device loss', async () => {
    const backend = new MockBackend();
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
    renderer.invalidate('viewport');
    frameDriver.flush(48);
    expect(renderer.getDiagnostics().lastFrameStatistics).toEqual({
      drawCalls: 0,
      instances: 0,
      triangles: 0,
      vertices: 0,
    });

    feature.resize({ cssHeight: 180, cssWidth: 320, devicePixelRatio: 1 });
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
