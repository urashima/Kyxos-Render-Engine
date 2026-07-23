import type {
  BackendBindGroupHandle,
  BackendBufferHandle,
  BackendClearColor,
  BackendDrawCommand,
  BackendPipelineHandle,
  BackendRenderPassDescriptor,
  BackendRenderPassStatistics,
  BackendResourceHandle,
  BackendSamplerHandle,
  BackendShaderModuleHandle,
  BackendSurfaceDescriptor,
  BackendSurfaceHandle,
  BackendSurfaceInfo,
  BackendSurfaceResize,
  BackendTextureHandle,
  GraphicsBackend,
} from '@kyxos/render-backend-api';
import type { PerspectiveCamera } from '@kyxos/render-camera';
import { KyxosEngineError } from '@kyxos/render-core';
import {
  ENVIRONMENT_CUBE_FACES,
  type EnvironmentCubeFaceData,
  EnvironmentSource,
} from '@kyxos/render-environment';
import { generateMeshTangents } from '@kyxos/render-geometry';
import type { MeshData } from '@kyxos/render-geometry';
import { createPbrMaterialFeatureKey, createPbrOutputTransform } from '@kyxos/render-material-pbr';
import type {
  PbrAlphaMode,
  PbrMaterialSnapshot,
  PbrOutputTransform,
  PbrOutputTransformDescriptor,
} from '@kyxos/render-material-pbr';
import type { EntityHandle, Scene } from '@kyxos/render-scene';
import { VisibilitySystem } from '@kyxos/render-visibility';
import type {
  BuildRenderQueuesOptions,
  MeshRendererStore,
  RenderItem,
  VisibilityDiagnostics,
} from '@kyxos/render-visibility';

import type { DynamicTaaGpuFrame } from './dynamic-taa-gpu-history.js';
import type {
  RenderFeature,
  RenderFeatureFrameContext,
  RenderFeatureInitializationContext,
} from './extensions.js';
import { EnvironmentGpuCache, EnvironmentGpuLease } from './environment-gpu-cache.js';
import { PHASE_03_PBR_TONEMAPPED_WGSL } from './generated/phase-03-pbr-tonemapped.wgsl.js';
import { PHASE_04_PBR_TEMPORAL_OUTPUT_WGSL } from './generated/phase-04-pbr-temporal-output.wgsl.js';
import {
  PBR_OBJECT_UNIFORM_LAYOUT,
  createPbrDirectionalLight,
  packPbrObjectUniforms,
} from './pbr-gpu-layout.js';
import type { PbrDirectionalLight, PbrDirectionalLightDescriptor } from './pbr-gpu-layout.js';
import { PbrMaterialLibrary } from './pbr-material-library.js';
import { PbrTextureLibrary, PbrTextureSource } from './pbr-texture-library.js';

export const PBR_RENDER_FEATURE_ID = 'kyxos.pbr-direct' as const;

const SURFACE_DEPTH_FORMAT = 'depth24plus' as const;
const TEMPORAL_DEPTH_FORMAT = 'depth32float' as const;
const TEMPORAL_COLOR_FORMAT = 'rgba16float' as const;
const TEMPORAL_NORMAL_FORMAT = 'rgba16float' as const;
const TEMPORAL_NORMAL_CLEAR_COLOR: BackendClearColor = Object.freeze({
  a: 1,
  b: 1,
  g: 0.5,
  r: 0.5,
});
const PBR_VERTEX_STRIDE = 12 * Float32Array.BYTES_PER_ELEMENT;
const PBR_ALPHA_MODES = ['opaque', 'mask', 'blend'] as const;
const PBR_NORMAL_MAPS = [false, true] as const;
const PBR_SIDEDNESS = [false, true] as const;
const EMPTY_STATISTICS: BackendRenderPassStatistics = Object.freeze({
  drawCalls: 0,
  instances: 0,
  triangles: 0,
  vertices: 0,
});

interface PbrRenderResources {
  depthTexture: BackendTextureHandle | undefined;
  environmentBindGroups: ReadonlyMap<BackendPipelineHandle, BackendBindGroupHandle>;
  readonly fallbackBaseColorTexture: BackendTextureHandle;
  readonly fallbackMetallicRoughnessTexture: BackendTextureHandle;
  readonly fallbackNormalTexture: BackendTextureHandle;
  readonly fallbackSampler: BackendSamplerHandle;
  readonly pipelines: ReadonlyMap<string, BackendPipelineHandle>;
  readonly shader: BackendShaderModuleHandle;
  readonly surface: BackendSurfaceHandle | undefined;
}

interface MeshGpuResources {
  readonly indexBuffer: BackendBufferHandle;
  readonly indexByteLength: number;
  readonly indexFormat: MeshData['indexFormat'];
  readonly vertexBuffer: BackendBufferHandle;
}

interface ObjectGpuResources {
  readonly bindingKey: string;
  readonly bindGroup: ReturnType<GraphicsBackend['createBindGroup']>;
  readonly pipeline: BackendPipelineHandle;
  readonly textureSources: readonly PbrTextureSource[];
  readonly uniformBuffer: BackendBufferHandle;
}

interface TextureGpuResources {
  readonly sampler: BackendSamplerHandle;
  readonly source: PbrTextureSource;
  readonly texture: BackendTextureHandle;
}

interface PreparedTextureBinding {
  readonly sampler: BackendSamplerHandle;
  readonly source: PbrTextureSource | null;
  readonly texture: BackendTextureHandle;
}

interface PreparedMaterial {
  readonly baseColorSource: PbrTextureSource | null;
  readonly emissiveSource: PbrTextureSource | null;
  readonly fallback: boolean;
  readonly metallicRoughnessSource: PbrTextureSource | null;
  readonly normalSource: PbrTextureSource | null;
  readonly occlusionSource: PbrTextureSource | null;
  readonly pipeline: BackendPipelineHandle;
  readonly snapshot: PbrMaterialSnapshot;
}

export interface PbrEnvironmentDescriptor {
  /** Linear multiplier applied only to indirect environment lighting. */
  readonly intensity?: number;
  /** World-to-environment rotation around positive Y, in radians. */
  readonly rotation?: number;
  /** Null disables IBL through the owned black fallback environment. */
  readonly source?: EnvironmentSource | null;
}

export interface PbrEnvironmentState {
  readonly intensity: number;
  readonly rotation: number;
  readonly source: EnvironmentSource | null;
}

export interface PbrDynamicTaaSurface {
  readonly getSurfaceInfo: () => BackendSurfaceInfo;
  readonly resize: (resize: BackendSurfaceResize) => BackendSurfaceInfo;
}

export interface PbrDynamicTaaOutput {
  /** Returns one caller-prepared frame. The feature never commits, cancels, resizes, or disposes it. */
  readonly acquireFrame: () => DynamicTaaGpuFrame;
  /** Optional borrowed output Surface contract. PBR never creates or disposes this Surface. */
  readonly surface?: PbrDynamicTaaSurface;
}

export interface PbrRenderFeatureOptions extends BuildRenderQueuesOptions {
  readonly camera: PerspectiveCamera;
  readonly clearColor?: BackendClearColor;
  /** Opt-in linear-HDR Color + encoded Normal MRT output into caller-owned Dynamic TAA targets. */
  readonly dynamicTaaOutput?: PbrDynamicTaaOutput;
  readonly environment?: PbrEnvironmentDescriptor;
  /** An omitted cache is created and owned by this Render Feature. */
  readonly environmentCache?: EnvironmentGpuCache;
  readonly light?: PbrDirectionalLightDescriptor;
  /**
   * The caller retains ownership of a supplied library. An omitted library is
   * created and owned by this Render Feature.
   */
  readonly materials?: PbrMaterialLibrary;
  readonly meshRenderers: MeshRendererStore;
  /** Display transform applied after linear direct, indirect, and Emission composition. */
  readonly output?: PbrOutputTransformDescriptor;
  readonly scene: Scene;
  readonly surface: BackendSurfaceDescriptor;
  /** CPU RGBA8 sources remain caller-owned when this registry is supplied. */
  readonly textures?: PbrTextureLibrary;
  readonly visibility?: VisibilitySystem;
}

export interface PbrRenderFeatureDiagnostics {
  readonly environmentCache: ReturnType<EnvironmentGpuCache['diagnostics']>;
  readonly environmentIdentity: string | null;
  readonly environmentIntensity: number;
  readonly environmentRotation: number;
  readonly fallbackDrawCount: number;
  readonly gpuMeshCount: number;
  readonly gpuTextureSourceCount: number;
  readonly materialCount: number;
  readonly objectBindingCount: number;
  readonly outputTarget: 'dynamic-taa' | 'surface';
  readonly temporalOwnerId: string | null;
  readonly outputExposure: number;
  readonly outputExposureMultiplier: number;
  readonly outputToneMapping: PbrOutputTransform['toneMapping'];
  readonly pipelineCount: number;
  readonly surface: BackendSurfaceInfo;
  readonly textureSourceCount: number;
  readonly variantKeys: readonly string[];
  readonly visibility: VisibilityDiagnostics | null;
}

function normalizeEnvironment(
  descriptor: PbrEnvironmentDescriptor = {},
  previous?: PbrEnvironmentState,
): PbrEnvironmentState {
  const source = descriptor.source === undefined ? (previous?.source ?? null) : descriptor.source;
  if (source !== null && !(source instanceof EnvironmentSource)) {
    throw new KyxosEngineError('PBR environment source must be an EnvironmentSource or null.', {
      code: 'INVALID_ARGUMENT',
      module: 'renderer',
      recoverable: false,
    });
  }
  const intensity = descriptor.intensity ?? previous?.intensity ?? 1;
  if (!Number.isFinite(intensity) || intensity < 0) {
    throw new KyxosEngineError('PBR environment intensity must be finite and nonnegative.', {
      code: 'INVALID_ARGUMENT',
      module: 'renderer',
      recoverable: false,
    });
  }
  const rotation = descriptor.rotation ?? previous?.rotation ?? 0;
  if (!Number.isFinite(rotation)) {
    throw new KyxosEngineError('PBR environment rotation must be finite.', {
      code: 'INVALID_ARGUMENT',
      module: 'renderer',
      recoverable: false,
    });
  }
  return Object.freeze({ intensity, rotation, source });
}

function normalizeOutput(
  descriptor: PbrOutputTransformDescriptor = {},
  previous?: PbrOutputTransform,
): PbrOutputTransform {
  const exposure = descriptor.exposure ?? previous?.exposure;
  const toneMapping = descriptor.toneMapping ?? previous?.toneMapping;
  return createPbrOutputTransform({
    ...(exposure === undefined ? {} : { exposure }),
    ...(toneMapping === undefined ? {} : { toneMapping }),
  });
}

function blackCubeFaces(): EnvironmentCubeFaceData {
  return Object.fromEntries(
    ENVIRONMENT_CUBE_FACES.map((face) => [face, new Float32Array(3)]),
  ) as unknown as EnvironmentCubeFaceData;
}

function createBlackEnvironment(): EnvironmentSource {
  return new EnvironmentSource({
    brdfLut: { height: 1, pixels: new Float32Array(2), width: 1 },
    diffuseIrradiance: { faces: blackCubeFaces(), size: 1 },
    id: 'kyxos:pbr-black-environment',
    specularPrefilter: { levels: [{ faces: blackCubeFaces() }], size: 1 },
    version: '1',
  });
}

function cloneClearColor(color: BackendClearColor): BackendClearColor {
  if (Object.values(color).some((channel) => !Number.isFinite(channel))) {
    throw new KyxosEngineError('PBR clear-color channels must be finite.', {
      code: 'INVALID_ARGUMENT',
      module: 'renderer',
      recoverable: false,
    });
  }
  return Object.freeze({ ...color });
}

function shaderFailureMessage(
  messages: Awaited<ReturnType<GraphicsBackend['getShaderCompilationInfo']>>['messages'],
): string {
  const errors = messages.filter((message) => message.type === 'error');
  if (errors.length === 0) return 'The PBR WGSL module failed validation.';
  return `The PBR WGSL module failed validation: ${errors
    .map((message) => `${message.lineNumber}:${message.linePosition} ${message.message}`)
    .join('; ')}`;
}

function variantKey(alphaMode: PbrAlphaMode, doubleSided: boolean, normalMap: boolean): string {
  return createPbrMaterialFeatureKey({ alphaMode, doubleSided, normalMap });
}

function fragmentEntryPoint(alphaMode: PbrAlphaMode): string {
  if (alphaMode === 'mask') return 'fragmentMask';
  if (alphaMode === 'blend') return 'fragmentBlend';
  return 'fragmentOpaque';
}

/**
 * Independent forward PBR path for direct light, split-sum IBL, and glTF Texture sampling.
 *
 * It owns every GPU Handle it creates. Scene, Camera, MeshRendererStore,
 * externally supplied PbrMaterialLibrary instances, and registered
 * PbrMaterials and CPU PbrTextureSources remain caller-owned.
 */
export class PbrRenderFeature implements RenderFeature {
  readonly #camera: PerspectiveCamera;
  readonly #dynamicTaaOutput: PbrDynamicTaaOutput | undefined;
  readonly #environmentCache: EnvironmentGpuCache;
  readonly #fallbackEnvironment = createBlackEnvironment();
  readonly #materials: PbrMaterialLibrary;
  readonly #meshRenderers: MeshRendererStore;
  readonly #meshResources = new Map<MeshData, MeshGpuResources>();
  readonly #objectResources = new Map<EntityHandle, ObjectGpuResources>();
  readonly #ownsMaterials: boolean;
  readonly #ownsEnvironmentCache: boolean;
  readonly #ownsTextures: boolean;
  readonly #scene: Scene;
  readonly #surfaceDescriptor: BackendSurfaceDescriptor;
  readonly #textureResources = new Map<PbrTextureSource, TextureGpuResources>();
  readonly #textures: PbrTextureLibrary;
  readonly #visibility: VisibilitySystem;
  readonly id = PBR_RENDER_FEATURE_ID;
  #backend: GraphicsBackend | undefined;
  #cameraLayerMask: number | undefined;
  #clearColor: BackendClearColor;
  #disposed = false;
  #environment: PbrEnvironmentState;
  #environmentLease: EnvironmentGpuLease | undefined;
  #frustumCulling: boolean | undefined;
  #lastFallbackDrawCount = 0;
  #lastTemporalOwnerId: string | null = null;
  #lastVisibility: VisibilityDiagnostics | null = null;
  #light: PbrDirectionalLight;
  #output: PbrOutputTransform;
  #resources: PbrRenderResources | undefined;

  constructor(options: PbrRenderFeatureOptions) {
    if (
      options.scene.disposed ||
      options.camera.disposed ||
      options.meshRenderers.disposed ||
      options.materials?.disposed === true ||
      options.textures?.disposed === true ||
      options.environmentCache?.disposed === true
    ) {
      throw new KyxosEngineError('PBR rendering inputs must be active.', {
        code: 'INVALID_ARGUMENT',
        module: 'renderer',
        recoverable: false,
      });
    }
    if (options.dynamicTaaOutput !== undefined) {
      if (typeof options.dynamicTaaOutput.acquireFrame !== 'function') {
        throw new KyxosEngineError('PBR Dynamic TAA output requires an acquireFrame function.', {
          code: 'INVALID_ARGUMENT',
          module: 'renderer',
          recoverable: false,
        });
      }
      const borrowedSurface = options.dynamicTaaOutput.surface;
      if (
        borrowedSurface !== undefined &&
        (typeof borrowedSurface.getSurfaceInfo !== 'function' ||
          typeof borrowedSurface.resize !== 'function')
      ) {
        throw new KyxosEngineError(
          'PBR Dynamic TAA borrowed Surface requires getSurfaceInfo and resize functions.',
          {
            code: 'INVALID_ARGUMENT',
            module: 'renderer',
            recoverable: false,
          },
        );
      }
    }
    this.#scene = options.scene;
    this.#camera = options.camera;
    this.#dynamicTaaOutput = options.dynamicTaaOutput;
    this.#meshRenderers = options.meshRenderers;
    this.#visibility = options.visibility ?? new VisibilitySystem();
    this.#surfaceDescriptor = { ...options.surface };
    this.#clearColor = cloneClearColor(
      options.clearColor ?? { a: 1, b: 0.025, g: 0.018, r: 0.012 },
    );
    this.#light = createPbrDirectionalLight(options.light);
    this.#environment = normalizeEnvironment(options.environment);
    this.#output = normalizeOutput(options.output);
    this.#environmentCache = options.environmentCache ?? new EnvironmentGpuCache();
    this.#ownsEnvironmentCache = options.environmentCache === undefined;
    this.#materials = options.materials ?? new PbrMaterialLibrary();
    this.#ownsMaterials = options.materials === undefined;
    this.#textures = options.textures ?? new PbrTextureLibrary();
    this.#ownsTextures = options.textures === undefined;
    this.#cameraLayerMask = options.cameraLayerMask;
    this.#frustumCulling = options.frustumCulling;
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  get materials(): PbrMaterialLibrary {
    this.#assertActive();
    return this.#materials;
  }

  get textures(): PbrTextureLibrary {
    this.#assertActive();
    return this.#textures;
  }

  get environment(): PbrEnvironmentState {
    this.#assertActive();
    return this.#environment;
  }

  get output(): PbrOutputTransform {
    this.#assertActive();
    return this.#output;
  }

  async initialize(context: RenderFeatureInitializationContext): Promise<void> {
    this.#assertActive();
    if (this.#resources !== undefined) {
      if (this.#backend !== context.backend) {
        throw this.#error('PBR resources belong to another backend.', 'INVALID_STATE');
      }
      return;
    }

    const backend = context.backend;
    const created: BackendResourceHandle[] = [];
    let acquiredEnvironmentLease: EnvironmentGpuLease | undefined;
    try {
      const borrowedSurface = this.#dynamicTaaOutput?.surface;
      const surface =
        borrowedSurface === undefined ? backend.createSurface(this.#surfaceDescriptor) : undefined;
      if (surface !== undefined) created.push(surface);
      const surfaceInfo =
        surface === undefined ? borrowedSurface?.getSurfaceInfo() : backend.getSurfaceInfo(surface);
      if (surfaceInfo === undefined) {
        throw this.#error('PBR Surface information is unavailable.', 'INVALID_STATE');
      }
      this.#updateCameraAspect(surfaceInfo);
      const dynamicTaa = this.#dynamicTaaOutput !== undefined;
      const shader = backend.createShaderModule({
        code: dynamicTaa ? PHASE_04_PBR_TEMPORAL_OUTPUT_WGSL : PHASE_03_PBR_TONEMAPPED_WGSL,
        label: dynamicTaa ? 'phase-04-pbr-temporal-output' : 'phase-03-pbr-tonemapped',
        language: 'wgsl',
      });
      created.push(shader);
      const compilation = await backend.getShaderCompilationInfo(shader);
      if (!compilation.valid) {
        throw new KyxosEngineError(shaderFailureMessage(compilation.messages), {
          code: 'RESOURCE_CREATION_FAILED',
          module: 'renderer',
          recoverable: false,
          suggestedAction: 'Inspect the compiler diagnostics and regenerate the runtime mirror.',
        });
      }
      const pipelines = new Map<string, BackendPipelineHandle>();
      for (const alphaMode of PBR_ALPHA_MODES) {
        for (const doubleSided of PBR_SIDEDNESS) {
          for (const normalMap of PBR_NORMAL_MAPS) {
            const key = variantKey(alphaMode, doubleSided, normalMap);
            const pipeline = await this.#createPipeline(
              backend,
              shader,
              surfaceInfo,
              alphaMode,
              doubleSided,
              normalMap,
              dynamicTaa,
            );
            created.push(pipeline);
            pipelines.set(key, pipeline);
          }
        }
      }
      const fallbackSampler = backend.createSampler({
        addressModeU: 'repeat',
        addressModeV: 'repeat',
        addressModeW: 'repeat',
        label: 'phase-03-pbr-fallback-sampler',
        magFilter: 'linear',
        minFilter: 'linear',
        mipmapFilter: 'linear',
      });
      created.push(fallbackSampler);
      const fallbackBaseColorTexture = this.#createSolidTexture(
        backend,
        'phase-03-pbr-fallback-base-color',
        'rgba8unorm-srgb',
        [255, 255, 255, 255],
      );
      created.push(fallbackBaseColorTexture);
      const fallbackMetallicRoughnessTexture = this.#createSolidTexture(
        backend,
        'phase-03-pbr-fallback-metallic-roughness',
        'rgba8unorm',
        [255, 255, 255, 255],
      );
      created.push(fallbackMetallicRoughnessTexture);
      const fallbackNormalTexture = this.#createSolidTexture(
        backend,
        'phase-03-pbr-fallback-normal',
        'rgba8unorm',
        [128, 128, 255, 255],
      );
      created.push(fallbackNormalTexture);
      const depthTexture = dynamicTaa ? undefined : this.#createDepthTexture(backend, surfaceInfo);
      if (depthTexture !== undefined) created.push(depthTexture);

      this.#environmentCache.initialize(backend);
      const environmentLease =
        this.#environmentLease ??
        (acquiredEnvironmentLease = this.#environmentCache.acquire(
          this.#environment.source ?? this.#fallbackEnvironment,
        ));
      const environmentBindGroups = this.#createEnvironmentBindGroups(
        backend,
        pipelines,
        environmentLease,
      );
      created.push(...environmentBindGroups.values());

      this.#backend = backend;
      this.#environmentLease = environmentLease;
      this.#resources = {
        depthTexture,
        environmentBindGroups,
        fallbackBaseColorTexture,
        fallbackMetallicRoughnessTexture,
        fallbackNormalTexture,
        fallbackSampler,
        pipelines,
        shader,
        surface,
      };
    } catch (error) {
      const cleanupErrors = this.#destroyHandles(backend, created.reverse());
      if (acquiredEnvironmentLease !== undefined) {
        try {
          acquiredEnvironmentLease.dispose();
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError);
        }
      }
      if (cleanupErrors.length > 0) {
        throw new AggregateError(
          [error, ...cleanupErrors],
          'PBR Render Feature initialization failed.',
          { cause: error },
        );
      }
      throw error;
    }
  }

  render(context: RenderFeatureFrameContext): BackendRenderPassStatistics {
    this.#assertActive();
    const resources = this.#requireResources(context.backend);
    this.#reconcileResources(context.backend);
    const queues = this.#visibility.build(this.#scene, this.#camera, this.#meshRenderers, {
      ...(this.#cameraLayerMask === undefined ? {} : { cameraLayerMask: this.#cameraLayerMask }),
      ...(this.#frustumCulling === undefined ? {} : { frustumCulling: this.#frustumCulling }),
    });
    this.#lastVisibility = queues.diagnostics;
    const surfaceInfo = this.#resolveSurfaceInfo(context.backend, resources);
    if (surfaceInfo.size.suspended) return EMPTY_STATISTICS;
    const surfaceDepthTexture = resources.depthTexture;
    if (this.#dynamicTaaOutput === undefined && surfaceDepthTexture === undefined) {
      throw this.#error('PBR depth Texture is unavailable for a visible Surface.', 'INVALID_STATE');
    }

    let fallbackDrawCount = 0;
    const prepare = (item: RenderItem): BackendDrawCommand => {
      const material = this.#prepareMaterial(item, resources);
      if (material.fallback) fallbackDrawCount += 1;
      return this.#prepareDraw(context.backend, item, material);
    };
    let draws: BackendDrawCommand[];
    try {
      draws = [...queues.opaque.map(prepare), ...queues.transparent.map(prepare)];
    } finally {
      this.#reconcileTextureResources(context.backend);
    }
    this.#lastFallbackDrawCount = fallbackDrawCount;
    const renderPass: BackendRenderPassDescriptor =
      this.#dynamicTaaOutput === undefined
        ? {
            clearColor: this.#clearColor,
            depthAttachment: { texture: surfaceDepthTexture as BackendTextureHandle },
            draws,
            label: 'phase-03-pbr-pass',
            surface: resources.surface,
          }
        : this.#createDynamicTaaRenderPass(surfaceInfo, draws);
    const commandEncoder = context.backend.createCommandEncoder({
      label: `${this.#dynamicTaaOutput === undefined ? 'phase-03-pbr' : 'phase-04-pbr-temporal'}-frame-${context.frameIndex}`,
    });
    try {
      return context.backend.executeFrame({ commandEncoder, renderPasses: [renderPass] });
    } catch (error) {
      context.backend.destroyResource(commandEncoder);
      throw error;
    }
  }

  getSurfaceInfo(): BackendSurfaceInfo {
    this.#assertActive();
    const backend = this.#backend;
    const resources = this.#resources;
    if (backend === undefined || resources === undefined) {
      throw this.#error(
        'PBR rendering must be initialized before reading its Surface.',
        'INVALID_STATE',
      );
    }
    return this.#resolveSurfaceInfo(backend, resources);
  }

  getDiagnostics(): PbrRenderFeatureDiagnostics {
    this.#assertActive();
    const resources = this.#resources;
    if (resources === undefined) {
      throw this.#error('PBR rendering must be initialized before diagnostics.', 'INVALID_STATE');
    }
    return Object.freeze({
      environmentCache: this.#environmentCache.diagnostics(),
      environmentIdentity: this.#environment.source?.identityKey ?? null,
      environmentIntensity: this.#environment.intensity,
      environmentRotation: this.#environment.rotation,
      fallbackDrawCount: this.#lastFallbackDrawCount,
      gpuMeshCount: this.#meshResources.size,
      gpuTextureSourceCount: this.#textureResources.size,
      materialCount: this.#materials.size,
      objectBindingCount: this.#objectResources.size,
      outputTarget: this.#dynamicTaaOutput === undefined ? 'surface' : 'dynamic-taa',
      temporalOwnerId: this.#lastTemporalOwnerId,
      outputExposure: this.#output.exposure,
      outputExposureMultiplier: this.#output.exposureMultiplier,
      outputToneMapping: this.#output.toneMapping,
      pipelineCount: resources.pipelines.size,
      surface: this.getSurfaceInfo(),
      textureSourceCount: this.#textures.size,
      variantKeys: Object.freeze([...resources.pipelines.keys()].sort()),
      visibility: this.#lastVisibility,
    });
  }

  resize(resize: BackendSurfaceResize): BackendSurfaceInfo {
    this.#assertActive();
    Object.assign(this.#surfaceDescriptor, resize);
    const backend = this.#backend;
    const resources = this.#resources;
    if (backend === undefined || resources === undefined) {
      throw this.#error('PBR rendering must be initialized before resizing.', 'INVALID_STATE');
    }
    const surfaceInfo =
      resources.surface === undefined
        ? this.#dynamicTaaOutput?.surface?.resize(resize)
        : backend.resizeSurface(resources.surface, resize);
    if (surfaceInfo === undefined) {
      throw this.#error('PBR borrowed Surface cannot be resized.', 'INVALID_STATE');
    }
    this.#updateCameraAspect(surfaceInfo);
    const nextDepthTexture =
      this.#dynamicTaaOutput === undefined
        ? this.#createDepthTexture(backend, surfaceInfo)
        : undefined;
    const previousDepthTexture = resources.depthTexture;
    resources.depthTexture = nextDepthTexture;
    if (previousDepthTexture !== undefined) backend.destroyResource(previousDepthTexture);
    return surfaceInfo;
  }

  setClearColor(clearColor: BackendClearColor): void {
    this.#assertActive();
    this.#clearColor = cloneClearColor(clearColor);
  }

  setLight(light: PbrDirectionalLightDescriptor): void {
    this.#assertActive();
    this.#light = createPbrDirectionalLight(light);
  }

  setOutputTransform(descriptor: PbrOutputTransformDescriptor): PbrOutputTransform {
    this.#assertActive();
    this.#output = normalizeOutput(descriptor, this.#output);
    return this.#output;
  }

  setEnvironment(descriptor: PbrEnvironmentDescriptor): PbrEnvironmentState {
    this.#assertActive();
    const next = normalizeEnvironment(descriptor, this.#environment);
    const previousEffective = this.#environment.source ?? this.#fallbackEnvironment;
    const nextEffective = next.source ?? this.#fallbackEnvironment;
    if (previousEffective.identityKey !== nextEffective.identityKey) {
      this.#replaceEnvironment(next, nextEffective);
      return next;
    }
    this.#environment = next;
    return next;
  }

  setVisibilityOptions(options: BuildRenderQueuesOptions): void {
    this.#assertActive();
    this.#cameraLayerMask = options.cameraLayerMask;
    this.#frustumCulling = options.frustumCulling;
    this.#visibility.clearCache();
  }

  onBackendLost(): void {
    this.#backend = undefined;
    this.#resources = undefined;
    this.#meshResources.clear();
    this.#objectResources.clear();
    this.#textureResources.clear();
    this.#lastFallbackDrawCount = 0;
    this.#lastTemporalOwnerId = null;
    this.#visibility.clearCache();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    const backend = this.#backend;
    const resources = this.#resources;
    this.#backend = undefined;
    this.#resources = undefined;
    this.#lastVisibility = null;
    this.#visibility.clearCache();

    const handles: BackendResourceHandle[] = [];
    if (backend !== undefined && resources !== undefined) {
      for (const object of this.#objectResources.values()) {
        handles.push(object.bindGroup, object.uniformBuffer);
      }
      for (const mesh of this.#meshResources.values()) {
        handles.push(mesh.indexBuffer, mesh.vertexBuffer);
      }
      for (const texture of this.#textureResources.values()) {
        handles.push(texture.sampler, texture.texture);
      }
      if (resources.depthTexture !== undefined) handles.push(resources.depthTexture);
      handles.push(
        ...resources.environmentBindGroups.values(),
        resources.fallbackBaseColorTexture,
        resources.fallbackMetallicRoughnessTexture,
        resources.fallbackNormalTexture,
        resources.fallbackSampler,
        ...resources.pipelines.values(),
        resources.shader,
      );
      if (resources.surface !== undefined) handles.push(resources.surface);
    }
    this.#meshResources.clear();
    this.#objectResources.clear();
    this.#textureResources.clear();

    const errors = backend === undefined ? [] : this.#destroyHandles(backend, handles);
    try {
      this.#environmentLease?.dispose();
    } catch (error) {
      errors.push(error);
    }
    this.#environmentLease = undefined;
    if (this.#ownsEnvironmentCache) {
      try {
        this.#environmentCache.dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    if (this.#ownsMaterials) {
      try {
        this.#materials.dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    if (this.#ownsTextures) {
      try {
        this.#textures.dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(errors, 'PBR Render Feature resource disposal failed.');
    }
  }

  #resolveSurfaceInfo(backend: GraphicsBackend, resources: PbrRenderResources): BackendSurfaceInfo {
    if (resources.surface !== undefined) return backend.getSurfaceInfo(resources.surface);
    const surfaceInfo = this.#dynamicTaaOutput?.surface?.getSurfaceInfo();
    if (surfaceInfo === undefined) {
      throw this.#error('PBR borrowed Surface information is unavailable.', 'INVALID_STATE');
    }
    return surfaceInfo;
  }

  #createDynamicTaaRenderPass(
    surfaceInfo: BackendSurfaceInfo,
    draws: readonly BackendDrawCommand[],
  ): BackendRenderPassDescriptor {
    const output = this.#dynamicTaaOutput;
    if (output === undefined) {
      throw this.#error('PBR Dynamic TAA output is not configured.', 'INVALID_STATE');
    }
    const frame = output.acquireFrame();
    if (frame.ownerId.trim().length === 0) {
      throw this.#error('PBR Dynamic TAA frame Owner ID must not be empty.', 'INVALID_ARGUMENT');
    }
    if (
      frame.size.width !== surfaceInfo.size.physicalWidth ||
      frame.size.height !== surfaceInfo.size.physicalHeight
    ) {
      throw this.#error(
        `PBR Dynamic TAA frame ${frame.size.width}x${frame.size.height} does not match Surface ${surfaceInfo.size.physicalWidth}x${surfaceInfo.size.physicalHeight}.`,
        'INVALID_ARGUMENT',
      );
    }
    this.#lastTemporalOwnerId = frame.ownerId;
    return {
      clearColor: this.#clearColor,
      colorAttachments: [
        { clearColor: this.#clearColor, texture: frame.currentColorTexture },
        { clearColor: TEMPORAL_NORMAL_CLEAR_COLOR, texture: frame.writeNormalTexture },
      ],
      depthAttachment: { clearValue: 1, texture: frame.writeDepthTexture },
      draws,
      label: 'phase-04-pbr-temporal-mrt-pass',
    };
  }

  async #createPipeline(
    backend: GraphicsBackend,
    shader: BackendShaderModuleHandle,
    surfaceInfo: BackendSurfaceInfo,
    alphaMode: PbrAlphaMode,
    doubleSided: boolean,
    normalMap: boolean,
    dynamicTaa: boolean,
  ): Promise<BackendPipelineHandle> {
    const transparent = alphaMode === 'blend';
    return backend.createRenderPipeline({
      depthStencil: {
        depthCompare: 'less',
        depthWriteEnabled: !transparent,
        format: dynamicTaa ? TEMPORAL_DEPTH_FORMAT : SURFACE_DEPTH_FORMAT,
      },
      fragment: {
        entryPoint: fragmentEntryPoint(alphaMode),
        module: shader,
        targets: dynamicTaa
          ? [
              {
                ...(transparent
                  ? {
                      blend: {
                        alpha: { dstFactor: 'one-minus-src-alpha', srcFactor: 'one' },
                        color: { dstFactor: 'one-minus-src-alpha', srcFactor: 'src-alpha' },
                      },
                    }
                  : {}),
                format: TEMPORAL_COLOR_FORMAT,
              },
              { format: TEMPORAL_NORMAL_FORMAT },
            ]
          : [
              {
                ...(transparent
                  ? {
                      blend: {
                        alpha: { dstFactor: 'one-minus-src-alpha', srcFactor: 'one' },
                        color: { dstFactor: 'one-minus-src-alpha', srcFactor: 'src-alpha' },
                      },
                    }
                  : {}),
                format: surfaceInfo.format,
              },
            ],
      },
      label: `${dynamicTaa ? 'phase-04-pbr-temporal' : 'phase-03-pbr'}-${alphaMode}-${doubleSided ? 'double' : 'single'}-${normalMap ? 'normal' : 'geometric'}`,
      primitive: {
        cullMode: doubleSided ? 'none' : 'back',
        frontFace: 'ccw',
        topology: 'triangle-list',
      },
      vertex: {
        buffers: [
          {
            arrayStride: PBR_VERTEX_STRIDE,
            attributes: [
              { format: 'float32x3', offset: 0, shaderLocation: 0 },
              { format: 'float32x3', offset: 12, shaderLocation: 1 },
              { format: 'float32x2', offset: 24, shaderLocation: 2 },
              { format: 'float32x4', offset: 32, shaderLocation: 3 },
            ],
          },
        ],
        entryPoint: 'vertexMain',
        module: shader,
      },
    });
  }

  #createSolidTexture(
    backend: GraphicsBackend,
    label: string,
    format: 'rgba8unorm' | 'rgba8unorm-srgb',
    pixel: readonly [number, number, number, number],
  ): BackendTextureHandle {
    const texture = backend.createTexture({
      format,
      label,
      size: { height: 1, width: 1 },
      usage: ['copy-dst', 'sampled'],
    });
    try {
      backend.writeTexture(texture, new Uint8Array(pixel), {
        size: { height: 1, width: 1 },
      });
      return texture;
    } catch (error) {
      backend.destroyResource(texture);
      throw error;
    }
  }

  #createDepthTexture(
    backend: GraphicsBackend,
    surfaceInfo: BackendSurfaceInfo,
  ): BackendTextureHandle | undefined {
    if (surfaceInfo.size.suspended) return undefined;
    return backend.createTexture({
      format: SURFACE_DEPTH_FORMAT,
      label: 'phase-03-pbr-depth',
      size: {
        height: surfaceInfo.size.physicalHeight,
        width: surfaceInfo.size.physicalWidth,
      },
      usage: ['render-attachment'],
    });
  }

  #createEnvironmentBindGroups(
    backend: GraphicsBackend,
    pipelines: ReadonlyMap<string, BackendPipelineHandle>,
    lease: EnvironmentGpuLease,
  ): ReadonlyMap<BackendPipelineHandle, BackendBindGroupHandle> {
    const environment = lease.resources;
    const result = new Map<BackendPipelineHandle, BackendBindGroupHandle>();
    try {
      for (const pipeline of pipelines.values()) {
        result.set(
          pipeline,
          backend.createBindGroup({
            entries: [
              {
                binding: 0,
                resource: {
                  texture: environment.diffuseIrradianceTexture,
                  view: environment.diffuseIrradianceView,
                },
              },
              {
                binding: 1,
                resource: {
                  texture: environment.specularPrefilterTexture,
                  view: environment.specularPrefilterView,
                },
              },
              { binding: 2, resource: { sampler: environment.cubeSampler } },
              {
                binding: 3,
                resource: {
                  texture: environment.brdfLutTexture,
                  view: environment.brdfLutView,
                },
              },
              { binding: 4, resource: { sampler: environment.brdfLutSampler } },
            ],
            group: 1,
            label: `pbr-environment-${environment.identityKey}`,
            pipeline,
          }),
        );
      }
      return result;
    } catch (error) {
      const cleanupErrors = this.#destroyHandles(backend, [...result.values()]);
      if (cleanupErrors.length > 0) {
        throw new AggregateError(
          [error, ...cleanupErrors],
          'PBR environment Bind Group creation failed.',
          { cause: error },
        );
      }
      throw error;
    }
  }

  #replaceEnvironment(next: PbrEnvironmentState, source: EnvironmentSource): void {
    const backend = this.#backend;
    const resources = this.#resources;
    if (backend === undefined || resources === undefined) {
      this.#environmentLease?.dispose();
      this.#environmentLease = undefined;
      this.#environment = next;
      return;
    }

    const nextLease = this.#environmentCache.acquire(source);
    let nextBindGroups: ReadonlyMap<BackendPipelineHandle, BackendBindGroupHandle>;
    try {
      nextBindGroups = this.#createEnvironmentBindGroups(backend, resources.pipelines, nextLease);
    } catch (error) {
      nextLease.dispose();
      throw error;
    }

    const previousBindGroups = resources.environmentBindGroups;
    const previousLease = this.#environmentLease;
    resources.environmentBindGroups = nextBindGroups;
    this.#environmentLease = nextLease;
    this.#environment = next;
    const cleanupErrors = this.#destroyHandles(backend, [...previousBindGroups.values()]);
    try {
      previousLease?.dispose();
    } catch (error) {
      cleanupErrors.push(error);
    }
    if (cleanupErrors.length === 1) throw cleanupErrors[0];
    if (cleanupErrors.length > 1) {
      throw new AggregateError(cleanupErrors, 'PBR previous environment cleanup failed.');
    }
  }

  #prepareMaterial(item: RenderItem, resources: PbrRenderResources): PreparedMaterial {
    const fallback = !this.#materials.has(item.materialKey);
    const snapshot = this.#materials.resolve(item.materialKey).snapshot();
    const baseColorBinding = snapshot.textures['base-color'];
    const emissiveBinding = snapshot.textures.emissive;
    const metallicRoughnessBinding = snapshot.textures['metallic-roughness'];
    const normalBinding = snapshot.textures.normal;
    const occlusionBinding = snapshot.textures.occlusion;
    for (const [label, binding] of [
      ['base-color', baseColorBinding],
      ['emissive', emissiveBinding],
      ['metallic-roughness', metallicRoughnessBinding],
      ['normal', normalBinding],
      ['occlusion', occlusionBinding],
    ] as const) {
      if (binding !== null && binding.transform.texCoord !== 0) {
        throw new KyxosEngineError(`PBR ${label} Texture currently requires UV set 0.`, {
          code: 'UNSUPPORTED_CAPABILITY',
          module: 'renderer',
          recoverable: true,
          suggestedAction: 'Use texCoord 0 until additional Mesh UV sets are implemented.',
        });
      }
    }
    const baseColorSource =
      baseColorBinding === null ? null : this.#textures.resolve(baseColorBinding.texture);
    const emissiveSource =
      emissiveBinding === null ? null : this.#textures.resolve(emissiveBinding.texture);
    const metallicRoughnessSource =
      metallicRoughnessBinding === null
        ? null
        : this.#textures.resolve(metallicRoughnessBinding.texture);
    const normalSource =
      normalBinding === null ? null : this.#textures.resolve(normalBinding.texture);
    const occlusionSource =
      occlusionBinding === null ? null : this.#textures.resolve(occlusionBinding.texture);
    const expectedAlphaMode = snapshot.alphaMode === 'blend' ? 'blend' : 'opaque';
    if (item.alphaMode !== expectedAlphaMode) {
      throw this.#error(
        `Mesh Renderer alphaMode "${item.alphaMode}" does not match PBR material "${snapshot.alphaMode}".`,
        'INVALID_ARGUMENT',
      );
    }
    const pipeline = resources.pipelines.get(snapshot.featureKey);
    if (pipeline === undefined) {
      throw this.#error(
        `PBR Shader variant was not prewarmed for feature key "${snapshot.featureKey}".`,
        'INVALID_STATE',
      );
    }
    return Object.freeze({
      baseColorSource,
      emissiveSource,
      fallback,
      metallicRoughnessSource,
      normalSource,
      occlusionSource,
      pipeline,
      snapshot,
    });
  }

  #prepareDraw(
    backend: GraphicsBackend,
    item: RenderItem,
    material: PreparedMaterial,
  ): BackendDrawCommand {
    if (
      (material.baseColorSource !== null ||
        material.emissiveSource !== null ||
        material.metallicRoughnessSource !== null ||
        material.normalSource !== null ||
        material.occlusionSource !== null) &&
      item.mesh.uv0 === null
    ) {
      throw this.#error(
        `Mesh "${item.mesh.name}" requires UV0 for its mapped PBR material.`,
        'INVALID_ARGUMENT',
      );
    }
    const resources = this.#requireResources(backend);
    const baseColorTexture: PreparedTextureBinding =
      material.baseColorSource === null
        ? {
            sampler: resources.fallbackSampler,
            source: null,
            texture: resources.fallbackBaseColorTexture,
          }
        : this.#ensureTextureResources(backend, material.baseColorSource);
    const metallicRoughnessTexture: PreparedTextureBinding =
      material.metallicRoughnessSource === null
        ? {
            sampler: resources.fallbackSampler,
            source: null,
            texture: resources.fallbackMetallicRoughnessTexture,
          }
        : this.#ensureTextureResources(backend, material.metallicRoughnessSource);
    const normalTexture: PreparedTextureBinding =
      material.normalSource === null
        ? {
            sampler: resources.fallbackSampler,
            source: null,
            texture: resources.fallbackNormalTexture,
          }
        : this.#ensureTextureResources(backend, material.normalSource);
    const emissiveTexture: PreparedTextureBinding =
      material.emissiveSource === null
        ? {
            sampler: resources.fallbackSampler,
            source: null,
            texture: resources.fallbackBaseColorTexture,
          }
        : this.#ensureTextureResources(backend, material.emissiveSource);
    const occlusionTexture: PreparedTextureBinding =
      material.occlusionSource === null
        ? {
            sampler: resources.fallbackSampler,
            source: null,
            texture: resources.fallbackMetallicRoughnessTexture,
          }
        : this.#ensureTextureResources(backend, material.occlusionSource);
    const mesh = this.#ensureMeshResources(backend, item.mesh);
    const object = this.#ensureObjectResources(
      backend,
      item.entity,
      material.pipeline,
      baseColorTexture,
      metallicRoughnessTexture,
      normalTexture,
      emissiveTexture,
      occlusionTexture,
    );
    backend.writeBuffer(
      object.uniformBuffer,
      packPbrObjectUniforms({
        cameraPosition: this.#camera.position,
        environment: {
          intensity: this.#environment.intensity,
          rotation: this.#environment.rotation,
          specularMipLevelCount: this.#requireEnvironmentLease().resources.specularMipLevelCount,
        },
        light: this.#light,
        material: material.snapshot,
        normalYDirection: material.normalSource?.normalYDirection ?? 'up',
        output: this.#output,
        viewProjectionMatrix: this.#camera.viewProjectionMatrix(),
        worldMatrix: item.worldMatrix,
      }),
    );
    const environmentBindGroup = resources.environmentBindGroups.get(material.pipeline);
    if (environmentBindGroup === undefined) {
      throw this.#error('PBR environment Bind Group is missing for the Pipeline.', 'INVALID_STATE');
    }
    return {
      bindGroups: [
        { bindGroup: object.bindGroup, group: 0 },
        { bindGroup: environmentBindGroup, group: 1 },
      ],
      indexBuffer: {
        buffer: mesh.indexBuffer,
        format: mesh.indexFormat,
        size: mesh.indexByteLength,
      },
      indexCount: item.mesh.indexCount,
      pipeline: material.pipeline,
      vertexBuffers: [{ buffer: mesh.vertexBuffer, slot: 0 }],
    };
  }

  #ensureMeshResources(backend: GraphicsBackend, mesh: MeshData): MeshGpuResources {
    const existing = this.#meshResources.get(mesh);
    if (existing !== undefined) return existing;

    const tangents = mesh.tangents ?? (mesh.uv0 === null ? null : generateMeshTangents(mesh));
    const vertices = new Float32Array(mesh.vertexCount * 12);
    for (let vertexIndex = 0; vertexIndex < mesh.vertexCount; vertexIndex += 1) {
      const source = vertexIndex * 3;
      const uvSource = vertexIndex * 2;
      const tangentSource = vertexIndex * 4;
      const target = vertexIndex * 12;
      vertices[target] = mesh.positions[source] as number;
      vertices[target + 1] = mesh.positions[source + 1] as number;
      vertices[target + 2] = mesh.positions[source + 2] as number;
      vertices[target + 3] = mesh.normals[source] as number;
      vertices[target + 4] = mesh.normals[source + 1] as number;
      vertices[target + 5] = mesh.normals[source + 2] as number;
      vertices[target + 6] = mesh.uv0?.[uvSource] ?? 0;
      vertices[target + 7] = mesh.uv0?.[uvSource + 1] ?? 0;
      vertices[target + 8] = tangents?.[tangentSource] ?? 1;
      vertices[target + 9] = tangents?.[tangentSource + 1] ?? 0;
      vertices[target + 10] = tangents?.[tangentSource + 2] ?? 0;
      vertices[target + 11] = tangents?.[tangentSource + 3] ?? 1;
    }
    const indexLength =
      mesh.indexFormat === 'uint16' && mesh.indexCount % 2 !== 0
        ? mesh.indexCount + 1
        : mesh.indexCount;
    const indices =
      mesh.indexFormat === 'uint16' ? new Uint16Array(indexLength) : new Uint32Array(indexLength);
    indices.set(mesh.indices);

    let vertexBuffer: BackendBufferHandle | undefined;
    let indexBuffer: BackendBufferHandle | undefined;
    try {
      vertexBuffer = backend.createBuffer({
        label: `${mesh.name}-pbr-vertices`,
        size: vertices.byteLength,
        usage: ['copy-dst', 'vertex'],
      });
      indexBuffer = backend.createBuffer({
        label: `${mesh.name}-pbr-indices`,
        size: indices.byteLength,
        usage: ['copy-dst', 'index'],
      });
      backend.writeBuffer(vertexBuffer, vertices);
      backend.writeBuffer(indexBuffer, indices);
      const result = Object.freeze({
        indexBuffer,
        indexByteLength: indices.byteLength,
        indexFormat: mesh.indexFormat,
        vertexBuffer,
      });
      this.#meshResources.set(mesh, result);
      return result;
    } catch (error) {
      if (indexBuffer !== undefined) backend.destroyResource(indexBuffer);
      if (vertexBuffer !== undefined) backend.destroyResource(vertexBuffer);
      throw error;
    }
  }

  #ensureTextureResources(backend: GraphicsBackend, source: PbrTextureSource): TextureGpuResources {
    const existing = this.#textureResources.get(source);
    if (existing !== undefined) return existing;

    let texture: BackendTextureHandle | undefined;
    let sampler: BackendSamplerHandle | undefined;
    try {
      texture = backend.createTexture({
        format: source.transferFunction === 'srgb' ? 'rgba8unorm-srgb' : 'rgba8unorm',
        label: `pbr-texture-${source.id}`,
        size: { height: source.height, width: source.width },
        usage: ['copy-dst', 'sampled'],
      });
      backend.writeTexture(texture, source.copyPixels(), {
        size: { height: source.height, width: source.width },
      });
      sampler = backend.createSampler({ ...source.sampler, label: `pbr-sampler-${source.id}` });
      const result = Object.freeze({ sampler, source, texture });
      this.#textureResources.set(source, result);
      return result;
    } catch (error) {
      if (sampler !== undefined) backend.destroyResource(sampler);
      if (texture !== undefined) backend.destroyResource(texture);
      throw error;
    }
  }

  #ensureObjectResources(
    backend: GraphicsBackend,
    entity: EntityHandle,
    pipeline: BackendPipelineHandle,
    baseColorTexture: PreparedTextureBinding,
    metallicRoughnessTexture: PreparedTextureBinding,
    normalTexture: PreparedTextureBinding,
    emissiveTexture: PreparedTextureBinding,
    occlusionTexture: PreparedTextureBinding,
  ): ObjectGpuResources {
    const existing = this.#objectResources.get(entity);
    const bindingKey = [
      pipeline.id,
      baseColorTexture.texture.id,
      baseColorTexture.sampler.id,
      metallicRoughnessTexture.texture.id,
      metallicRoughnessTexture.sampler.id,
      normalTexture.texture.id,
      normalTexture.sampler.id,
      emissiveTexture.texture.id,
      emissiveTexture.sampler.id,
      occlusionTexture.texture.id,
      occlusionTexture.sampler.id,
    ].join(':');
    if (existing?.bindingKey === bindingKey) return existing;
    const uniformBuffer =
      existing?.uniformBuffer ??
      backend.createBuffer({
        label: `pbr-object-${entity.id}-uniforms`,
        size: PBR_OBJECT_UNIFORM_LAYOUT.byteLength,
        usage: ['copy-dst', 'uniform'],
      });
    let bindGroup: ObjectGpuResources['bindGroup'];
    try {
      bindGroup = backend.createBindGroup({
        entries: [
          {
            binding: 0,
            resource: { buffer: uniformBuffer, size: PBR_OBJECT_UNIFORM_LAYOUT.byteLength },
          },
          { binding: 1, resource: { texture: baseColorTexture.texture } },
          { binding: 2, resource: { sampler: baseColorTexture.sampler } },
          { binding: 3, resource: { texture: metallicRoughnessTexture.texture } },
          { binding: 4, resource: { sampler: metallicRoughnessTexture.sampler } },
          { binding: 5, resource: { texture: normalTexture.texture } },
          { binding: 6, resource: { sampler: normalTexture.sampler } },
          { binding: 7, resource: { texture: emissiveTexture.texture } },
          { binding: 8, resource: { sampler: emissiveTexture.sampler } },
          { binding: 9, resource: { texture: occlusionTexture.texture } },
          { binding: 10, resource: { sampler: occlusionTexture.sampler } },
        ],
        group: 0,
        label: `pbr-object-${entity.id}`,
        pipeline,
      });
    } catch (error) {
      if (existing === undefined) backend.destroyResource(uniformBuffer);
      throw error;
    }
    if (existing !== undefined) backend.destroyResource(existing.bindGroup);
    const textureSources = Object.freeze(
      [
        ...new Set([
          baseColorTexture.source,
          metallicRoughnessTexture.source,
          normalTexture.source,
          emissiveTexture.source,
          occlusionTexture.source,
        ]),
      ].filter((source): source is PbrTextureSource => source !== null),
    );
    const result = Object.freeze({
      bindingKey,
      bindGroup,
      pipeline,
      textureSources,
      uniformBuffer,
    });
    this.#objectResources.set(entity, result);
    return result;
  }

  #reconcileResources(backend: GraphicsBackend): void {
    const entries = this.#meshRenderers.entries();
    const entities = new Set(entries.map(([entity]) => entity));
    const meshes = new Set(entries.map(([, component]) => component.mesh));
    for (const [entity, object] of this.#objectResources) {
      if (entities.has(entity)) continue;
      backend.destroyResource(object.bindGroup);
      backend.destroyResource(object.uniformBuffer);
      this.#objectResources.delete(entity);
    }
    for (const [mesh, resources] of this.#meshResources) {
      if (meshes.has(mesh)) continue;
      backend.destroyResource(resources.indexBuffer);
      backend.destroyResource(resources.vertexBuffer);
      this.#meshResources.delete(mesh);
    }
  }

  #reconcileTextureResources(backend: GraphicsBackend): void {
    const retained = new Set<PbrTextureSource>();
    for (const object of this.#objectResources.values()) {
      for (const source of object.textureSources) retained.add(source);
    }
    for (const [source, resources] of this.#textureResources) {
      if (retained.has(source)) continue;
      backend.destroyResource(resources.sampler);
      backend.destroyResource(resources.texture);
      this.#textureResources.delete(source);
    }
  }

  #updateCameraAspect(surfaceInfo: BackendSurfaceInfo): void {
    if (surfaceInfo.size.suspended) return;
    this.#camera.setAspect(surfaceInfo.size.physicalWidth / surfaceInfo.size.physicalHeight);
  }

  #requireResources(backend: GraphicsBackend): PbrRenderResources {
    if (backend !== this.#backend || this.#resources === undefined) {
      throw this.#error('PBR resources are not initialized for this backend.', 'INVALID_STATE');
    }
    return this.#resources;
  }

  #requireEnvironmentLease(): EnvironmentGpuLease {
    if (this.#environmentLease === undefined) {
      throw this.#error('PBR environment resources are not initialized.', 'INVALID_STATE');
    }
    return this.#environmentLease;
  }

  #assertActive(): void {
    if (this.#disposed) {
      throw this.#error('PBR Render Feature is disposed.', 'ALREADY_DISPOSED');
    }
  }

  #destroyHandles(backend: GraphicsBackend, handles: readonly BackendResourceHandle[]): unknown[] {
    const errors: unknown[] = [];
    for (const handle of handles) {
      try {
        backend.destroyResource(handle);
      } catch (error) {
        errors.push(error);
      }
    }
    return errors;
  }

  #error(
    message: string,
    code: 'ALREADY_DISPOSED' | 'INVALID_ARGUMENT' | 'INVALID_STATE',
  ): KyxosEngineError {
    return new KyxosEngineError(message, { code, module: 'renderer', recoverable: false });
  }
}
