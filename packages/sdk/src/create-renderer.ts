import type {
  BackendClearColor,
  BackendFeature,
  BackendSurfaceAlphaMode,
  BackendSurfaceColorSpace,
  BackendSurfaceTarget,
  GraphicsBackend,
} from '@kyxos/render-backend-api';
import { createWebGpuBackend } from '@kyxos/render-backend-webgpu';
import type { WebGpuPowerPreference } from '@kyxos/render-backend-webgpu';
import type { FrameRequestDriver } from '@kyxos/render-frame-scheduler';
import { BasicGeometryFeature } from '@kyxos/render-renderer';
import type {
  BasicGeometryPrimitive,
  KyxosRenderer,
  SphereGeometryOptions,
} from '@kyxos/render-renderer';

import { createBrowserFrameDriver } from './browser-frame-driver.js';
import { KyxosCanvasRenderer } from './canvas-renderer.js';
import { createKyxosRendererFromBackend } from './create-renderer-from-backend.js';
import type { CreateKyxosInjectedRendererOptions } from './create-renderer-from-backend.js';

export type KyxosBackendSelection = 'auto' | 'webgpu';

export interface CreateKyxosCanvasRendererOptions {
  readonly alphaMode?: BackendSurfaceAlphaMode;
  readonly backend?: GraphicsBackend | KyxosBackendSelection;
  readonly canvas: BackendSurfaceTarget;
  readonly clearColor?: BackendClearColor;
  readonly colorSpace?: BackendSurfaceColorSpace;
  readonly cssHeight?: number;
  readonly cssWidth?: number;
  readonly devicePixelRatio?: number;
  readonly forceFallbackAdapter?: boolean;
  readonly frameDriver?: FrameRequestDriver;
  readonly label?: string;
  readonly powerPreference?: WebGpuPowerPreference;
  readonly primitive?: BasicGeometryPrimitive;
  readonly renderScale?: number;
  readonly requiredFeatures?: readonly BackendFeature[];
  readonly sphere?: SphereGeometryOptions;
}

export type CreateKyxosRendererOptions =
  CreateKyxosCanvasRendererOptions | CreateKyxosInjectedRendererOptions;

function canvasDimension(
  canvas: BackendSurfaceTarget,
  clientProperty: 'clientHeight' | 'clientWidth',
  fallback: number,
): number {
  const measured = (
    canvas as BackendSurfaceTarget & Partial<Record<typeof clientProperty, number>>
  )[clientProperty];
  return typeof measured === 'number' ? measured : fallback;
}

function browserDevicePixelRatio(): number {
  return typeof globalThis.devicePixelRatio === 'number' ? globalThis.devicePixelRatio : 1;
}

function resolveCanvasBackend(options: CreateKyxosCanvasRendererOptions): GraphicsBackend {
  if (typeof options.backend === 'object') return options.backend;
  return createWebGpuBackend({
    ...(options.forceFallbackAdapter === undefined
      ? {}
      : { forceFallbackAdapter: options.forceFallbackAdapter }),
    ...(options.label === undefined ? {} : { label: options.label }),
    ...(options.powerPreference === undefined ? {} : { powerPreference: options.powerPreference }),
    ...(options.requiredFeatures === undefined
      ? {}
      : { requiredFeatures: options.requiredFeatures }),
  });
}

function createCanvasRenderer(options: CreateKyxosCanvasRendererOptions): KyxosCanvasRenderer {
  const backend = resolveCanvasBackend(options);
  const feature = new BasicGeometryFeature({
    ...(options.clearColor === undefined ? {} : { clearColor: options.clearColor }),
    ...(options.primitive === undefined ? {} : { primitive: options.primitive }),
    ...(options.sphere === undefined ? {} : { sphere: options.sphere }),
    surface: {
      ...(options.alphaMode === undefined ? {} : { alphaMode: options.alphaMode }),
      ...(options.colorSpace === undefined ? {} : { colorSpace: options.colorSpace }),
      cssHeight:
        options.cssHeight ?? canvasDimension(options.canvas, 'clientHeight', options.canvas.height),
      cssWidth:
        options.cssWidth ?? canvasDimension(options.canvas, 'clientWidth', options.canvas.width),
      devicePixelRatio: options.devicePixelRatio ?? browserDevicePixelRatio(),
      ...(options.label === undefined ? {} : { label: `${options.label} surface` }),
      ...(options.renderScale === undefined ? {} : { renderScale: options.renderScale }),
      target: options.canvas,
    },
  });
  return new KyxosCanvasRenderer({
    backend,
    feature,
    frameDriver: options.frameDriver ?? createBrowserFrameDriver(),
  });
}

export function createKyxosRenderer(
  options: CreateKyxosCanvasRendererOptions,
): Promise<KyxosCanvasRenderer>;
export function createKyxosRenderer(
  options: CreateKyxosInjectedRendererOptions,
): Promise<KyxosRenderer>;
export async function createKyxosRenderer(
  options: CreateKyxosRendererOptions,
): Promise<KyxosCanvasRenderer | KyxosRenderer> {
  if (!('canvas' in options)) return createKyxosRendererFromBackend(options);
  const renderer = createCanvasRenderer(options);

  try {
    await renderer.initialize();
    if (renderer instanceof KyxosCanvasRenderer) renderer.requestFrame();
    return renderer;
  } catch (error) {
    try {
      renderer.dispose();
    } catch (disposeError) {
      throw new AggregateError([error, disposeError], 'Renderer creation and cleanup failed.', {
        cause: disposeError,
      });
    }
    throw error;
  }
}
