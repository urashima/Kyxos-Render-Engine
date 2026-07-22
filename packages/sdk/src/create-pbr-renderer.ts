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
import type { FrameRequestDriver, FrameSchedulerController } from '@kyxos/render-frame-scheduler';
import type { PbrOutputTransformDescriptor } from '@kyxos/render-material-pbr';
import { PbrMaterialLibrary, PbrRenderFeature, PbrTextureLibrary } from '@kyxos/render-renderer';
import type {
  PbrDirectionalLightDescriptor,
  PbrEnvironmentDescriptor,
} from '@kyxos/render-renderer';
import { Scene } from '@kyxos/render-scene';
import { MeshRendererStore } from '@kyxos/render-visibility';

import { createBrowserFrameDriver } from './browser-frame-driver.js';
import type { KyxosBackendSelection } from './create-renderer.js';
import { KyxosPbrCanvasRenderer } from './pbr-canvas-renderer.js';

export interface CreateKyxosPbrRendererOptions {
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
  readonly environment?: PbrEnvironmentDescriptor;
  readonly forceFallbackAdapter?: boolean;
  readonly frameDriver?: FrameRequestDriver;
  readonly frameScheduler?: FrameSchedulerController;
  readonly frustumCulling?: boolean;
  readonly label?: string;
  readonly light?: PbrDirectionalLightDescriptor;
  readonly orbit?: OrbitControllerOptions;
  readonly output?: PbrOutputTransformDescriptor;
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

function resolveBackend(options: CreateKyxosPbrRendererOptions): GraphicsBackend {
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

function composePbrRenderer(options: CreateKyxosPbrRendererOptions): KyxosPbrCanvasRenderer {
  const backend = resolveBackend(options);
  const scene = new Scene();
  const camera = new PerspectiveCamera(options.camera);
  const orbitController = new OrbitController(options.orbit);
  if (options.orbit === undefined) orbitController.syncFrom(camera);
  else orbitController.applyTo(camera);
  const meshRenderers = new MeshRendererStore(scene);
  const materials = new PbrMaterialLibrary();
  const textures = new PbrTextureLibrary();
  const feature = new PbrRenderFeature({
    camera,
    ...(options.cameraLayerMask === undefined ? {} : { cameraLayerMask: options.cameraLayerMask }),
    ...(options.clearColor === undefined ? {} : { clearColor: options.clearColor }),
    ...(options.environment === undefined ? {} : { environment: options.environment }),
    ...(options.frustumCulling === undefined ? {} : { frustumCulling: options.frustumCulling }),
    ...(options.light === undefined ? {} : { light: options.light }),
    materials,
    meshRenderers,
    ...(options.output === undefined ? {} : { output: options.output }),
    scene,
    surface: {
      ...(options.alphaMode === undefined ? {} : { alphaMode: options.alphaMode }),
      ...(options.colorSpace === undefined ? {} : { colorSpace: options.colorSpace }),
      cssHeight:
        options.cssHeight ?? canvasDimension(options.canvas, 'clientHeight', options.canvas.height),
      cssWidth:
        options.cssWidth ?? canvasDimension(options.canvas, 'clientWidth', options.canvas.width),
      devicePixelRatio: options.devicePixelRatio ?? browserDevicePixelRatio(),
      ...(options.label === undefined ? {} : { label: `${options.label} PBR surface` }),
      ...(options.renderScale === undefined ? {} : { renderScale: options.renderScale }),
      target: options.canvas,
    },
    textures,
  });
  const scheduling =
    options.frameScheduler === undefined
      ? { frameDriver: options.frameDriver ?? createBrowserFrameDriver() }
      : { frameScheduler: options.frameScheduler };
  return new KyxosPbrCanvasRenderer({
    backend,
    camera,
    feature,
    ...scheduling,
    materials,
    meshRenderers,
    orbitController,
    scene,
    textures,
  });
}

export async function createKyxosPbrRenderer(
  options: CreateKyxosPbrRendererOptions,
): Promise<KyxosPbrCanvasRenderer> {
  const renderer = composePbrRenderer(options);
  try {
    await renderer.initialize();
    renderer.requestFrame();
    return renderer;
  } catch (error) {
    try {
      renderer.dispose();
    } catch (disposeError) {
      throw new AggregateError([error, disposeError], 'PBR Renderer creation and cleanup failed.', {
        cause: disposeError,
      });
    }
    throw error;
  }
}
