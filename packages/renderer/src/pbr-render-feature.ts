import type {
  BackendBufferHandle,
  BackendClearColor,
  BackendDrawCommand,
  BackendPipelineHandle,
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
import { generateMeshTangents } from '@kyxos/render-geometry';
import type { MeshData } from '@kyxos/render-geometry';
import { PBR_TEXTURE_SLOTS, createPbrMaterialFeatureKey } from '@kyxos/render-material-pbr';
import type { PbrAlphaMode, PbrMaterialSnapshot } from '@kyxos/render-material-pbr';
import type { EntityHandle, Scene } from '@kyxos/render-scene';
import { VisibilitySystem } from '@kyxos/render-visibility';
import type {
  BuildRenderQueuesOptions,
  MeshRendererStore,
  RenderItem,
  VisibilityDiagnostics,
} from '@kyxos/render-visibility';

import type {
  RenderFeature,
  RenderFeatureFrameContext,
  RenderFeatureInitializationContext,
} from './extensions.js';
import { PHASE_03_PBR_DIRECT_WGSL } from './generated/phase-03-pbr-direct.wgsl.js';
import {
  PBR_OBJECT_UNIFORM_LAYOUT,
  createPbrDirectionalLight,
  packPbrObjectUniforms,
} from './pbr-gpu-layout.js';
import type { PbrDirectionalLight, PbrDirectionalLightDescriptor } from './pbr-gpu-layout.js';
import { PbrMaterialLibrary } from './pbr-material-library.js';
import { PbrTextureLibrary, PbrTextureSource } from './pbr-texture-library.js';

export const PBR_RENDER_FEATURE_ID = 'kyxos.pbr-direct' as const;

const DEPTH_FORMAT = 'depth24plus' as const;
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
  readonly fallbackBaseColorTexture: BackendTextureHandle;
  readonly fallbackMetallicRoughnessTexture: BackendTextureHandle;
  readonly fallbackNormalTexture: BackendTextureHandle;
  readonly fallbackSampler: BackendSamplerHandle;
  readonly pipelines: ReadonlyMap<string, BackendPipelineHandle>;
  readonly shader: BackendShaderModuleHandle;
  readonly surface: BackendSurfaceHandle;
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
  readonly pipeline: BackendPipelineHandle;
  readonly snapshot: PbrMaterialSnapshot;
}

export interface PbrRenderFeatureOptions extends BuildRenderQueuesOptions {
  readonly camera: PerspectiveCamera;
  readonly clearColor?: BackendClearColor;
  readonly light?: PbrDirectionalLightDescriptor;
  /**
   * The caller retains ownership of a supplied library. An omitted library is
   * created and owned by this Render Feature.
   */
  readonly materials?: PbrMaterialLibrary;
  readonly meshRenderers: MeshRendererStore;
  readonly scene: Scene;
  readonly surface: BackendSurfaceDescriptor;
  /** CPU RGBA8 sources remain caller-owned when this registry is supplied. */
  readonly textures?: PbrTextureLibrary;
  readonly visibility?: VisibilitySystem;
}

export interface PbrRenderFeatureDiagnostics {
  readonly fallbackDrawCount: number;
  readonly gpuMeshCount: number;
  readonly gpuTextureSourceCount: number;
  readonly materialCount: number;
  readonly objectBindingCount: number;
  readonly pipelineCount: number;
  readonly surface: BackendSurfaceInfo;
  readonly textureSourceCount: number;
  readonly variantKeys: readonly string[];
  readonly visibility: VisibilityDiagnostics | null;
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
  if (errors.length === 0) return 'The Phase 3 direct-light PBR WGSL module failed validation.';
  return `The Phase 3 direct-light PBR WGSL module failed validation: ${errors
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
 * Independent forward PBR path for direct light and glTF factor-map sampling.
 *
 * It owns every GPU Handle it creates. Scene, Camera, MeshRendererStore,
 * externally supplied PbrMaterialLibrary instances, and registered
 * PbrMaterials and CPU PbrTextureSources remain caller-owned.
 */
export class PbrRenderFeature implements RenderFeature {
  readonly #camera: PerspectiveCamera;
  readonly #materials: PbrMaterialLibrary;
  readonly #meshRenderers: MeshRendererStore;
  readonly #meshResources = new Map<MeshData, MeshGpuResources>();
  readonly #objectResources = new Map<EntityHandle, ObjectGpuResources>();
  readonly #ownsMaterials: boolean;
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
  #frustumCulling: boolean | undefined;
  #lastFallbackDrawCount = 0;
  #lastVisibility: VisibilityDiagnostics | null = null;
  #light: PbrDirectionalLight;
  #resources: PbrRenderResources | undefined;

  constructor(options: PbrRenderFeatureOptions) {
    if (
      options.scene.disposed ||
      options.camera.disposed ||
      options.meshRenderers.disposed ||
      options.materials?.disposed === true ||
      options.textures?.disposed === true
    ) {
      throw new KyxosEngineError('PBR rendering inputs must be active.', {
        code: 'INVALID_ARGUMENT',
        module: 'renderer',
        recoverable: false,
      });
    }
    this.#scene = options.scene;
    this.#camera = options.camera;
    this.#meshRenderers = options.meshRenderers;
    this.#visibility = options.visibility ?? new VisibilitySystem();
    this.#surfaceDescriptor = { ...options.surface };
    this.#clearColor = cloneClearColor(
      options.clearColor ?? { a: 1, b: 0.025, g: 0.018, r: 0.012 },
    );
    this.#light = createPbrDirectionalLight(options.light);
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
    try {
      const surface = backend.createSurface(this.#surfaceDescriptor);
      created.push(surface);
      const surfaceInfo = backend.getSurfaceInfo(surface);
      this.#updateCameraAspect(surfaceInfo);
      const shader = backend.createShaderModule({
        code: PHASE_03_PBR_DIRECT_WGSL,
        label: 'phase-03-pbr-direct',
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
      const depthTexture = this.#createDepthTexture(backend, surfaceInfo);
      if (depthTexture !== undefined) created.push(depthTexture);

      this.#backend = backend;
      this.#resources = {
        depthTexture,
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
    const surfaceInfo = context.backend.getSurfaceInfo(resources.surface);
    if (surfaceInfo.size.suspended) return EMPTY_STATISTICS;
    if (resources.depthTexture === undefined) {
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
    const commandEncoder = context.backend.createCommandEncoder({
      label: `phase-03-pbr-frame-${context.frameIndex}`,
    });
    try {
      return context.backend.executeFrame({
        commandEncoder,
        renderPasses: [
          {
            clearColor: this.#clearColor,
            depthAttachment: { texture: resources.depthTexture },
            draws,
            label: 'phase-03-pbr-direct-pass',
            surface: resources.surface,
          },
        ],
      });
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
    return backend.getSurfaceInfo(resources.surface);
  }

  getDiagnostics(): PbrRenderFeatureDiagnostics {
    this.#assertActive();
    const resources = this.#resources;
    if (resources === undefined) {
      throw this.#error('PBR rendering must be initialized before diagnostics.', 'INVALID_STATE');
    }
    return Object.freeze({
      fallbackDrawCount: this.#lastFallbackDrawCount,
      gpuMeshCount: this.#meshResources.size,
      gpuTextureSourceCount: this.#textureResources.size,
      materialCount: this.#materials.size,
      objectBindingCount: this.#objectResources.size,
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
    const surfaceInfo = backend.resizeSurface(resources.surface, resize);
    this.#updateCameraAspect(surfaceInfo);
    const nextDepthTexture = this.#createDepthTexture(backend, surfaceInfo);
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
        resources.fallbackBaseColorTexture,
        resources.fallbackMetallicRoughnessTexture,
        resources.fallbackNormalTexture,
        resources.fallbackSampler,
        ...resources.pipelines.values(),
        resources.shader,
        resources.surface,
      );
    }
    this.#meshResources.clear();
    this.#objectResources.clear();
    this.#textureResources.clear();

    const errors = backend === undefined ? [] : this.#destroyHandles(backend, handles);
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

  async #createPipeline(
    backend: GraphicsBackend,
    shader: BackendShaderModuleHandle,
    surfaceInfo: BackendSurfaceInfo,
    alphaMode: PbrAlphaMode,
    doubleSided: boolean,
    normalMap: boolean,
  ): Promise<BackendPipelineHandle> {
    const transparent = alphaMode === 'blend';
    return backend.createRenderPipeline({
      depthStencil: {
        depthCompare: 'less',
        depthWriteEnabled: !transparent,
        format: DEPTH_FORMAT,
      },
      fragment: {
        entryPoint: fragmentEntryPoint(alphaMode),
        module: shader,
        targets: [
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
      label: `phase-03-pbr-${alphaMode}-${doubleSided ? 'double' : 'single'}-${normalMap ? 'normal' : 'geometric'}`,
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
      format: DEPTH_FORMAT,
      label: 'phase-03-pbr-depth',
      size: {
        height: surfaceInfo.size.physicalHeight,
        width: surfaceInfo.size.physicalWidth,
      },
      usage: ['render-attachment'],
    });
  }

  #prepareMaterial(item: RenderItem, resources: PbrRenderResources): PreparedMaterial {
    const fallback = !this.#materials.has(item.materialKey);
    const snapshot = this.#materials.resolve(item.materialKey).snapshot();
    const unsupportedSlots = PBR_TEXTURE_SLOTS.filter(
      (slot) => slot === 'occlusion' && snapshot.textures[slot] !== null,
    );
    if (unsupportedSlots.length > 0) {
      throw new KyxosEngineError(
        `P3-05 material rendering does not yet bind PBR textures: ${unsupportedSlots.join(', ')}.`,
        {
          code: 'UNSUPPORTED_CAPABILITY',
          module: 'renderer',
          recoverable: true,
          suggestedAction: 'Retain occlusion for the IBL indirect-light checkpoint.',
        },
      );
    }
    const baseColorBinding = snapshot.textures['base-color'];
    const emissiveBinding = snapshot.textures.emissive;
    const metallicRoughnessBinding = snapshot.textures['metallic-roughness'];
    const normalBinding = snapshot.textures.normal;
    for (const [label, binding] of [
      ['base-color', baseColorBinding],
      ['emissive', emissiveBinding],
      ['metallic-roughness', metallicRoughnessBinding],
      ['normal', normalBinding],
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
        material.normalSource !== null) &&
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
    const mesh = this.#ensureMeshResources(backend, item.mesh);
    const object = this.#ensureObjectResources(
      backend,
      item.entity,
      material.pipeline,
      baseColorTexture,
      metallicRoughnessTexture,
      normalTexture,
      emissiveTexture,
    );
    backend.writeBuffer(
      object.uniformBuffer,
      packPbrObjectUniforms({
        cameraPosition: this.#camera.position,
        light: this.#light,
        material: material.snapshot,
        normalYDirection: material.normalSource?.normalYDirection ?? 'up',
        viewProjectionMatrix: this.#camera.viewProjectionMatrix(),
        worldMatrix: item.worldMatrix,
      }),
    );
    return {
      bindGroups: [{ bindGroup: object.bindGroup, group: 0 }],
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
