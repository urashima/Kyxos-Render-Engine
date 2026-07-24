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

import type { DynamicTaaGpuFrame } from './dynamic-taa-gpu-history.js';
import { createTemporalTaaSettings } from './temporal-taa-settings.js';
import type { TemporalTaaResolveSettings } from './temporal-taa-settings.js';
import { PHASE_04_TAA_RESOLVE_WGSL } from './generated/phase-04-taa-resolve.wgsl.js';

const FLOAT_BYTES = Float32Array.BYTES_PER_ELEMENT;
const MATRIX_FLOATS = 16;

export const DYNAMIC_TAA_RESOLVE_UNIFORM_LAYOUT = Object.freeze({
  byteLength: 84 * FLOAT_BYTES,
  currentInverseViewProjectionOffset: 0,
  previousViewProjectionOffset: 16 * FLOAT_BYTES,
  currentViewProjectionOffset: 32 * FLOAT_BYTES,
  previousInverseViewProjectionOffset: 48 * FLOAT_BYTES,
  viewportHistoryResponsiveOffset: 64 * FLOAT_BYTES,
  jitterOffsetsOffset: 68 * FLOAT_BYTES,
  options0Offset: 72 * FLOAT_BYTES,
  options1Offset: 76 * FLOAT_BYTES,
  options2Offset: 80 * FLOAT_BYTES,
});

export interface DynamicTaaResolvePassOptions {
  readonly ownerId: string;
}

export interface DynamicTaaResolvePassInput {
  readonly currentInverseViewProjection: Mat4;
  readonly currentJitterNdcOffset?: TemporalVec2;
  readonly currentViewProjection: Mat4;
  readonly frame: DynamicTaaGpuFrame;
  readonly options?: Partial<TemporalTaaResolveSettings>;
  readonly previousInverseViewProjection: Mat4;
  readonly previousJitterNdcOffset?: TemporalVec2;
  readonly previousViewProjection: Mat4;
  readonly responsiveMask?: number;
}

export interface DynamicTaaResolvePassDiagnostics {
  readonly activeBindGroupCount: number;
  readonly executionCount: number;
  readonly ownerId: string;
  readonly resourceGeneration: number;
  readonly state: 'detached' | 'disposed' | 'ready';
}

interface DynamicTaaResolveResources {
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

function validateOwnerId(ownerId: string): string {
  const normalized = ownerId.trim();
  if (normalized.length === 0) {
    throw error('Dynamic TAA Resolve ownerId must not be empty.', 'INVALID_ARGUMENT');
  }
  return normalized;
}

function validateResponsiveMask(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw error(
      'Dynamic TAA responsive mask must be finite and from 0 through 1.',
      'INVALID_ARGUMENT',
    );
  }
  return value;
}

function copyVector2(
  target: Float32Array,
  offset: number,
  vector: TemporalVec2 | undefined,
  label: string,
): void {
  const resolved = vector ?? ([0, 0] as const);
  for (let index = 0; index < 2; index += 1) {
    const value = resolved[index] as number;
    if (!Number.isFinite(value)) {
      throw error(`${label}[${index}] must be finite.`, 'INVALID_ARGUMENT');
    }
    target[offset + index] = value;
  }
}

function copyMatrix(target: Float32Array, offset: number, matrix: Mat4, label: string): void {
  if (matrix.length !== MATRIX_FLOATS) {
    throw error(`${label} must contain 16 values.`, 'INVALID_ARGUMENT');
  }
  for (let index = 0; index < MATRIX_FLOATS; index += 1) {
    const value = matrix[index] as number;
    if (!Number.isFinite(value)) {
      throw error(`${label}[${index}] must be finite.`, 'INVALID_ARGUMENT');
    }
    target[offset + index] = value;
  }
}

export function packDynamicTaaResolveUniforms(input: DynamicTaaResolvePassInput): Float32Array {
  const responsiveMask = validateResponsiveMask(input.responsiveMask ?? 0);
  const options = createTemporalTaaSettings(input.options).resolve;
  const { frame } = input;
  if (
    !Number.isSafeInteger(frame.size.width) ||
    frame.size.width < 1 ||
    !Number.isSafeInteger(frame.size.height) ||
    frame.size.height < 1
  ) {
    throw error('Dynamic TAA Resolve frame size is invalid.', 'INVALID_ARGUMENT');
  }
  const values = new Float32Array(DYNAMIC_TAA_RESOLVE_UNIFORM_LAYOUT.byteLength / FLOAT_BYTES);
  copyMatrix(values, 0, input.currentInverseViewProjection, 'Current inverse View-Projection');
  copyMatrix(values, 16, input.previousViewProjection, 'Previous View-Projection');
  copyMatrix(values, 32, input.currentViewProjection, 'Current View-Projection');
  copyMatrix(values, 48, input.previousInverseViewProjection, 'Previous inverse View-Projection');
  values[64] = frame.size.width;
  values[65] = frame.size.height;
  values[66] = frame.historyValid ? 1 : 0;
  values[67] = responsiveMask;
  copyVector2(values, 68, input.currentJitterNdcOffset, 'Current jitter NDC');
  copyVector2(values, 70, input.previousJitterNdcOffset, 'Previous jitter NDC');
  values[72] = options.baseHistoryWeight;
  values[73] = options.depthAbsoluteThreshold;
  values[74] = options.depthRelativeThreshold;
  values[75] = options.normalRejectionCosine;
  values[76] = options.responsiveHistoryReduction;
  values[77] = options.edgeDepthDifference;
  values[78] = options.maxVelocityLength;
  values[79] = options.minimumCurrentWeight;
  values[80] = options.varianceClipGamma;
  values[81] = options.subpixelCorrection;
  values[82] = options.flickerReduction;
  return values;
}

/**
 * Owns only the sampled Dynamic TAA resolve Shader/Pipeline/Uniform/Bind Groups.
 * The caller owns the History target set and controls prepare/commit ordering.
 */
export class DynamicTaaResolvePass implements Disposable {
  readonly #bindGroups = new Map<string, BackendBindGroupHandle>();
  readonly #ownerId: string;
  #backend: GraphicsBackend | undefined;
  #bindingResourceGeneration = 0;
  #disposed = false;
  #executionCount = 0;
  #resourceGeneration = 0;
  #resources: DynamicTaaResolveResources | undefined;
  #unsubscribeLost: Unsubscribe | undefined;

  constructor(options: DynamicTaaResolvePassOptions) {
    this.#ownerId = validateOwnerId(options.ownerId);
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  async initialize(backend: GraphicsBackend): Promise<void> {
    this.#assertActive();
    if (backend.state !== 'ready') {
      throw error('Dynamic TAA Resolve Pass requires a ready Backend.', 'INVALID_STATE');
    }
    if (this.#backend === backend && this.#resources !== undefined) return;
    if (this.#backend !== undefined) {
      throw error('Dynamic TAA Resolve Pass is attached to another Backend.', 'INVALID_STATE');
    }

    const created: BackendResourceHandle[] = [];
    try {
      const shader = backend.createShaderModule({
        code: PHASE_04_TAA_RESOLVE_WGSL,
        label: `taa-resolve-${this.#ownerId}-shader`,
        language: 'wgsl',
      });
      created.push(shader);
      const compilation = await backend.getShaderCompilationInfo(shader);
      if (!compilation.valid) {
        throw error(
          `Dynamic TAA Resolve Shader compilation failed: ${compilation.messages
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
        label: `taa-resolve-${this.#ownerId}-pipeline`,
        primitive: { cullMode: 'none', topology: 'triangle-list' },
        vertex: { entryPoint: 'vertexMain', module: shader },
      });
      created.push(pipeline);
      const uniformBuffer = backend.createBuffer({
        label: `taa-resolve-${this.#ownerId}-uniform`,
        size: DYNAMIC_TAA_RESOLVE_UNIFORM_LAYOUT.byteLength,
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
          'Dynamic TAA Resolve Pass initialization failed.',
          { cause },
        );
      }
      throw cause;
    }
  }

  execute(input: DynamicTaaResolvePassInput): BackendRenderPassStatistics {
    this.#assertActive();
    const backend = this.#backend;
    const resources = this.#resources;
    if (backend === undefined || backend.state !== 'ready' || resources === undefined) {
      throw error('Dynamic TAA Resolve resources are unavailable.', 'INVALID_STATE', true);
    }
    if (input.frame.ownerId !== this.#ownerId) {
      throw error('Dynamic TAA Resolve frame belongs to another owner.', 'INVALID_ARGUMENT');
    }
    const uniformValues = packDynamicTaaResolveUniforms(input);
    backend.writeBuffer(resources.uniformBuffer, uniformValues);
    const bindGroup = this.#resolveBindGroup(backend, resources, input.frame);
    const commandEncoder = backend.createCommandEncoder({
      label: `taa-resolve-${this.#ownerId}-${this.#executionCount + 1}`,
    });
    try {
      const statistics = backend.executeFrame({
        commandEncoder,
        renderPasses: [
          {
            clearColor: { a: 0, b: 0, g: 0, r: 0 },
            colorAttachments: [{ texture: input.frame.writeColorTexture }],
            draws: [
              {
                bindGroups: [{ bindGroup, group: 0 }],
                pipeline: resources.pipeline,
                vertexCount: 3,
              },
            ],
            label: `taa-resolve-${this.#ownerId}-pass`,
          },
        ],
      });
      this.#executionCount += 1;
      return statistics;
    } catch (cause) {
      backend.destroyResource(commandEncoder);
      throw cause;
    }
  }

  getDiagnostics(): DynamicTaaResolvePassDiagnostics {
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
    const errors =
      backend === undefined || resources === undefined
        ? []
        : this.#destroyHandles(backend, [
            ...this.#bindGroups.values(),
            resources.uniformBuffer,
            resources.pipeline,
            resources.shader,
          ]);
    this.#bindGroups.clear();
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(errors, 'Dynamic TAA Resolve Pass disposal failed.');
    }
  }

  #resolveBindGroup(
    backend: GraphicsBackend,
    resources: DynamicTaaResolveResources,
    frame: DynamicTaaGpuFrame,
  ): BackendBindGroupHandle {
    if (this.#bindingResourceGeneration !== frame.resourceGeneration) {
      const errors = this.#destroyHandles(backend, [...this.#bindGroups.values()]);
      this.#bindGroups.clear();
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) {
        throw new AggregateError(errors, 'Dynamic TAA Resolve Bind Group cleanup failed.');
      }
      this.#bindingResourceGeneration = frame.resourceGeneration;
    }
    const key = [
      frame.currentColorTexture.id,
      frame.writeDepthTexture.id,
      frame.writeNormalTexture.id,
      frame.currentVelocityTexture.id,
      frame.readColorTexture.id,
      frame.readDepthTexture.id,
      frame.readNormalTexture.id,
      frame.sampler.id,
    ].join(':');
    const existing = this.#bindGroups.get(key);
    if (existing !== undefined) return existing;
    const bindGroup = backend.createBindGroup({
      entries: [
        { binding: 0, resource: { buffer: resources.uniformBuffer } },
        { binding: 1, resource: { texture: frame.currentColorTexture } },
        { binding: 2, resource: { texture: frame.writeDepthTexture } },
        { binding: 3, resource: { texture: frame.writeNormalTexture } },
        { binding: 4, resource: { texture: frame.currentVelocityTexture } },
        { binding: 5, resource: { texture: frame.readColorTexture } },
        { binding: 6, resource: { texture: frame.readDepthTexture } },
        { binding: 7, resource: { texture: frame.readNormalTexture } },
        { binding: 8, resource: { sampler: frame.sampler } },
      ],
      group: 0,
      label: `taa-resolve-${this.#ownerId}-bindings`,
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
    this.#bindingResourceGeneration = 0;
  }

  #assertActive(): void {
    if (this.#disposed) {
      throw error('Dynamic TAA Resolve Pass is disposed.', 'ALREADY_DISPOSED');
    }
  }
}
