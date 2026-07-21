import type {
  BackendBufferHandle,
  BackendClearColor,
  BackendDrawCommand,
  BackendPipelineHandle,
  BackendRenderPassStatistics,
  BackendResourceHandle,
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
import type { MeshData } from '@kyxos/render-geometry';
import { multiplyMat4, normalMatrixMat4 } from '@kyxos/render-math';
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
import { PHASE_02_SCENE_WGSL } from './generated/phase-02-scene.wgsl.js';

export const SCENE_RENDER_FEATURE_ID = 'kyxos.scene-basic' as const;

const DEPTH_FORMAT = 'depth24plus' as const;
const OBJECT_UNIFORM_FLOATS = 36;
const OBJECT_UNIFORM_BYTES = OBJECT_UNIFORM_FLOATS * Float32Array.BYTES_PER_ELEMENT;
const SCENE_VERTEX_STRIDE = 6 * Float32Array.BYTES_PER_ELEMENT;
const EMPTY_STATISTICS: BackendRenderPassStatistics = Object.freeze({
  drawCalls: 0,
  instances: 0,
  triangles: 0,
  vertices: 0,
});

interface SceneResources {
  depthTexture: BackendTextureHandle | undefined;
  readonly opaquePipeline: BackendPipelineHandle;
  readonly shader: BackendShaderModuleHandle;
  readonly surface: BackendSurfaceHandle;
  readonly transparentPipeline: BackendPipelineHandle;
}

interface MeshGpuResources {
  readonly indexBuffer: BackendBufferHandle;
  readonly indexByteLength: number;
  readonly indexFormat: MeshData['indexFormat'];
  readonly vertexBuffer: BackendBufferHandle;
}

interface ObjectGpuResources {
  readonly bindGroup: ReturnType<GraphicsBackend['createBindGroup']>;
  readonly pipeline: BackendPipelineHandle;
  readonly uniformBuffer: BackendBufferHandle;
}

export interface SceneRenderFeatureOptions extends BuildRenderQueuesOptions {
  readonly camera: PerspectiveCamera;
  readonly clearColor?: BackendClearColor;
  readonly meshRenderers: MeshRendererStore;
  readonly scene: Scene;
  readonly surface: BackendSurfaceDescriptor;
  readonly visibility?: VisibilitySystem;
}

export interface SceneRenderFeatureDiagnostics {
  readonly gpuMeshCount: number;
  readonly objectBindingCount: number;
  readonly surface: BackendSurfaceInfo;
  readonly visibility: VisibilityDiagnostics | null;
}

function cloneClearColor(color: BackendClearColor): BackendClearColor {
  if (Object.values(color).some((channel) => !Number.isFinite(channel))) {
    throw new KyxosEngineError('Scene clear-color channels must be finite.', {
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
  if (errors.length === 0) return 'The Phase 2 Scene WGSL module failed validation.';
  return `The Phase 2 Scene WGSL module failed validation: ${errors
    .map((message) => `${message.lineNumber}:${message.linePosition} ${message.message}`)
    .join('; ')}`;
}

export class SceneRenderFeature implements RenderFeature {
  readonly #camera: PerspectiveCamera;
  readonly #meshRenderers: MeshRendererStore;
  readonly #meshResources = new Map<MeshData, MeshGpuResources>();
  readonly #objectResources = new Map<EntityHandle, ObjectGpuResources>();
  readonly #scene: Scene;
  readonly #surfaceDescriptor: BackendSurfaceDescriptor;
  readonly #visibility: VisibilitySystem;
  readonly id = SCENE_RENDER_FEATURE_ID;
  #backend: GraphicsBackend | undefined;
  #cameraLayerMask: number | undefined;
  #clearColor: BackendClearColor;
  #disposed = false;
  #frustumCulling: boolean | undefined;
  #lastVisibility: VisibilityDiagnostics | null = null;
  #resources: SceneResources | undefined;

  constructor(options: SceneRenderFeatureOptions) {
    if (options.scene.disposed || options.camera.disposed || options.meshRenderers.disposed) {
      throw new KyxosEngineError('Scene rendering inputs must be active.', {
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
      options.clearColor ?? { a: 1, b: 0.055, g: 0.035, r: 0.025 },
    );
    this.#cameraLayerMask = options.cameraLayerMask;
    this.#frustumCulling = options.frustumCulling;
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  async initialize(context: RenderFeatureInitializationContext): Promise<void> {
    this.#assertActive();
    if (this.#resources !== undefined) {
      if (this.#backend !== context.backend) {
        throw this.#error('Scene resources belong to another backend.', 'INVALID_STATE');
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
        code: PHASE_02_SCENE_WGSL,
        label: 'phase-02-scene',
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
      const opaquePipeline = await this.#createPipeline(backend, shader, surfaceInfo, false);
      created.push(opaquePipeline);
      const transparentPipeline = await this.#createPipeline(backend, shader, surfaceInfo, true);
      created.push(transparentPipeline);
      const depthTexture = this.#createDepthTexture(backend, surfaceInfo);
      if (depthTexture !== undefined) created.push(depthTexture);

      this.#backend = backend;
      this.#resources = {
        depthTexture,
        opaquePipeline,
        shader,
        surface,
        transparentPipeline,
      };
    } catch (error) {
      const cleanupErrors = this.#destroyHandles(backend, created.reverse());
      if (cleanupErrors.length > 0) {
        throw new AggregateError(
          [error, ...cleanupErrors],
          'Scene Render Feature initialization failed.',
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
      throw this.#error(
        'Scene depth Texture is unavailable for a visible Surface.',
        'INVALID_STATE',
      );
    }

    const draws = [
      ...queues.opaque.map((item) =>
        this.#prepareDraw(context.backend, item, resources.opaquePipeline),
      ),
      ...queues.transparent.map((item) =>
        this.#prepareDraw(context.backend, item, resources.transparentPipeline),
      ),
    ];
    const commandEncoder = context.backend.createCommandEncoder({
      label: `phase-02-scene-frame-${context.frameIndex}`,
    });
    try {
      return context.backend.executeFrame({
        commandEncoder,
        renderPasses: [
          {
            clearColor: this.#clearColor,
            depthAttachment: { texture: resources.depthTexture },
            draws,
            label: 'phase-02-scene-pass',
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
        'Scene rendering must be initialized before reading its Surface.',
        'INVALID_STATE',
      );
    }
    return backend.getSurfaceInfo(resources.surface);
  }

  getDiagnostics(): SceneRenderFeatureDiagnostics {
    return Object.freeze({
      gpuMeshCount: this.#meshResources.size,
      objectBindingCount: this.#objectResources.size,
      surface: this.getSurfaceInfo(),
      visibility: this.#lastVisibility,
    });
  }

  resize(resize: BackendSurfaceResize): BackendSurfaceInfo {
    this.#assertActive();
    Object.assign(this.#surfaceDescriptor, resize);
    const backend = this.#backend;
    const resources = this.#resources;
    if (backend === undefined || resources === undefined) {
      throw this.#error('Scene rendering must be initialized before resizing.', 'INVALID_STATE');
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
    if (backend === undefined || resources === undefined) {
      this.#meshResources.clear();
      this.#objectResources.clear();
      return;
    }

    const handles: BackendResourceHandle[] = [];
    for (const object of this.#objectResources.values()) {
      handles.push(object.bindGroup, object.uniformBuffer);
    }
    for (const mesh of this.#meshResources.values()) {
      handles.push(mesh.indexBuffer, mesh.vertexBuffer);
    }
    if (resources.depthTexture !== undefined) handles.push(resources.depthTexture);
    handles.push(
      resources.transparentPipeline,
      resources.opaquePipeline,
      resources.shader,
      resources.surface,
    );
    this.#meshResources.clear();
    this.#objectResources.clear();
    const errors = this.#destroyHandles(backend, handles);
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(errors, 'Scene Render Feature resource disposal failed.');
    }
  }

  async #createPipeline(
    backend: GraphicsBackend,
    shader: BackendShaderModuleHandle,
    surfaceInfo: BackendSurfaceInfo,
    transparent: boolean,
  ): Promise<BackendPipelineHandle> {
    return backend.createRenderPipeline({
      depthStencil: {
        depthCompare: 'less',
        depthWriteEnabled: !transparent,
        format: DEPTH_FORMAT,
      },
      fragment: {
        entryPoint: 'fragmentMain',
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
      label: transparent ? 'phase-02-scene-transparent' : 'phase-02-scene-opaque',
      primitive: { cullMode: 'back', frontFace: 'ccw', topology: 'triangle-list' },
      vertex: {
        buffers: [
          {
            arrayStride: SCENE_VERTEX_STRIDE,
            attributes: [
              { format: 'float32x3', offset: 0, shaderLocation: 0 },
              { format: 'float32x3', offset: 12, shaderLocation: 1 },
            ],
          },
        ],
        entryPoint: 'vertexMain',
        module: shader,
      },
    });
  }

  #createDepthTexture(
    backend: GraphicsBackend,
    surfaceInfo: BackendSurfaceInfo,
  ): BackendTextureHandle | undefined {
    if (surfaceInfo.size.suspended) return undefined;
    return backend.createTexture({
      format: DEPTH_FORMAT,
      label: 'phase-02-scene-depth',
      size: {
        height: surfaceInfo.size.physicalHeight,
        width: surfaceInfo.size.physicalWidth,
      },
      usage: ['render-attachment'],
    });
  }

  #prepareDraw(
    backend: GraphicsBackend,
    item: RenderItem,
    pipeline: BackendPipelineHandle,
  ): BackendDrawCommand {
    const mesh = this.#ensureMeshResources(backend, item.mesh);
    const object = this.#ensureObjectResources(backend, item.entity, pipeline);
    const uniforms = new Float32Array(OBJECT_UNIFORM_FLOATS);
    uniforms.set(multiplyMat4(this.#camera.viewProjectionMatrix(), item.worldMatrix), 0);
    try {
      uniforms.set(normalMatrixMat4(item.worldMatrix), 16);
    } catch (cause) {
      throw new KyxosEngineError('Scene Entity world transform cannot produce a normal Matrix.', {
        cause,
        code: 'INVALID_ARGUMENT',
        module: 'renderer',
        recoverable: false,
      });
    }
    uniforms.set(item.baseColor, 32);
    backend.writeBuffer(object.uniformBuffer, uniforms);
    return {
      bindGroups: [{ bindGroup: object.bindGroup, group: 0 }],
      indexBuffer: {
        buffer: mesh.indexBuffer,
        format: mesh.indexFormat,
        size: mesh.indexByteLength,
      },
      indexCount: item.mesh.indexCount,
      pipeline,
      vertexBuffers: [{ buffer: mesh.vertexBuffer, slot: 0 }],
    };
  }

  #ensureMeshResources(backend: GraphicsBackend, mesh: MeshData): MeshGpuResources {
    const existing = this.#meshResources.get(mesh);
    if (existing !== undefined) return existing;

    const vertices = new Float32Array(mesh.vertexCount * 6);
    for (let vertexIndex = 0; vertexIndex < mesh.vertexCount; vertexIndex += 1) {
      const source = vertexIndex * 3;
      const target = vertexIndex * 6;
      vertices[target] = mesh.positions[source] as number;
      vertices[target + 1] = mesh.positions[source + 1] as number;
      vertices[target + 2] = mesh.positions[source + 2] as number;
      vertices[target + 3] = mesh.normals[source] as number;
      vertices[target + 4] = mesh.normals[source + 1] as number;
      vertices[target + 5] = mesh.normals[source + 2] as number;
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
        label: `${mesh.name}-vertices`,
        size: vertices.byteLength,
        usage: ['copy-dst', 'vertex'],
      });
      indexBuffer = backend.createBuffer({
        label: `${mesh.name}-indices`,
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

  #ensureObjectResources(
    backend: GraphicsBackend,
    entity: EntityHandle,
    pipeline: BackendPipelineHandle,
  ): ObjectGpuResources {
    const existing = this.#objectResources.get(entity);
    if (existing?.pipeline === pipeline) return existing;
    const uniformBuffer =
      existing?.uniformBuffer ??
      backend.createBuffer({
        label: `scene-object-${entity.id}-uniforms`,
        size: OBJECT_UNIFORM_BYTES,
        usage: ['copy-dst', 'uniform'],
      });
    let bindGroup: ObjectGpuResources['bindGroup'];
    try {
      bindGroup = backend.createBindGroup({
        entries: [{ binding: 0, resource: { buffer: uniformBuffer, size: OBJECT_UNIFORM_BYTES } }],
        group: 0,
        label: `scene-object-${entity.id}`,
        pipeline,
      });
    } catch (error) {
      if (existing === undefined) backend.destroyResource(uniformBuffer);
      throw error;
    }
    if (existing !== undefined) backend.destroyResource(existing.bindGroup);
    const result = Object.freeze({ bindGroup, pipeline, uniformBuffer });
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

  #updateCameraAspect(surfaceInfo: BackendSurfaceInfo): void {
    if (surfaceInfo.size.suspended) return;
    this.#camera.setAspect(surfaceInfo.size.physicalWidth / surfaceInfo.size.physicalHeight);
  }

  #requireResources(backend: GraphicsBackend): SceneResources {
    if (backend !== this.#backend || this.#resources === undefined) {
      throw this.#error(
        'Scene rendering resources are not initialized for this backend.',
        'INVALID_STATE',
      );
    }
    return this.#resources;
  }

  #assertActive(): void {
    if (this.#disposed) throw this.#error('Scene Render Feature is disposed.', 'ALREADY_DISPOSED');
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
