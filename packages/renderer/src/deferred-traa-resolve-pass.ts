import type {
  BackendBindGroupHandle,
  BackendBufferHandle,
  BackendPipelineHandle,
  BackendRenderPassStatistics,
  BackendResourceHandle,
  BackendShaderModuleHandle,
  GraphicsBackend,
} from '@kyxos/render-backend-api';
import { KyxosEngineError } from '@kyxos/render-core';
import type { Disposable, Unsubscribe } from '@kyxos/render-core';
import type { Mat4 } from '@kyxos/render-math';
import type { TemporalVec2 } from '@kyxos/render-temporal';

import type { DeferredGBufferFrame } from './deferred-gbuffer.js';
import type { DeferredLightingFrame } from './deferred-lighting-pass.js';
import type { DeferredTraaHistoryFrame } from './deferred-traa-history.js';
import { PHASE_04_DEFERRED_TRAA_RESOLVE_WGSL } from './generated/phase-04-deferred-traa-resolve.wgsl.js';

const FLOAT_BYTES = Float32Array.BYTES_PER_ELEMENT;
const MATRIX_FLOATS = 16;

export const DEFERRED_TRAA_RESOLVE_UNIFORM_LAYOUT = Object.freeze({
  byteLength: 52 * FLOAT_BYTES,
  currentRasterInverseViewProjectionOffset: 0,
  previousRasterViewProjectionOffset: 16 * FLOAT_BYTES,
  viewportHistoryResponsiveOffset: 32 * FLOAT_BYTES,
  jitterOffsetsOffset: 36 * FLOAT_BYTES,
  options0Offset: 40 * FLOAT_BYTES,
  options1Offset: 44 * FLOAT_BYTES,
  options2Offset: 48 * FLOAT_BYTES,
});

export interface DeferredTraaResolveSettings {
  readonly baseHistoryWeight: number;
  readonly depthAbsoluteThreshold: number;
  readonly depthRelativeThreshold: number;
  readonly edgeDepthDifference: number;
  readonly flickerReduction: number;
  readonly maxVelocityLength: number;
  readonly minimumCurrentWeight: number;
  readonly responsiveHistoryReduction: number;
  readonly subpixelCorrection: number;
  readonly varianceClipGamma: number;
}

export const DEFERRED_TRAA_DEFAULT_SETTINGS: DeferredTraaResolveSettings = Object.freeze({
  baseHistoryWeight: 0.9,
  depthAbsoluteThreshold: 0.001,
  depthRelativeThreshold: 0.01,
  edgeDepthDifference: 0.001,
  flickerReduction: 0.25,
  maxVelocityLength: 128,
  minimumCurrentWeight: 0.05,
  responsiveHistoryReduction: 0.8,
  subpixelCorrection: 0.25,
  varianceClipGamma: 1,
});

export interface DeferredTraaResolvePassOptions {
  readonly ownerId: string;
}

export interface DeferredTraaResolvePassInput {
  readonly currentColor: DeferredLightingFrame;
  readonly currentGBuffer: DeferredGBufferFrame;
  readonly currentJitterNdcOffset?: TemporalVec2;
  /** Inverse of the current jittered raster View-Projection. */
  readonly currentRasterInverseViewProjection: Mat4;
  readonly history: DeferredTraaHistoryFrame;
  readonly options?: Partial<DeferredTraaResolveSettings>;
  readonly previousJitterNdcOffset?: TemporalVec2;
  /** Previous jittered raster View-Projection used only for depth disocclusion validation. */
  readonly previousRasterViewProjection: Mat4;
  readonly responsiveMask?: number;
}

export interface DeferredTraaResolveExecutionResult {
  readonly historyFrame: DeferredTraaHistoryFrame;
  readonly statistics: BackendRenderPassStatistics;
}

export interface DeferredTraaResolvePassDiagnostics {
  readonly activeBindGroupCount: number;
  readonly executionCount: number;
  readonly ownerId: string;
  readonly resourceGeneration: number;
  readonly state: 'detached' | 'disposed' | 'ready';
}

interface DeferredTraaResolveResources {
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

function validateOwnerId(value: string): string {
  const ownerId = value.trim();
  if (ownerId.length === 0) {
    throw error('Deferred TRAA Resolve ownerId must not be empty.', 'INVALID_ARGUMENT');
  }
  return ownerId;
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw error(`${label} must be finite.`, 'INVALID_ARGUMENT');
  }
  return value;
}

function unit(value: number, label: string): number {
  const result = finite(value, label);
  if (result < 0 || result > 1) {
    throw error(`${label} must be from 0 through 1.`, 'INVALID_ARGUMENT');
  }
  return result;
}

function nonNegative(value: number, label: string): number {
  const result = finite(value, label);
  if (result < 0) {
    throw error(`${label} must be non-negative.`, 'INVALID_ARGUMENT');
  }
  return result;
}

function positive(value: number, label: string): number {
  const result = finite(value, label);
  if (result <= 0) {
    throw error(`${label} must be greater than zero.`, 'INVALID_ARGUMENT');
  }
  return result;
}

export function createDeferredTraaResolveSettings(
  descriptor: Partial<DeferredTraaResolveSettings> = {},
  base: DeferredTraaResolveSettings = DEFERRED_TRAA_DEFAULT_SETTINGS,
): DeferredTraaResolveSettings {
  return Object.freeze({
    baseHistoryWeight: unit(
      descriptor.baseHistoryWeight ?? base.baseHistoryWeight,
      'Deferred TRAA base History weight',
    ),
    depthAbsoluteThreshold: unit(
      descriptor.depthAbsoluteThreshold ?? base.depthAbsoluteThreshold,
      'Deferred TRAA absolute Depth threshold',
    ),
    depthRelativeThreshold: unit(
      descriptor.depthRelativeThreshold ?? base.depthRelativeThreshold,
      'Deferred TRAA relative Depth threshold',
    ),
    edgeDepthDifference: unit(
      descriptor.edgeDepthDifference ?? base.edgeDepthDifference,
      'Deferred TRAA edge Depth difference',
    ),
    flickerReduction: unit(
      descriptor.flickerReduction ?? base.flickerReduction,
      'Deferred TRAA flicker reduction',
    ),
    maxVelocityLength: positive(
      descriptor.maxVelocityLength ?? base.maxVelocityLength,
      'Deferred TRAA maximum Velocity length',
    ),
    minimumCurrentWeight: unit(
      descriptor.minimumCurrentWeight ?? base.minimumCurrentWeight,
      'Deferred TRAA minimum current weight',
    ),
    responsiveHistoryReduction: unit(
      descriptor.responsiveHistoryReduction ?? base.responsiveHistoryReduction,
      'Deferred TRAA responsive History reduction',
    ),
    subpixelCorrection: unit(
      descriptor.subpixelCorrection ?? base.subpixelCorrection,
      'Deferred TRAA subpixel correction',
    ),
    varianceClipGamma: nonNegative(
      descriptor.varianceClipGamma ?? base.varianceClipGamma,
      'Deferred TRAA variance clip gamma',
    ),
  });
}

function copyMatrix(target: Float32Array, offset: number, matrix: Mat4, label: string): void {
  if (matrix.length !== MATRIX_FLOATS) {
    throw error(`${label} must contain 16 values.`, 'INVALID_ARGUMENT');
  }
  for (let index = 0; index < MATRIX_FLOATS; index += 1) {
    target[offset + index] = finite(matrix[index] as number, `${label}[${index}]`);
  }
}

function copyVector2(
  target: Float32Array,
  offset: number,
  vector: TemporalVec2 | undefined,
  label: string,
): void {
  const resolved = vector ?? ([0, 0] as const);
  target[offset] = finite(resolved[0], `${label}[0]`);
  target[offset + 1] = finite(resolved[1], `${label}[1]`);
}

function validateSize(width: number, height: number, label: string): void {
  if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1) {
    throw error(`${label} size must use positive safe integers.`, 'INVALID_ARGUMENT');
  }
}

export function packDeferredTraaResolveUniforms(input: DeferredTraaResolvePassInput): Float32Array {
  const { history } = input;
  validateSize(history.size.width, history.size.height, 'Deferred TRAA History');
  const responsiveMask = unit(input.responsiveMask ?? 0, 'Deferred TRAA responsive mask');
  const options = createDeferredTraaResolveSettings(input.options);
  const values = new Float32Array(DEFERRED_TRAA_RESOLVE_UNIFORM_LAYOUT.byteLength / FLOAT_BYTES);
  copyMatrix(
    values,
    0,
    input.currentRasterInverseViewProjection,
    'Current raster inverse View-Projection',
  );
  copyMatrix(values, 16, input.previousRasterViewProjection, 'Previous raster View-Projection');
  values[32] = history.size.width;
  values[33] = history.size.height;
  values[34] = history.historyValid ? 1 : 0;
  values[35] = responsiveMask;
  copyVector2(values, 36, input.currentJitterNdcOffset, 'Current jitter NDC');
  copyVector2(values, 38, input.previousJitterNdcOffset, 'Previous jitter NDC');
  values[40] = options.baseHistoryWeight;
  values[41] = options.depthAbsoluteThreshold;
  values[42] = options.depthRelativeThreshold;
  values[43] = options.minimumCurrentWeight;
  values[44] = options.edgeDepthDifference;
  values[45] = options.maxVelocityLength;
  values[46] = options.varianceClipGamma;
  values[47] = options.flickerReduction;
  values[48] = options.responsiveHistoryReduction;
  values[49] = options.subpixelCorrection;
  return values;
}

/**
 * Independent TRAA resolve for the Deferred path.
 *
 * The pass samples current Deferred Lighting plus current GBuffer Velocity/Depth and writes only the
 * caller-prepared independent History Color/Depth targets. It never commits or cancels History and
 * imports no legacy Dynamic TAA or Static Accumulation owner.
 */
export class DeferredTraaResolvePass implements Disposable {
  readonly #bindGroups = new Map<string, BackendBindGroupHandle>();
  readonly #ownerId: string;
  #backend: GraphicsBackend | undefined;
  #bindingResourceKey = '';
  #disposed = false;
  #executionCount = 0;
  #resourceGeneration = 0;
  #resources: DeferredTraaResolveResources | undefined;
  #unsubscribeLost: Unsubscribe | undefined;

  constructor(options: DeferredTraaResolvePassOptions) {
    this.#ownerId = validateOwnerId(options.ownerId);
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  async initialize(backend: GraphicsBackend): Promise<void> {
    this.#assertActive();
    if (backend.state !== 'ready') {
      throw error('Deferred TRAA Resolve requires a ready Backend.', 'INVALID_STATE');
    }
    if (backend === this.#backend && this.#resources !== undefined) return;
    if (this.#backend !== undefined) {
      throw error('Deferred TRAA Resolve is attached to another Backend.', 'INVALID_STATE');
    }

    const created: BackendResourceHandle[] = [];
    try {
      const shader = backend.createShaderModule({
        code: PHASE_04_DEFERRED_TRAA_RESOLVE_WGSL,
        label: `deferred-traa-resolve-${this.#ownerId}-shader`,
        language: 'wgsl',
      });
      created.push(shader);
      const compilation = await backend.getShaderCompilationInfo(shader);
      if (!compilation.valid) {
        throw error(
          `Deferred TRAA Resolve Shader compilation failed: ${compilation.messages
            .map(({ message }) => message)
            .join('; ')}`,
          'RESOURCE_CREATION_FAILED',
          true,
        );
      }
      const pipeline = await backend.createRenderPipeline({
        depthStencil: {
          depthCompare: 'always',
          depthWriteEnabled: true,
          format: 'depth32float',
        },
        fragment: {
          entryPoint: 'fragmentMain',
          module: shader,
          targets: [{ format: 'rgba16float' }],
        },
        label: `deferred-traa-resolve-${this.#ownerId}-pipeline`,
        primitive: { cullMode: 'none', topology: 'triangle-list' },
        vertex: { entryPoint: 'vertexMain', module: shader },
      });
      created.push(pipeline);
      const uniformBuffer = backend.createBuffer({
        label: `deferred-traa-resolve-${this.#ownerId}-uniform`,
        size: DEFERRED_TRAA_RESOLVE_UNIFORM_LAYOUT.byteLength,
        usage: ['copy-dst', 'uniform'],
      });
      created.push(uniformBuffer);
      this.#backend = backend;
      this.#resources = Object.freeze({ pipeline, shader, uniformBuffer });
      this.#resourceGeneration += 1;
      this.#unsubscribeLost = backend.on('lost', () => this.#onBackendLost(backend));
    } catch (cause) {
      const cleanupErrors = this.#destroyHandles(backend, created.reverse());
      if (cleanupErrors.length > 0) {
        throw new AggregateError(
          [cause, ...cleanupErrors],
          'Deferred TRAA Resolve initialization failed.',
          { cause },
        );
      }
      throw cause;
    }
  }

  execute(input: DeferredTraaResolvePassInput): DeferredTraaResolveExecutionResult {
    this.#assertActive();
    const backend = this.#backend;
    const resources = this.#resources;
    if (backend === undefined || backend.state !== 'ready' || resources === undefined) {
      throw error('Deferred TRAA Resolve resources are unavailable.', 'INVALID_STATE', true);
    }
    this.#validateInput(input);
    backend.writeBuffer(resources.uniformBuffer, packDeferredTraaResolveUniforms(input));
    const bindGroup = this.#resolveBindGroup(backend, resources, input);
    const commandEncoder = backend.createCommandEncoder({
      label: `deferred-traa-resolve-${this.#ownerId}-${this.#executionCount + 1}`,
    });
    try {
      const statistics = backend.executeFrame({
        commandEncoder,
        renderPasses: [
          {
            clearColor: { a: 0, b: 0, g: 0, r: 0 },
            colorAttachments: [{ texture: input.history.writeColorTexture }],
            depthAttachment: { clearValue: 1, texture: input.history.writeDepthTexture },
            draws: [
              {
                bindGroups: [{ bindGroup, group: 0 }],
                pipeline: resources.pipeline,
                vertexCount: 3,
              },
            ],
            label: `deferred-traa-resolve-${this.#ownerId}-pass`,
          },
        ],
      });
      this.#executionCount += 1;
      return Object.freeze({ historyFrame: input.history, statistics });
    } catch (cause) {
      backend.destroyResource(commandEncoder);
      throw cause;
    }
  }

  getDiagnostics(): DeferredTraaResolvePassDiagnostics {
    return Object.freeze({
      activeBindGroupCount: this.#bindGroups.size,
      executionCount: this.#executionCount,
      ownerId: this.#ownerId,
      resourceGeneration: this.#resourceGeneration,
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
    const handles: BackendResourceHandle[] = [...this.#bindGroups.values()];
    this.#bindGroups.clear();
    this.#bindingResourceKey = '';
    if (resources !== undefined) {
      handles.push(resources.uniformBuffer, resources.pipeline, resources.shader);
    }
    const cleanupErrors = backend === undefined ? [] : this.#destroyHandles(backend, handles);
    if (cleanupErrors.length === 1) throw cleanupErrors[0];
    if (cleanupErrors.length > 1) {
      throw new AggregateError(cleanupErrors, 'Deferred TRAA Resolve disposal failed.');
    }
  }

  #validateInput(input: DeferredTraaResolvePassInput): void {
    for (const [label, ownerId] of [
      ['current GBuffer', input.currentGBuffer.ownerId],
      ['current Deferred Lighting', input.currentColor.ownerId],
      ['History', input.history.ownerId],
    ] as const) {
      if (ownerId !== this.#ownerId) {
        throw error(`Deferred TRAA Resolve ${label} belongs to another owner.`, 'INVALID_ARGUMENT');
      }
    }
    const { width, height } = input.history.size;
    validateSize(width, height, 'Deferred TRAA Resolve');
    for (const [label, size] of [
      ['current GBuffer', input.currentGBuffer.size],
      ['current Deferred Lighting', input.currentColor.size],
    ] as const) {
      if (size.width !== width || size.height !== height) {
        throw error(
          `Deferred TRAA Resolve ${label} extent ${size.width}x${size.height} does not match History ${width}x${height}.`,
          'INVALID_ARGUMENT',
        );
      }
    }
  }

  #resolveBindGroup(
    backend: GraphicsBackend,
    resources: DeferredTraaResolveResources,
    input: DeferredTraaResolvePassInput,
  ): BackendBindGroupHandle {
    const resourceKey = [
      input.currentGBuffer.resourceGeneration,
      input.currentColor.resourceGeneration,
      input.history.resourceGeneration,
    ].join(':');
    if (resourceKey !== this.#bindingResourceKey) {
      const cleanupErrors = this.#destroyHandles(backend, [...this.#bindGroups.values()]);
      this.#bindGroups.clear();
      this.#bindingResourceKey = resourceKey;
      if (cleanupErrors.length === 1) throw cleanupErrors[0];
      if (cleanupErrors.length > 1) {
        throw new AggregateError(cleanupErrors, 'Deferred TRAA Resolve Bind Group cleanup failed.');
      }
    }
    const key = [
      input.currentColor.colorTexture.id,
      input.currentGBuffer.depthTexture.id,
      input.currentGBuffer.velocityTexture.id,
      input.history.readColorTexture.id,
      input.history.readDepthTexture.id,
      input.history.sampler.id,
    ].join(':');
    const existing = this.#bindGroups.get(key);
    if (existing !== undefined) return existing;
    const bindGroup = backend.createBindGroup({
      entries: [
        { binding: 0, resource: { buffer: resources.uniformBuffer } },
        { binding: 1, resource: { texture: input.currentColor.colorTexture } },
        { binding: 2, resource: { texture: input.currentGBuffer.depthTexture } },
        { binding: 3, resource: { texture: input.currentGBuffer.velocityTexture } },
        { binding: 4, resource: { texture: input.history.readColorTexture } },
        { binding: 5, resource: { texture: input.history.readDepthTexture } },
        { binding: 6, resource: { sampler: input.history.sampler } },
      ],
      group: 0,
      label: `deferred-traa-resolve-${this.#ownerId}-bindings`,
      pipeline: resources.pipeline,
    });
    this.#bindGroups.set(key, bindGroup);
    return bindGroup;
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

  #onBackendLost(backend: GraphicsBackend): void {
    if (backend !== this.#backend || this.#disposed) return;
    this.#unsubscribeLost?.();
    this.#unsubscribeLost = undefined;
    this.#backend = undefined;
    this.#resources = undefined;
    this.#bindGroups.clear();
    this.#bindingResourceKey = '';
  }

  #assertActive(): void {
    if (this.#disposed) {
      throw error('Deferred TRAA Resolve is disposed.', 'ALREADY_DISPOSED');
    }
  }
}
