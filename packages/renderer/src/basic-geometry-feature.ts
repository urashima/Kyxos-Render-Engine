import type {
  BackendBufferHandle,
  BackendClearColor,
  BackendPipelineHandle,
  BackendRenderPassStatistics,
  BackendResourceHandle,
  BackendShaderModuleHandle,
  BackendSurfaceDescriptor,
  BackendSurfaceHandle,
  BackendSurfaceInfo,
  BackendSurfaceResize,
  GraphicsBackend,
} from '@kyxos/render-backend-api';
import { KyxosEngineError } from '@kyxos/render-core';

import {
  BASIC_GEOMETRY_VERTEX_STRIDE,
  createSphereGeometry,
  createTriangleGeometry,
} from './basic-geometry.js';
import type {
  BasicGeometryData,
  BasicGeometryPrimitive,
  SphereGeometryOptions,
} from './basic-geometry.js';
import type {
  RenderFeature,
  RenderFeatureFrameContext,
  RenderFeatureInitializationContext,
} from './extensions.js';
import { PHASE_01_BASIC_WGSL } from './generated/phase-01-basic.wgsl.js';

export const BASIC_GEOMETRY_FEATURE_ID = 'kyxos.basic-geometry' as const;

const EMPTY_STATISTICS: BackendRenderPassStatistics = Object.freeze({
  drawCalls: 0,
  instances: 0,
  triangles: 0,
  vertices: 0,
});

interface BasicGeometryResources {
  readonly indexBuffer: BackendBufferHandle;
  readonly pipeline: BackendPipelineHandle;
  readonly shader: BackendShaderModuleHandle;
  readonly sphereVertexBuffer: BackendBufferHandle;
  readonly surface: BackendSurfaceHandle;
  readonly triangleVertexBuffer: BackendBufferHandle;
}

export interface BasicGeometryFeatureOptions {
  readonly clearColor?: BackendClearColor;
  readonly primitive?: BasicGeometryPrimitive;
  readonly sphere?: SphereGeometryOptions;
  readonly surface: BackendSurfaceDescriptor;
}

function cloneClearColor(color: BackendClearColor): BackendClearColor {
  if (Object.values(color).some((channel) => !Number.isFinite(channel))) {
    throw new KyxosEngineError('Basic geometry clear-color channels must be finite.', {
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
  if (errors.length === 0) return 'The Phase 1 WGSL module failed validation.';
  return `The Phase 1 WGSL module failed validation: ${errors
    .map((message) => `${message.lineNumber}:${message.linePosition} ${message.message}`)
    .join('; ')}`;
}

export class BasicGeometryFeature implements RenderFeature {
  readonly #sphere: BasicGeometryData;
  readonly #surfaceDescriptor: BackendSurfaceDescriptor;
  readonly #triangle = createTriangleGeometry();
  readonly id = BASIC_GEOMETRY_FEATURE_ID;
  #backend: GraphicsBackend | undefined;
  #clearColor: BackendClearColor;
  #disposed = false;
  #primitive: BasicGeometryPrimitive;
  #resources: BasicGeometryResources | undefined;

  constructor(options: BasicGeometryFeatureOptions) {
    this.#primitive = options.primitive ?? 'triangle';
    this.#clearColor = cloneClearColor(
      options.clearColor ?? { a: 1, b: 0.055, g: 0.035, r: 0.025 },
    );
    this.#surfaceDescriptor = { ...options.surface };
    this.#sphere = createSphereGeometry(options.sphere);
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  get primitive(): BasicGeometryPrimitive {
    return this.#primitive;
  }

  getSurfaceInfo(): BackendSurfaceInfo {
    this.#assertActive();
    const backend = this.#backend;
    const resources = this.#resources;
    if (backend === undefined || resources === undefined) {
      throw new KyxosEngineError('Basic geometry must be initialized before reading its Surface.', {
        code: 'INVALID_STATE',
        module: 'renderer',
        recoverable: false,
      });
    }
    return backend.getSurfaceInfo(resources.surface);
  }

  async initialize(context: RenderFeatureInitializationContext): Promise<void> {
    this.#assertActive();
    if (this.#resources !== undefined) {
      if (this.#backend !== context.backend) {
        throw new KyxosEngineError('Basic geometry resources belong to another backend.', {
          code: 'INVALID_STATE',
          module: 'renderer',
          recoverable: false,
        });
      }
      return;
    }

    const backend = context.backend;
    const created: BackendResourceHandle[] = [];
    try {
      const surface = backend.createSurface(this.#surfaceDescriptor);
      created.push(surface);
      const surfaceInfo = backend.getSurfaceInfo(surface);
      const shader = backend.createShaderModule({
        code: PHASE_01_BASIC_WGSL,
        label: 'phase-01-basic',
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
      const pipeline = await backend.createRenderPipeline({
        fragment: {
          entryPoint: 'fragmentMain',
          module: shader,
          targets: [{ format: surfaceInfo.format }],
        },
        label: 'phase-01-basic',
        primitive: { cullMode: 'none', frontFace: 'ccw', topology: 'triangle-list' },
        vertex: {
          buffers: [
            {
              arrayStride: BASIC_GEOMETRY_VERTEX_STRIDE,
              attributes: [
                { format: 'float32x3', offset: 0, shaderLocation: 0 },
                { format: 'float32x3', offset: 12, shaderLocation: 1 },
                { format: 'float32x3', offset: 24, shaderLocation: 2 },
              ],
            },
          ],
          entryPoint: 'vertexMain',
          module: shader,
        },
      });
      created.push(pipeline);
      const triangleVertexBuffer = backend.createBuffer({
        label: 'phase-01-triangle-vertices',
        size: this.#triangle.vertices.byteLength,
        usage: ['copy-dst', 'vertex'],
      });
      created.push(triangleVertexBuffer);
      const sphereVertexBuffer = backend.createBuffer({
        label: 'phase-01-sphere-vertices',
        size: this.#sphere.vertices.byteLength,
        usage: ['copy-dst', 'vertex'],
      });
      created.push(sphereVertexBuffer);
      if (this.#sphere.indices === undefined) {
        throw new KyxosEngineError('Generated sphere geometry is missing its Index Buffer.', {
          code: 'INTERNAL_ERROR',
          module: 'renderer',
          recoverable: false,
        });
      }
      const indexBuffer = backend.createBuffer({
        label: 'phase-01-sphere-indices',
        size: this.#sphere.indices.byteLength,
        usage: ['copy-dst', 'index'],
      });
      created.push(indexBuffer);
      backend.writeBuffer(triangleVertexBuffer, this.#triangle.vertices);
      backend.writeBuffer(sphereVertexBuffer, this.#sphere.vertices);
      backend.writeBuffer(indexBuffer, this.#sphere.indices);

      this.#backend = backend;
      this.#resources = Object.freeze({
        indexBuffer,
        pipeline,
        shader,
        sphereVertexBuffer,
        surface,
        triangleVertexBuffer,
      });
    } catch (error) {
      const cleanupErrors = this.#destroyHandles(backend, created.reverse());
      if (cleanupErrors.length > 0) {
        throw new AggregateError(
          [error, ...cleanupErrors],
          'Basic geometry initialization failed.',
          { cause: error },
        );
      }
      throw error;
    }
  }

  render(context: RenderFeatureFrameContext): BackendRenderPassStatistics {
    this.#assertActive();
    const resources = this.#requireResources(context.backend);
    if (context.backend.getSurfaceInfo(resources.surface).size.suspended) {
      return EMPTY_STATISTICS;
    }

    const commandEncoder = context.backend.createCommandEncoder({
      label: `phase-01-frame-${context.frameIndex}`,
    });
    try {
      return context.backend.executeFrame({
        commandEncoder,
        renderPasses: [
          {
            clearColor: this.#clearColor,
            draws: [
              this.#primitive === 'triangle'
                ? {
                    pipeline: resources.pipeline,
                    vertexBuffers: [{ buffer: resources.triangleVertexBuffer, slot: 0 }],
                    vertexCount: this.#triangle.vertexCount,
                  }
                : {
                    indexBuffer: {
                      buffer: resources.indexBuffer,
                      format: 'uint16',
                      size: this.#sphere.indexCount * Uint16Array.BYTES_PER_ELEMENT,
                    },
                    indexCount: this.#sphere.indexCount,
                    pipeline: resources.pipeline,
                    vertexBuffers: [{ buffer: resources.sphereVertexBuffer, slot: 0 }],
                  },
            ],
            label: 'phase-01-basic-pass',
            surface: resources.surface,
          },
        ],
      });
    } catch (error) {
      context.backend.destroyResource(commandEncoder);
      throw error;
    }
  }

  setPrimitive(primitive: BasicGeometryPrimitive): void {
    this.#assertActive();
    this.#primitive = primitive;
  }

  setClearColor(clearColor: BackendClearColor): void {
    this.#assertActive();
    this.#clearColor = cloneClearColor(clearColor);
  }

  resize(resize: BackendSurfaceResize): BackendSurfaceInfo {
    this.#assertActive();
    Object.assign(this.#surfaceDescriptor, resize);
    const backend = this.#backend;
    const resources = this.#resources;
    if (backend === undefined || resources === undefined) {
      throw new KyxosEngineError('Basic geometry must be initialized before resizing.', {
        code: 'INVALID_STATE',
        module: 'renderer',
        recoverable: false,
      });
    }
    return backend.resizeSurface(resources.surface, resize);
  }

  onBackendLost(): void {
    this.#resources = undefined;
    this.#backend = undefined;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    const backend = this.#backend;
    const resources = this.#resources;
    this.#backend = undefined;
    this.#resources = undefined;
    if (backend === undefined || resources === undefined) return;
    const errors = this.#destroyHandles(backend, [
      resources.indexBuffer,
      resources.sphereVertexBuffer,
      resources.triangleVertexBuffer,
      resources.pipeline,
      resources.shader,
      resources.surface,
    ]);
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(errors, 'Basic geometry resource disposal failed.');
    }
  }

  #assertActive(): void {
    if (this.#disposed) {
      throw new KyxosEngineError('Basic geometry feature is disposed.', {
        code: 'ALREADY_DISPOSED',
        module: 'renderer',
        recoverable: false,
      });
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

  #requireResources(backend: GraphicsBackend): BasicGeometryResources {
    if (backend !== this.#backend || this.#resources === undefined) {
      throw new KyxosEngineError('Basic geometry resources are not initialized for this backend.', {
        code: 'INVALID_STATE',
        module: 'renderer',
        recoverable: true,
      });
    }
    return this.#resources;
  }
}
