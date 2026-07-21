import { KyxosEngineError } from '@kyxos/render-core';

import type { BackendResourceHandle } from './resources.js';

export type BackendSurfaceAlphaMode = 'opaque' | 'premultiplied';
export type BackendSurfaceColorSpace = 'display-p3' | 'srgb';
export type BackendSurfaceFormat = 'bgra8unorm' | 'rgba8unorm';

/** Canvas-like host contract. Native GPU contexts never cross this boundary. */
export interface BackendSurfaceTarget {
  height: number;
  width: number;
  getContext(contextId: 'webgpu'): unknown;
}

export interface BackendSurfaceResize {
  readonly cssHeight: number;
  readonly cssWidth: number;
  readonly devicePixelRatio: number;
  readonly renderScale?: number;
}

export interface BackendSurfaceSize {
  readonly clamped: boolean;
  readonly cssHeight: number;
  readonly cssWidth: number;
  readonly devicePixelRatio: number;
  readonly physicalHeight: number;
  readonly physicalWidth: number;
  readonly renderScale: number;
  readonly suspended: boolean;
}

export interface BackendSurfaceDescriptor extends BackendSurfaceResize {
  readonly alphaMode?: BackendSurfaceAlphaMode;
  readonly colorSpace?: BackendSurfaceColorSpace;
  readonly label?: string;
  readonly target: BackendSurfaceTarget;
}

export interface BackendSurfaceInfo {
  readonly format: BackendSurfaceFormat;
  readonly size: BackendSurfaceSize;
}

export type BackendSurfaceHandle = BackendResourceHandle<'surface'>;

function requireFinite(name: string, value: number, minimum: number, exclusive: boolean): void {
  const outsideRange = exclusive ? value <= minimum : value < minimum;
  if (!Number.isFinite(value) || outsideRange) {
    throw new KyxosEngineError(
      `${name} must be a finite number ${exclusive ? 'greater than' : 'greater than or equal to'} ${minimum}.`,
      {
        code: 'INVALID_ARGUMENT',
        module: 'backend',
        recoverable: false,
      },
    );
  }
}

export function normalizeBackendSurfaceSize(
  resize: BackendSurfaceResize,
  maxTextureDimension2D: number,
): BackendSurfaceSize {
  requireFinite('Surface cssWidth', resize.cssWidth, 0, false);
  requireFinite('Surface cssHeight', resize.cssHeight, 0, false);
  requireFinite('Surface devicePixelRatio', resize.devicePixelRatio, 0, true);
  const renderScale = resize.renderScale ?? 1;
  requireFinite('Surface renderScale', renderScale, 0, true);
  if (!Number.isSafeInteger(maxTextureDimension2D) || maxTextureDimension2D < 1) {
    throw new KyxosEngineError('Surface maxTextureDimension2D must be a positive safe integer.', {
      code: 'INVALID_ARGUMENT',
      module: 'backend',
      recoverable: false,
    });
  }

  const suspended = resize.cssWidth === 0 || resize.cssHeight === 0;
  const requestedWidth = suspended
    ? 0
    : Math.max(1, Math.round(resize.cssWidth * resize.devicePixelRatio * renderScale));
  const requestedHeight = suspended
    ? 0
    : Math.max(1, Math.round(resize.cssHeight * resize.devicePixelRatio * renderScale));
  const clampScale = suspended
    ? 1
    : Math.min(1, maxTextureDimension2D / requestedWidth, maxTextureDimension2D / requestedHeight);
  const physicalWidth = suspended ? 0 : Math.max(1, Math.floor(requestedWidth * clampScale));
  const physicalHeight = suspended ? 0 : Math.max(1, Math.floor(requestedHeight * clampScale));

  return Object.freeze({
    clamped: clampScale < 1,
    cssHeight: resize.cssHeight,
    cssWidth: resize.cssWidth,
    devicePixelRatio: resize.devicePixelRatio,
    physicalHeight,
    physicalWidth,
    renderScale,
    suspended,
  });
}
