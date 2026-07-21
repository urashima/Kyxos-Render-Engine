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
import { OrbitController, PerspectiveCamera } from '@kyxos/render-camera';
import type { OrbitControllerOptions, PerspectiveCameraOptions } from '@kyxos/render-camera';
import type { FrameRequestDriver } from '@kyxos/render-frame-scheduler';
import { SceneRenderFeature } from '@kyxos/render-renderer';
import { Scene } from '@kyxos/render-scene';
import { MeshRendererStore } from '@kyxos/render-visibility';

import { createBrowserFrameDriver } from './browser-frame-driver.js';
import { KyxosSceneCanvasRenderer } from './scene-canvas-renderer.js';
import type { KyxosBackendSelection } from './create-renderer.js';

export interface CreateKyxosSceneRendererOptions {
  readonly alphaMode?: BackendSurfaceAlphaMode;
  readonly backend?: GraphicsBackend | KyxosBackendSelection;
  readonly camera?: PerspectiveCameraOptions;
  readonly cameraLayerMask?: number;
  readonly canvas: BackendSurfaceTarget;
  readonly clearColor?: BackendClearColor;
  readonly colorSpace?: BackendSurfaceColorSpace;
  readonly cssHeight?: number;
  readonly cssWidth?: number;
  readonly devicePixelRatio?: number;
  readonly forceFallbackAdapter?: boolean;
  readonly frameDriver?: FrameRequestDriver;
  readonly frustumCulling?: boolean;
  readonly label?: string;
  readonly orbit?: OrbitControllerOptions;
  readonly powerPreference?: WebGpuPowerPreference;
  readonly renderScale?: number;
  readonly requiredFeatures?: readonly BackendFeature[];
}

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

function resolveBackend(options: CreateKyxosSceneRendererOptions): GraphicsBackend {
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

function composeSceneRenderer(options: CreateKyxosSceneRendererOptions): KyxosSceneCanvasRenderer {
  const backend = resolveBackend(options);
  const scene = new Scene();
  const camera = new PerspectiveCamera(options.camera);
  const orbitController = new OrbitController(options.orbit);
  if (options.orbit === undefined) orbitController.syncFrom(camera);
  else orbitController.applyTo(camera);
  const meshRenderers = new MeshRendererStore(scene);
  const feature = new SceneRenderFeature({
    camera,
    ...(options.cameraLayerMask === undefined ? {} : { cameraLayerMask: options.cameraLayerMask }),
    ...(options.clearColor === undefined ? {} : { clearColor: options.clearColor }),
    ...(options.frustumCulling === undefined ? {} : { frustumCulling: options.frustumCulling }),
    meshRenderers,
    scene,
    surface: {
      ...(options.alphaMode === undefined ? {} : { alphaMode: options.alphaMode }),
      ...(options.colorSpace === undefined ? {} : { colorSpace: options.colorSpace }),
      cssHeight:
        options.cssHeight ?? canvasDimension(options.canvas, 'clientHeight', options.canvas.height),
      cssWidth:
        options.cssWidth ?? canvasDimension(options.canvas, 'clientWidth', options.canvas.width),
      devicePixelRatio: options.devicePixelRatio ?? browserDevicePixelRatio(),
      ...(options.label === undefined ? {} : { label: `${options.label} scene surface` }),
      ...(options.renderScale === undefined ? {} : { renderScale: options.renderScale }),
      target: options.canvas,
    },
  });
  return new KyxosSceneCanvasRenderer({
    backend,
    camera,
    feature,
    frameDriver: options.frameDriver ?? createBrowserFrameDriver(),
    meshRenderers,
    orbitController,
    scene,
  });
}

export async function createKyxosSceneRenderer(
  options: CreateKyxosSceneRendererOptions,
): Promise<KyxosSceneCanvasRenderer> {
  const renderer = composeSceneRenderer(options);
  try {
    await renderer.initialize();
    renderer.requestFrame();
    return renderer;
  } catch (error) {
    try {
      renderer.dispose();
    } catch (disposeError) {
      throw new AggregateError(
        [error, disposeError],
        'Scene Renderer creation and cleanup failed.',
        {
          cause: disposeError,
        },
      );
    }
    throw error;
  }
}
