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
import { TemporalFrameScheduler } from '@kyxos/render-frame-scheduler';
import type { PbrOutputTransformDescriptor } from '@kyxos/render-material-pbr';
import {
  PbrMaterialLibrary,
  PbrTextureLibrary,
  TemporalPbrRenderFeature,
} from '@kyxos/render-renderer';
import type {
  PbrDirectionalLightDescriptor,
  PbrEnvironmentDescriptor,
  TemporalTaaSettingsDescriptor,
} from '@kyxos/render-renderer';
import { Scene } from '@kyxos/render-scene';
import type {
  TemporalConvergenceOptions,
  TemporalConvergenceSnapshot,
} from '@kyxos/render-temporal';
import { MeshRendererStore } from '@kyxos/render-visibility';

import { createBrowserFrameDriver } from './browser-frame-driver.js';
import type { KyxosBackendSelection } from './create-renderer.js';
import {
  KyxosTemporalPbrCanvasRenderer,
  type TemporalPbrRevisionState,
} from './temporal-pbr-canvas-renderer.js';

export interface CreateKyxosTemporalPbrRendererOptions extends TemporalConvergenceOptions {
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
  readonly frustumCulling?: boolean;
  readonly label?: string;
  readonly light?: PbrDirectionalLightDescriptor;
  readonly onConvergence?: (snapshot: TemporalConvergenceSnapshot) => void;
  readonly orbit?: OrbitControllerOptions;
  readonly output?: PbrOutputTransformDescriptor;
  readonly ownerId?: string;
  readonly powerPreference?: WebGpuPowerPreference;
  readonly renderScale?: number;
  readonly requiredFeatures?: readonly BackendFeature[];
  readonly stabilizationMs?: number;
  readonly taa?: TemporalTaaSettingsDescriptor;
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

function resolveBackend(options: CreateKyxosTemporalPbrRendererOptions): GraphicsBackend {
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

function positivePhysicalDimension(value: number): number {
  return Math.max(1, Math.round(value));
}

function composeTemporalPbrRenderer(
  options: CreateKyxosTemporalPbrRendererOptions,
): KyxosTemporalPbrCanvasRenderer {
  const backend = resolveBackend(options);
  const scene = new Scene();
  const camera = new PerspectiveCamera(options.camera);
  const orbitController = new OrbitController(options.orbit);
  if (options.orbit === undefined) orbitController.syncFrom(camera);
  else orbitController.applyTo(camera);
  const meshRenderers = new MeshRendererStore(scene);
  const materials = new PbrMaterialLibrary();
  const textures = new PbrTextureLibrary();
  const frameDriver = options.frameDriver ?? createBrowserFrameDriver();
  const scheduler = new TemporalFrameScheduler({
    convergence: {
      ...(options.errorThreshold === undefined ? {} : { errorThreshold: options.errorThreshold }),
      ...(options.minimumSamples === undefined ? {} : { minimumSamples: options.minimumSamples }),
      ...(options.stableSamples === undefined ? {} : { stableSamples: options.stableSamples }),
      targetSamples: options.targetSamples,
    },
    driver: frameDriver,
    ...(options.stabilizationMs === undefined ? {} : { stabilizationMs: options.stabilizationMs }),
  });
  const cssHeight =
    options.cssHeight ?? canvasDimension(options.canvas, 'clientHeight', options.canvas.height);
  const cssWidth =
    options.cssWidth ?? canvasDimension(options.canvas, 'clientWidth', options.canvas.width);
  const devicePixelRatio = options.devicePixelRatio ?? browserDevicePixelRatio();
  const renderScale = options.renderScale ?? 1;
  const revisions: TemporalPbrRevisionState = {
    device: 1,
    environment: 1,
    lighting: 1,
    postProcess: 1,
    viewport: 1,
  };
  const ownerId = options.ownerId?.trim() || options.label?.trim() || 'kyxos-temporal-pbr';
  const feature = new TemporalPbrRenderFeature({
    camera,
    ...(options.cameraLayerMask === undefined ? {} : { cameraLayerMask: options.cameraLayerMask }),
    ...(options.clearColor === undefined ? {} : { clearColor: options.clearColor }),
    ...(options.environment === undefined ? {} : { environment: options.environment }),
    ...(options.errorThreshold === undefined ? {} : { errorThreshold: options.errorThreshold }),
    ...(options.frustumCulling === undefined ? {} : { frustumCulling: options.frustumCulling }),
    height: positivePhysicalDimension(cssHeight * devicePixelRatio * renderScale),
    ...(options.light === undefined ? {} : { light: options.light }),
    materials,
    meshRenderers,
    ...(options.minimumSamples === undefined ? {} : { minimumSamples: options.minimumSamples }),
    ...(options.output === undefined ? {} : { output: options.output }),
    ownerId,
    reportConvergence: (snapshot) => {
      scheduler.reportConvergence(snapshot.lastError ?? 0);
      options.onConvergence?.(snapshot);
    },
    scene,
    signature: () => ({
      camera: camera.revision,
      device: revisions.device,
      environment: revisions.environment,
      geometry: meshRenderers.revision,
      lighting: revisions.lighting,
      materials: materials.revision,
      postProcess: revisions.postProcess,
      scene: scene.revision,
      viewport: revisions.viewport,
    }),
    ...(options.stableSamples === undefined ? {} : { stableSamples: options.stableSamples }),
    ...(options.taa === undefined ? {} : { taa: options.taa }),
    surface: {
      ...(options.alphaMode === undefined ? {} : { alphaMode: options.alphaMode }),
      ...(options.colorSpace === undefined ? {} : { colorSpace: options.colorSpace }),
      cssHeight,
      cssWidth,
      devicePixelRatio,
      ...(options.label === undefined ? {} : { label: `${options.label} temporal surface` }),
      ...(options.renderScale === undefined ? {} : { renderScale: options.renderScale }),
      target: options.canvas,
    },
    targetSamples: options.targetSamples,
    textures,
    width: positivePhysicalDimension(cssWidth * devicePixelRatio * renderScale),
  });
  return new KyxosTemporalPbrCanvasRenderer({
    backend,
    camera,
    feature,
    materials,
    meshRenderers,
    orbitController,
    revisions,
    scene,
    scheduler,
    textures,
  });
}

export async function createKyxosTemporalPbrRenderer(
  options: CreateKyxosTemporalPbrRendererOptions,
): Promise<KyxosTemporalPbrCanvasRenderer> {
  const renderer = composeTemporalPbrRenderer(options);
  try {
    await renderer.initialize();
    renderer.requestFrame('geometry');
    return renderer;
  } catch (error) {
    try {
      renderer.dispose();
    } catch (disposeError) {
      throw new AggregateError(
        [error, disposeError],
        'Temporal PBR Renderer creation and cleanup failed.',
        { cause: disposeError },
      );
    }
    throw error;
  }
}
