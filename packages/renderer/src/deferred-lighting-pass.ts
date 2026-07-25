import type {
  BackendBindGroupHandle,
  BackendBufferHandle,
  BackendPipelineHandle,
  BackendRenderPassStatistics,
  BackendResourceHandle,
  BackendShaderModuleHandle,
  BackendTextureHandle,
  GraphicsBackend,
} from '@kyxos/render-backend-api';
import { KyxosEngineError } from '@kyxos/render-core';
import type { Disposable, Unsubscribe } from '@kyxos/render-core';
import type { Mat4, Vec3 } from '@kyxos/render-math';

import type { DeferredGBufferFrame, DeferredGBufferSize } from './deferred-gbuffer.js';
import { PHASE_04_DEFERRED_LIGHTING_WGSL } from './generated/phase-04-deferred-lighting.wgsl.js';

const FLOAT_BYTES = Float32Array.BYTES_PER_ELEMENT;
const HDR_BYTES_PER_TEXEL = 8;

export const DEFERRED_LIGHTING_UNIFORM_LAYOUT = Object.freeze({
  ambientIntensityOffset: 27 * FLOAT_BYTES,
  byteLength: 32 * FLOAT_BYTES,
  cameraPositionOffset: 16 * FLOAT_BYTES,
  inverseViewProjectionOffset: 0,
  lightColorOffset: 24 * FLOAT_BYTES,
  lightDirectionOffset: 20 * FLOAT_BYTES,
  lightIntensityOffset: 23 * FLOAT_BYTES,
  viewportSizeOffset: 28 * FLOAT_BYTES,
});

export interface DeferredLightingPassOptions {
  readonly height: number;
  readonly ownerId: string;
  readonly width: number;
}

export interface DeferredLightingParameters {
  readonly ambientIntensity: number;
  readonly cameraPosition: Vec3;
  readonly inverseViewProjection: Mat4;
  readonly lightColor: Vec3;
  readonly lightDirection: Vec3;
  readonly lightIntensity: number;
}

export interface DeferredLightingPassInput {
  readonly gbuffer: DeferredGBufferFrame;
  readonly parameters: DeferredLightingParameters;
}

export interface DeferredLightingFrame {
  readonly colorTexture: BackendTextureHandle;
  readonly ownerId: string;
  readonly resourceGeneration: number;
  readonly size: DeferredGBufferSize;
}

export interface DeferredLightingExecutionResult {
  readonly frame: DeferredLightingFrame;
  readonly statistics: BackendRenderPassStatistics;
}

export interface DeferredLightingPassDiagnostics {
  readonly activeBindGroupCount: number;
  readonly estimatedGpuBytes: number;
  readonly executionCount: number;
  readonly ownerId: string;
  readonly resourceGeneration: number;
  readonly size: DeferredGBufferSize;
  readonly state: 'detached' | 'disposed' | 'ready';
}

interface DeferredLightingPassResources {
  readonly colorTexture: BackendTextureHandle;
  readonly pipeline: BackendPipelineHandle;
  readonly shader: BackendShaderModuleHandle;
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

function validateExtent(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw error(`${name} must be a positive safe integer.`, 'INVALID_ARGUMENT');
  }
  return value;
}

function validateFinite(name: string, value: number): number {
  if (!Number.isFinite(value)) {
    throw error(`${name} must be finite.`, 'INVALID_ARGUMENT');
  }
  return value;
}

function validateNonNegative(name: string, value: number): number {
  const result = validateFinite(name, value);
  if (result < 0) {
    throw error(`${name} must be non-negative.`, 'INVALID_ARGUMENT');
  }
  return result;
}

function validateOwnerId(value: string): string {
  const ownerId = value.trim();
  if (ownerId.length === 0) {
    throw error('Deferred Lighting ownerId must not be empty.', 'INVALID_ARGUMENT');
  }
  return ownerId;
}

function validateVector(name: string, value: Vec3, requireDirection = false): Vec3 {
  value.forEach((component, index) => validateFinite(`${name}[${index}]`, component));
  if (requireDirection) {
    const squaredLength = value.reduce((sum, component) => sum + component * component, 0);
    if (squaredLength <= 0.000000000001) {
      throw error(`${name} must have non-zero length.`, 'INVALID_ARGUMENT');
    }
  }
  return value;
}

function validateMatrix(name: string, value: Mat4): Mat4 {
  value.forEach((component, index) => validateFinite(`${name}[${index}]`, component));
  return value;
}

export function packDeferredLightingUniforms(
  parameters: DeferredLightingParameters,
  size: DeferredGBufferSize,
): Float32Array {
  const inverseViewProjection = validateMatrix(
    'Deferred Lighting inverseViewProjection',
    parameters.inverseViewProjection,
  );
  const cameraPosition = validateVector(
    'Deferred Lighting cameraPosition',
    parameters.cameraPosition,
  );
  const lightDirection = validateVector(
    'Deferred Lighting lightDirection',
    parameters.lightDirection,
    true,
  );
  const lightColor = validateVector('Deferred Lighting lightColor', parameters.lightColor);
  if (lightColor.some((component) => component < 0)) {
    throw error(
      'Deferred Lighting lightColor components must be non-negative.',
      'INVALID_ARGUMENT',
    );
  }
  const lightIntensity = validateNonNegative(
    'Deferred Lighting lightIntensity',
    parameters.lightIntensity,
  );
  const ambientIntensity = validateNonNegative(
    'Deferred Lighting ambientIntensity',
    parameters.ambientIntensity,
  );
  const width = validateExtent('Deferred Lighting width', size.width);
  const height = validateExtent('Deferred Lighting height', size.height);

  const packed = new Float32Array(DEFERRED_LIGHTING_UNIFORM_LAYOUT.byteLength / FLOAT_BYTES);
  packed.set(
    inverseViewProjection,
    DEFERRED_LIGHTING_UNIFORM_LAYOUT.inverseViewProjectionOffset / FLOAT_BYTES,
  );
  packed.set(cameraPosition, DEFERRED_LIGHTING_UNIFORM_LAYOUT.cameraPositionOffset / FLOAT_BYTES);
  packed.set(lightDirection, DEFERRED_LIGHTING_UNIFORM_LAYOUT.lightDirectionOffset / FLOAT_BYTES);
  packed[DEFERRED_LIGHTING_UNIFORM_LAYOUT.lightIntensityOffset / FLOAT_BYTES] = lightIntensity;
  packed.set(lightColor, DEFERRED_LIGHTING_UNIFORM_LAYOUT.lightColorOffset / FLOAT_BYTES);
  packed[DEFERRED_LIGHTING_UNIFORM_LAYOUT.ambientIntensityOffset / FLOAT_BYTES] = ambientIntensity;
  packed.set(
    [width, height, 1 / width, 1 / height],
    DEFERRED_LIGHTING_UNIFORM_LAYOUT.viewportSizeOffset / FLOAT_BYTES,
  );
  return packed;
}

/**
 * Full-screen Deferred Lighting pass for the independent Deferred + TRAA path.
 *
 * The pass reads only the current GBuffer frame and writes one linear HDR color
 * target. It neither reads nor writes legacy Dynamic TAA or Static Accumulation
 * History and never owns a Canvas Surface.
 */
export class DeferredLightingPass implements Disposable {
  readonly #ownerId: string;
  #backend: GraphicsBackend | undefined;
  #bindGroup: BackendBindGroupHandle | undefined;
  #bindingKey = '';
  #disposed = false;
  #executionCount = 0;
  #height: number;
  #resourceGeneration = 0;
  #resources: DeferredLightingPassResources | undefined;
  #unsubscribeLost: Unsubscribe | undefined;
  #width: number;

  constructor(options: DeferredLightingPassOptions) {
    this.#ownerId = validateOwnerId(options.ownerId);
    this.#width = validateExtent('Deferred Lighting width', options.width);
    this.#height = validateExtent('Deferred Lighting height', options.height);
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  async initialize(backend: GraphicsBackend): Promise<void> {
    this.#assertActive();
    if (backend.state !== 'ready') {
      throw error('Deferred Lighting requires a ready Backend.', 'INVALID_STATE');
    }
    if (backend === this.#backend && this.#resources !== undefined) return;
    if (this.#backend !== undefined) {
      throw error('Deferred Lighting is already attached to another Backend.', 'INVALID_STATE');
    }

    const created: BackendResourceHandle[] = [];
    try {
      const shader = backend.createShaderModule({
        code: PHASE_04_DEFERRED_LIGHTING_WGSL,
        label: `deferred-lighting-${this.#ownerId}-shader`,
        language: 'wgsl',
      });
      created.push(shader);
      const compilation = await backend.getShaderCompilationInfo(shader);
      if (!compilation.valid) {
        throw error(
          `Deferred Lighting Shader compilation failed: ${compilation.messages
            .map(({ message }) => message)
            .join('; ')}`,
          'RESOURCE_CREATION_FAILED',
          true,
        );
      }
      const pipeline = await backend.createRenderPipeline({
        fragment: {
          entryPoint: 'fragmentMain',
          module: shader,
          targets: [{ format: 'rgba16float' }],
        },
        label: `deferred-lighting-${this.#ownerId}-pipeline`,
        primitive: { cullMode: 'none', topology: 'triangle-list' },
        vertex: { entryPoint: 'vertexMain', module: shader },
      });
      created.push(pipeline);
      const uniformBuffer = backend.createBuffer({
        label: `deferred-lighting-${this.#ownerId}-uniform`,
        size: DEFERRED_LIGHTING_UNIFORM_LAYOUT.byteLength,
        usage: ['copy-dst', 'uniform'],
      });
      created.push(uniformBuffer);
      const colorTexture = this.#createColorTexture(backend, this.#width, this.#height);
      created.push(colorTexture);

      this.#backend = backend;
      this.#resources = Object.freeze({ colorTexture, pipeline, shader, uniformBuffer });
      this.#resourceGeneration += 1;
      this.#unsubscribeLost = backend.on('lost', () => this.#onBackendLost(backend));
    } catch (cause) {
      const cleanupErrors = this.#destroyHandles(backend, created.reverse());
      if (cleanupErrors.length > 0) {
        throw new AggregateError(
          [cause, ...cleanupErrors],
          'Deferred Lighting initialization failed.',
          { cause },
        );
      }
      throw cause;
    }
  }

  execute(input: DeferredLightingPassInput): DeferredLightingExecutionResult {
    this.#assertActive();
    const backend = this.#backend;
    const resources = this.#resources;
    if (backend === undefined || backend.state !== 'ready' || resources === undefined) {
      throw error('Deferred Lighting resources are unavailable.', 'INVALID_STATE', true);
    }
    this.#validateGBuffer(input.gbuffer);

    backend.writeBuffer(
      resources.uniformBuffer,
      packDeferredLightingUniforms(input.parameters, input.gbuffer.size),
    );
    const bindGroup = this.#resolveBindGroup(backend, resources, input.gbuffer);
    const commandEncoder = backend.createCommandEncoder({
      label: `deferred-lighting-${this.#ownerId}-${this.#executionCount + 1}`,
    });
    try {
      const statistics = backend.executeFrame({
        commandEncoder,
        renderPasses: [
          {
            clearColor: { a: 1, b: 0, g: 0, r: 0 },
            colorAttachments: [{ texture: resources.colorTexture }],
            draws: [
              {
                bindGroups: [{ bindGroup, group: 0 }],
                pipeline: resources.pipeline,
                vertexCount: 3,
              },
            ],
            label: `deferred-lighting-${this.#ownerId}-pass`,
          },
        ],
      });
      this.#executionCount += 1;
      return Object.freeze({ frame: this.#frame(resources), statistics });
    } catch (cause) {
      backend.destroyResource(commandEncoder);
      throw cause;
    }
  }

  resize(width: number, height: number): DeferredLightingPassDiagnostics {
    this.#assertActive();
    const nextWidth = validateExtent('Deferred Lighting width', width);
    const nextHeight = validateExtent('Deferred Lighting height', height);
    if (nextWidth === this.#width && nextHeight === this.#height) return this.getDiagnostics();

    const backend = this.#backend;
    const resources = this.#resources;
    let replacement: BackendTextureHandle | undefined;
    if (backend !== undefined) {
      if (backend.state !== 'ready' || resources === undefined) {
        throw error('Deferred Lighting Backend is not ready.', 'INVALID_STATE', true);
      }
      replacement = this.#createColorTexture(backend, nextWidth, nextHeight);
    }

    const previousBindGroup = this.#bindGroup;
    const previousColor = resources?.colorTexture;
    this.#width = nextWidth;
    this.#height = nextHeight;
    this.#bindGroup = undefined;
    this.#bindingKey = '';
    if (resources !== undefined && replacement !== undefined) {
      this.#resources = Object.freeze({ ...resources, colorTexture: replacement });
      this.#resourceGeneration += 1;
    }

    if (backend !== undefined) {
      const cleanupHandles: BackendResourceHandle[] = [];
      if (previousBindGroup !== undefined) cleanupHandles.push(previousBindGroup);
      if (previousColor !== undefined) cleanupHandles.push(previousColor);
      const cleanupErrors = this.#destroyHandles(backend, cleanupHandles);
      if (cleanupErrors.length === 1) throw cleanupErrors[0];
      if (cleanupErrors.length > 1) {
        throw new AggregateError(cleanupErrors, 'Deferred Lighting Resize cleanup failed.');
      }
    }
    return this.getDiagnostics();
  }

  getDiagnostics(): DeferredLightingPassDiagnostics {
    return Object.freeze({
      activeBindGroupCount: this.#bindGroup === undefined ? 0 : 1,
      estimatedGpuBytes: this.#width * this.#height * HDR_BYTES_PER_TEXEL,
      executionCount: this.#executionCount,
      ownerId: this.#ownerId,
      resourceGeneration: this.#resourceGeneration,
      size: this.#size(),
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
    const bindGroup = this.#bindGroup;
    this.#backend = undefined;
    this.#resources = undefined;
    this.#bindGroup = undefined;
    this.#bindingKey = '';

    const errors =
      backend === undefined || resources === undefined
        ? []
        : this.#destroyHandles(backend, [
            ...(bindGroup === undefined ? [] : [bindGroup]),
            resources.colorTexture,
            resources.uniformBuffer,
            resources.pipeline,
            resources.shader,
          ]);
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(errors, 'Deferred Lighting disposal failed.');
    }
  }

  #createColorTexture(
    backend: GraphicsBackend,
    width: number,
    height: number,
  ): BackendTextureHandle {
    return backend.createTexture({
      format: 'rgba16float',
      label: `deferred-lighting-${this.#ownerId}-linear-hdr`,
      size: { height, width },
      usage: ['render-attachment', 'sampled'],
    });
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

  #frame(resources: DeferredLightingPassResources): DeferredLightingFrame {
    return Object.freeze({
      colorTexture: resources.colorTexture,
      ownerId: this.#ownerId,
      resourceGeneration: this.#resourceGeneration,
      size: this.#size(),
    });
  }

  #onBackendLost(backend: GraphicsBackend): void {
    if (backend !== this.#backend || this.#disposed) return;
    this.#unsubscribeLost?.();
    this.#unsubscribeLost = undefined;
    this.#backend = undefined;
    this.#resources = undefined;
    this.#bindGroup = undefined;
    this.#bindingKey = '';
  }

  #resolveBindGroup(
    backend: GraphicsBackend,
    resources: DeferredLightingPassResources,
    gbuffer: DeferredGBufferFrame,
  ): BackendBindGroupHandle {
    const key = [
      gbuffer.resourceGeneration,
      gbuffer.baseColorMetallicTexture.id,
      gbuffer.normalRoughnessTexture.id,
      gbuffer.emissiveOcclusionTexture.id,
      gbuffer.depthTexture.id,
    ].join(':');
    if (this.#bindGroup !== undefined && this.#bindingKey === key) return this.#bindGroup;

    if (this.#bindGroup !== undefined) {
      backend.destroyResource(this.#bindGroup);
    }
    this.#bindGroup = backend.createBindGroup({
      entries: [
        { binding: 0, resource: { buffer: resources.uniformBuffer } },
        { binding: 1, resource: { texture: gbuffer.baseColorMetallicTexture } },
        { binding: 2, resource: { texture: gbuffer.normalRoughnessTexture } },
        { binding: 3, resource: { texture: gbuffer.emissiveOcclusionTexture } },
        { binding: 4, resource: { texture: gbuffer.depthTexture } },
      ],
      group: 0,
      label: `deferred-lighting-${this.#ownerId}-bindings`,
      pipeline: resources.pipeline,
    });
    this.#bindingKey = key;
    return this.#bindGroup;
  }

  #size(): DeferredGBufferSize {
    return Object.freeze({ height: this.#height, width: this.#width });
  }

  #validateGBuffer(gbuffer: DeferredGBufferFrame): void {
    if (gbuffer.ownerId !== this.#ownerId) {
      throw error('Deferred Lighting GBuffer belongs to another owner.', 'INVALID_ARGUMENT');
    }
    if (gbuffer.size.width !== this.#width || gbuffer.size.height !== this.#height) {
      throw error(
        'Deferred Lighting GBuffer extent does not match the HDR target.',
        'INVALID_ARGUMENT',
      );
    }
  }

  #assertActive(): void {
    if (this.#disposed) {
      throw error('Deferred Lighting is disposed.', 'ALREADY_DISPOSED');
    }
  }
}
