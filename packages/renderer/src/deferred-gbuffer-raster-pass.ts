import type {
  BackendBindGroupHandle,
  BackendBufferHandle,
  BackendDrawCommand,
  BackendIndexFormat,
  BackendPipelineHandle,
  BackendRenderPassStatistics,
  BackendResourceHandle,
  BackendSamplerHandle,
  BackendShaderModuleHandle,
  BackendTextureHandle,
  GraphicsBackend,
} from '@kyxos/render-backend-api';
import { KyxosEngineError } from '@kyxos/render-core';
import type { Disposable, Unsubscribe } from '@kyxos/render-core';

import type { DeferredGBufferFrame } from './deferred-gbuffer.js';
import { PHASE_04_DEFERRED_GBUFFER_WGSL } from './generated/phase-04-deferred-gbuffer.wgsl.js';
import { PBR_OBJECT_UNIFORM_LAYOUT } from './pbr-gpu-layout.js';

const PBR_VERTEX_STRIDE = 12 * Float32Array.BYTES_PER_ELEMENT;
const GBUFFER_CLEAR = Object.freeze({ a: 0, b: 0, g: 0, r: 0 });
const NORMAL_ROUGHNESS_CLEAR = Object.freeze({ a: 1, b: 1, g: 0.5, r: 0.5 });
const EMISSIVE_OCCLUSION_CLEAR = Object.freeze({ a: 1, b: 0, g: 0, r: 0 });

export type DeferredGBufferRasterAlphaMode = 'mask' | 'opaque';

export interface DeferredGBufferRasterPassOptions {
  readonly ownerId: string;
}

export interface DeferredGBufferRasterTextureBinding {
  readonly sampler: BackendSamplerHandle;
  readonly texture: BackendTextureHandle;
}

export interface DeferredGBufferRasterDraw {
  readonly alphaMode?: DeferredGBufferRasterAlphaMode;
  /**
   * Increment when any Texture or Sampler binding changes. Uniform values and geometry may change
   * every frame without rebuilding the Bind Group.
   */
  readonly bindingGeneration: number;
  readonly baseColor: DeferredGBufferRasterTextureBinding;
  readonly doubleSided?: boolean;
  readonly emissive: DeferredGBufferRasterTextureBinding;
  readonly id: string;
  readonly indexBuffer?: BackendBufferHandle;
  readonly indexCount?: number;
  readonly indexFormat?: BackendIndexFormat;
  readonly instanceCount?: number;
  readonly metallicRoughness: DeferredGBufferRasterTextureBinding;
  readonly normal: DeferredGBufferRasterTextureBinding;
  readonly occlusion: DeferredGBufferRasterTextureBinding;
  /**
   * The canonical 576-byte PBR object layout. modelViewProjection must use current raster jitter;
   * current/previous motion matrices must be unjittered.
   */
  readonly uniforms: Float32Array;
  readonly vertexBuffer: BackendBufferHandle;
  readonly vertexCount?: number;
}

export interface DeferredGBufferRasterPassInput {
  readonly draws: readonly DeferredGBufferRasterDraw[];
  readonly frame: DeferredGBufferFrame;
}

export interface DeferredGBufferRasterExecutionResult {
  readonly frame: DeferredGBufferFrame;
  readonly statistics: BackendRenderPassStatistics;
}

export interface DeferredGBufferRasterPassDiagnostics {
  readonly activeObjectBindingCount: number;
  readonly executionCount: number;
  readonly ownerId: string;
  readonly pipelineCount: number;
  readonly state: 'detached' | 'disposed' | 'ready';
}

interface DeferredGBufferRasterPassResources {
  readonly pipelines: ReadonlyMap<string, BackendPipelineHandle>;
  readonly shader: BackendShaderModuleHandle;
}

interface DeferredGBufferRasterObjectResources {
  readonly bindGroup: BackendBindGroupHandle;
  readonly bindingGeneration: number;
  readonly pipeline: BackendPipelineHandle;
  readonly uniformBuffer: BackendBufferHandle;
}

function error(
  message: string,
  code: 'ALREADY_DISPOSED' | 'INVALID_ARGUMENT' | 'INVALID_STATE' | 'RESOURCE_CREATION_FAILED',
  recoverable = false,
): KyxosEngineError {
  return new KyxosEngineError(message, {
    code,
    module: 'renderer',
    recoverable,
  });
}

function validateOwnerId(value: string): string {
  const ownerId = value.trim();
  if (ownerId.length === 0) {
    throw error('Deferred GBuffer Raster ownerId must not be empty.', 'INVALID_ARGUMENT');
  }
  return ownerId;
}

function validateDrawId(value: string): string {
  const id = value.trim();
  if (id.length === 0) {
    throw error('Deferred GBuffer Raster draw id must not be empty.', 'INVALID_ARGUMENT');
  }
  return id;
}

function validatePositiveCount(name: string, value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw error(`${name} must be a positive safe integer.`, 'INVALID_ARGUMENT');
  }
  return value;
}

function validateBindingGeneration(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw error(
      'Deferred GBuffer Raster bindingGeneration must be a non-negative safe integer.',
      'INVALID_ARGUMENT',
    );
  }
  return value;
}

function pipelineKey(alphaMode: DeferredGBufferRasterAlphaMode, doubleSided: boolean): string {
  return `${alphaMode}:${doubleSided ? 'double' : 'single'}`;
}

function fragmentEntryPoint(alphaMode: DeferredGBufferRasterAlphaMode): string {
  return alphaMode === 'mask' ? 'fragmentMask' : 'fragmentOpaque';
}

/**
 * Independent geometry raster pass for the Deferred + TRAA path.
 *
 * The pass writes the caller-owned current GBuffer frame. Geometry buffers and material
 * Texture/Sampler handles remain caller-owned. This pass owns only its Shader, bounded Pipeline
 * variants, object Uniform buffers, and object Bind Groups.
 */
export class DeferredGBufferRasterPass implements Disposable {
  readonly #objectResources = new Map<string, DeferredGBufferRasterObjectResources>();
  readonly #ownerId: string;
  #backend: GraphicsBackend | undefined;
  #disposed = false;
  #executionCount = 0;
  #resources: DeferredGBufferRasterPassResources | undefined;
  #unsubscribeLost: Unsubscribe | undefined;

  constructor(options: DeferredGBufferRasterPassOptions) {
    this.#ownerId = validateOwnerId(options.ownerId);
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  async initialize(backend: GraphicsBackend): Promise<void> {
    this.#assertActive();
    if (backend.state !== 'ready') {
      throw error('Deferred GBuffer Raster requires a ready Backend.', 'INVALID_STATE');
    }
    if (backend === this.#backend && this.#resources !== undefined) return;
    if (this.#backend !== undefined) {
      throw error(
        'Deferred GBuffer Raster is already attached to another Backend.',
        'INVALID_STATE',
      );
    }

    const created: BackendResourceHandle[] = [];
    try {
      const shader = backend.createShaderModule({
        code: PHASE_04_DEFERRED_GBUFFER_WGSL,
        label: `deferred-gbuffer-raster-${this.#ownerId}-shader`,
        language: 'wgsl',
      });
      created.push(shader);
      const compilation = await backend.getShaderCompilationInfo(shader);
      if (!compilation.valid) {
        throw error(
          `Deferred GBuffer Raster Shader compilation failed: ${compilation.messages
            .map(({ message }) => message)
            .join('; ')}`,
          'RESOURCE_CREATION_FAILED',
          true,
        );
      }

      const pipelines = new Map<string, BackendPipelineHandle>();
      for (const alphaMode of ['opaque', 'mask'] as const) {
        for (const doubleSided of [false, true] as const) {
          const key = pipelineKey(alphaMode, doubleSided);
          const pipeline = await backend.createRenderPipeline({
            depthStencil: {
              depthCompare: 'less',
              depthWriteEnabled: true,
              format: 'depth32float',
            },
            fragment: {
              entryPoint: fragmentEntryPoint(alphaMode),
              module: shader,
              targets: [
                { format: 'rgba16float' },
                { format: 'rgba16float' },
                { format: 'rgba16float' },
                { format: 'rg16float' },
              ],
            },
            label: `deferred-gbuffer-raster-${this.#ownerId}-${alphaMode}-${
              doubleSided ? 'double' : 'single'
            }`,
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
          created.push(pipeline);
          pipelines.set(key, pipeline);
        }
      }

      this.#backend = backend;
      this.#resources = Object.freeze({ pipelines, shader });
      this.#unsubscribeLost = backend.on('lost', () => this.#onBackendLost(backend));
    } catch (cause) {
      const cleanupErrors = this.#destroyHandles(backend, created.reverse());
      if (cleanupErrors.length > 0) {
        throw new AggregateError(
          [cause, ...cleanupErrors],
          'Deferred GBuffer Raster initialization failed.',
          { cause },
        );
      }
      throw cause;
    }
  }

  execute(input: DeferredGBufferRasterPassInput): DeferredGBufferRasterExecutionResult {
    this.#assertActive();
    const backend = this.#backend;
    const resources = this.#resources;
    if (backend === undefined || backend.state !== 'ready' || resources === undefined) {
      throw error('Deferred GBuffer Raster resources are unavailable.', 'INVALID_STATE', true);
    }
    this.#validateFrame(input.frame);

    const activeIds = new Set<string>();
    const draws = input.draws.map((draw) => {
      const id = validateDrawId(draw.id);
      if (activeIds.has(id)) {
        throw error(`Deferred GBuffer Raster draw id "${id}" is duplicated.`, 'INVALID_ARGUMENT');
      }
      activeIds.add(id);
      return this.#prepareDraw(backend, resources, id, draw);
    });
    this.#reconcileObjectResources(backend, activeIds);

    const commandEncoder = backend.createCommandEncoder({
      label: `deferred-gbuffer-raster-${this.#ownerId}-${this.#executionCount + 1}`,
    });
    try {
      const statistics = backend.executeFrame({
        commandEncoder,
        renderPasses: [
          {
            clearColor: GBUFFER_CLEAR,
            colorAttachments: [
              {
                clearColor: GBUFFER_CLEAR,
                texture: input.frame.baseColorMetallicTexture,
              },
              {
                clearColor: NORMAL_ROUGHNESS_CLEAR,
                texture: input.frame.normalRoughnessTexture,
              },
              {
                clearColor: EMISSIVE_OCCLUSION_CLEAR,
                texture: input.frame.emissiveOcclusionTexture,
              },
              {
                clearColor: GBUFFER_CLEAR,
                texture: input.frame.velocityTexture,
              },
            ],
            depthAttachment: { clearValue: 1, texture: input.frame.depthTexture },
            draws,
            label: `deferred-gbuffer-raster-${this.#ownerId}-pass`,
          },
        ],
      });
      this.#executionCount += 1;
      return Object.freeze({ frame: input.frame, statistics });
    } catch (cause) {
      backend.destroyResource(commandEncoder);
      throw cause;
    }
  }

  getDiagnostics(): DeferredGBufferRasterPassDiagnostics {
    return Object.freeze({
      activeObjectBindingCount: this.#objectResources.size,
      executionCount: this.#executionCount,
      ownerId: this.#ownerId,
      pipelineCount: this.#resources?.pipelines.size ?? 0,
      state: this.#disposed ? 'disposed' : this.#resources === undefined ? 'detached' : 'ready',
    });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#unsubscribeLost?.();
    this.#unsubscribeLost = undefined;
    const backend = this.#backend;
    const resources = this.#resources;
    this.#backend = undefined;
    this.#resources = undefined;

    const handles: BackendResourceHandle[] = [];
    for (const object of this.#objectResources.values()) {
      handles.push(object.bindGroup, object.uniformBuffer);
    }
    this.#objectResources.clear();
    if (resources !== undefined) {
      handles.push(...resources.pipelines.values(), resources.shader);
    }

    const errors = backend === undefined ? [] : this.#destroyHandles(backend, handles);
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(errors, 'Deferred GBuffer Raster disposal failed.');
    }
  }

  #prepareDraw(
    backend: GraphicsBackend,
    resources: DeferredGBufferRasterPassResources,
    id: string,
    draw: DeferredGBufferRasterDraw,
  ): BackendDrawCommand {
    const alphaMode = draw.alphaMode ?? 'opaque';
    if (alphaMode !== 'mask' && alphaMode !== 'opaque') {
      throw error(
        'Deferred GBuffer Raster supports only opaque and mask draws.',
        'INVALID_ARGUMENT',
      );
    }
    const bindingGeneration = validateBindingGeneration(draw.bindingGeneration);
    if (draw.uniforms.byteLength !== PBR_OBJECT_UNIFORM_LAYOUT.byteLength) {
      throw error(
        `Deferred GBuffer Raster uniforms must be ${PBR_OBJECT_UNIFORM_LAYOUT.byteLength} bytes.`,
        'INVALID_ARGUMENT',
      );
    }

    const vertexCount = validatePositiveCount(
      'Deferred GBuffer Raster vertexCount',
      draw.vertexCount,
    );
    const indexCount = validatePositiveCount('Deferred GBuffer Raster indexCount', draw.indexCount);
    const instanceCount =
      validatePositiveCount('Deferred GBuffer Raster instanceCount', draw.instanceCount) ?? 1;
    const indexed =
      draw.indexBuffer !== undefined || draw.indexFormat !== undefined || indexCount !== undefined;
    if (indexed) {
      if (
        draw.indexBuffer === undefined ||
        draw.indexFormat === undefined ||
        indexCount === undefined
      ) {
        throw error(
          'Deferred GBuffer Raster indexed draws require indexBuffer, indexFormat, and indexCount.',
          'INVALID_ARGUMENT',
        );
      }
      if (vertexCount !== undefined) {
        throw error(
          'Deferred GBuffer Raster draws must use either vertexCount or indexed geometry.',
          'INVALID_ARGUMENT',
        );
      }
    } else if (vertexCount === undefined) {
      throw error(
        'Deferred GBuffer Raster non-indexed draws require vertexCount.',
        'INVALID_ARGUMENT',
      );
    }

    const key = pipelineKey(alphaMode, draw.doubleSided ?? false);
    const pipeline = resources.pipelines.get(key);
    if (pipeline === undefined) {
      throw error(`Deferred GBuffer Raster Pipeline "${key}" is unavailable.`, 'INVALID_STATE');
    }

    if (!(draw.uniforms instanceof Float32Array)) {
      throw error('Deferred GBuffer Raster uniforms must be a Float32Array.', 'INVALID_ARGUMENT');
    }

    let object = this.#objectResources.get(id);
    if (
      object === undefined ||
      object.bindingGeneration !== bindingGeneration ||
      object.pipeline !== pipeline
    ) {
      const created: BackendResourceHandle[] = [];
      let replacement: DeferredGBufferRasterObjectResources;
      try {
        const uniformBuffer = backend.createBuffer({
          label: `deferred-gbuffer-raster-${this.#ownerId}-${id}-uniform`,
          size: PBR_OBJECT_UNIFORM_LAYOUT.byteLength,
          usage: ['copy-dst', 'uniform'],
        });
        created.push(uniformBuffer);
        const bindGroup = backend.createBindGroup({
          entries: [
            { binding: 0, resource: { buffer: uniformBuffer } },
            { binding: 1, resource: { texture: draw.baseColor.texture } },
            { binding: 2, resource: { sampler: draw.baseColor.sampler } },
            { binding: 3, resource: { texture: draw.metallicRoughness.texture } },
            { binding: 4, resource: { sampler: draw.metallicRoughness.sampler } },
            { binding: 5, resource: { texture: draw.normal.texture } },
            { binding: 6, resource: { sampler: draw.normal.sampler } },
            { binding: 7, resource: { texture: draw.emissive.texture } },
            { binding: 8, resource: { sampler: draw.emissive.sampler } },
            { binding: 9, resource: { texture: draw.occlusion.texture } },
            { binding: 10, resource: { sampler: draw.occlusion.sampler } },
          ],
          group: 0,
          label: `deferred-gbuffer-raster-${this.#ownerId}-${id}-bindings`,
          pipeline,
        });
        created.push(bindGroup);
        replacement = Object.freeze({
          bindGroup,
          bindingGeneration,
          pipeline,
          uniformBuffer,
        });
      } catch (cause) {
        const cleanupErrors = this.#destroyHandles(backend, created.reverse());
        if (cleanupErrors.length > 0) {
          throw new AggregateError(
            [cause, ...cleanupErrors],
            `Deferred GBuffer Raster binding creation failed for "${id}".`,
            { cause },
          );
        }
        throw cause;
      }

      const previous = object;
      this.#objectResources.set(id, replacement);
      object = replacement;
      if (previous !== undefined) {
        const cleanupErrors = this.#destroyHandles(backend, [
          previous.bindGroup,
          previous.uniformBuffer,
        ]);
        if (cleanupErrors.length === 1) throw cleanupErrors[0];
        if (cleanupErrors.length > 1) {
          throw new AggregateError(
            cleanupErrors,
            `Deferred GBuffer Raster binding replacement failed for "${id}".`,
          );
        }
      }
    }

    backend.writeBuffer(object.uniformBuffer, draw.uniforms);
    return {
      bindGroups: [{ bindGroup: object.bindGroup, group: 0 }],
      ...(indexed
        ? {
            indexBuffer: {
              buffer: draw.indexBuffer as BackendBufferHandle,
              format: draw.indexFormat as BackendIndexFormat,
            },
            indexCount: indexCount as number,
          }
        : { vertexCount: vertexCount as number }),
      instanceCount,
      pipeline,
      vertexBuffers: [{ buffer: draw.vertexBuffer, slot: 0 }],
    };
  }

  #reconcileObjectResources(backend: GraphicsBackend, activeIds: ReadonlySet<string>): void {
    const errors: unknown[] = [];
    for (const [id, object] of this.#objectResources) {
      if (activeIds.has(id)) continue;
      this.#objectResources.delete(id);
      errors.push(...this.#destroyHandles(backend, [object.bindGroup, object.uniformBuffer]));
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(errors, 'Deferred GBuffer Raster stale-object cleanup failed.');
    }
  }

  #validateFrame(frame: DeferredGBufferFrame): void {
    if (frame.ownerId !== this.#ownerId) {
      throw error(
        `Deferred GBuffer Raster owner "${this.#ownerId}" cannot write frame "${frame.ownerId}".`,
        'INVALID_ARGUMENT',
      );
    }
    if (
      !Number.isSafeInteger(frame.resourceGeneration) ||
      frame.resourceGeneration < 1 ||
      !Number.isSafeInteger(frame.size.width) ||
      frame.size.width < 1 ||
      !Number.isSafeInteger(frame.size.height) ||
      frame.size.height < 1
    ) {
      throw error('Deferred GBuffer Raster frame metadata is invalid.', 'INVALID_ARGUMENT');
    }
  }

  #onBackendLost(backend: GraphicsBackend): void {
    if (backend !== this.#backend || this.#disposed) return;
    this.#unsubscribeLost?.();
    this.#unsubscribeLost = undefined;
    this.#backend = undefined;
    this.#resources = undefined;
    this.#objectResources.clear();
  }

  #destroyHandles(backend: GraphicsBackend, handles: readonly BackendResourceHandle[]): unknown[] {
    const errors: unknown[] = [];
    for (const handle of handles) {
      try {
        backend.destroyResource(handle);
      } catch (cause) {
        errors.push(cause);
      }
    }
    return errors;
  }

  #assertActive(): void {
    if (this.#disposed) {
      throw error('Deferred GBuffer Raster is disposed.', 'ALREADY_DISPOSED');
    }
  }
}
