import { describe, expect, it } from 'vitest';

import { normalizeBackendSurfaceSize } from '../src/index.js';
import type { BackendSurfaceTarget } from '../src/index.js';

function acceptsBrowserCanvas(canvas: HTMLCanvasElement | OffscreenCanvas): BackendSurfaceTarget {
  return canvas;
}

void acceptsBrowserCanvas;

describe('backend surface sizing', () => {
  it('converts CSS dimensions through DPR and render scale deterministically', () => {
    expect(
      normalizeBackendSurfaceSize(
        { cssHeight: 180.25, cssWidth: 320.25, devicePixelRatio: 2, renderScale: 0.75 },
        8192,
      ),
    ).toEqual({
      clamped: false,
      cssHeight: 180.25,
      cssWidth: 320.25,
      devicePixelRatio: 2,
      physicalHeight: 270,
      physicalWidth: 480,
      renderScale: 0.75,
      suspended: false,
    });
  });

  it('clamps to the device limit without changing the surface aspect ratio', () => {
    expect(
      normalizeBackendSurfaceSize(
        { cssHeight: 9000, cssWidth: 10_000, devicePixelRatio: 2 },
        16_384,
      ),
    ).toMatchObject({
      clamped: true,
      physicalHeight: 14_745,
      physicalWidth: 16_384,
      renderScale: 1,
      suspended: false,
    });
    const size = normalizeBackendSurfaceSize(
      { cssHeight: 1000, cssWidth: 10_000, devicePixelRatio: 2 },
      16_384,
    );
    expect(size.physicalWidth / size.physicalHeight).toBeCloseTo(10, 2);
  });

  it('suspends a zero-area surface without manufacturing a backing pixel', () => {
    expect(
      normalizeBackendSurfaceSize({ cssHeight: 0, cssWidth: 640, devicePixelRatio: 2 }, 8192),
    ).toMatchObject({
      physicalHeight: 0,
      physicalWidth: 0,
      suspended: true,
    });
  });

  it.each([
    { cssHeight: 1, cssWidth: -1, devicePixelRatio: 1 },
    { cssHeight: 1, cssWidth: 1, devicePixelRatio: 0 },
    { cssHeight: Number.NaN, cssWidth: 1, devicePixelRatio: 1 },
    { cssHeight: 1, cssWidth: 1, devicePixelRatio: 1, renderScale: -0.5 },
  ])('rejects an invalid resize descriptor: %o', (resize) => {
    expect(() => normalizeBackendSurfaceSize(resize, 8192)).toThrow(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    );
  });
});
