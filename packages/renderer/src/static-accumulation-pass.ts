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
import { TEMPORAL_SAMPLE_LIMIT } from '@kyxos/render-temporal';

import { PHASE_04_STATIC_ACCUMULATION_WGSL } from './generated/phase-04-static-accumulation.wgsl.js';
import type { StaticAccumulationGpuFrame } from './static-accumulation-gpu-history.js';

const FLOAT_BYTES = Float32Array.BYTES_PER_ELEMENT;

export const STATIC_ACCUMULATION_UNIFORM_LAYOUT = Object.freeze({
  byteLength: 4 * FLOAT_BYTES,
  currentWeightOffset: FLOAT_BYTES,
  historyValidOffset: 2 * FLOAT_BYTES,
  historyWeightOffset: 0,
  previousSampleCountOffset: 3 * FLOAT_BYTES,
});

export interface StaticAccumulationPassOptions {
  readonly ownerId: string;
}

export interface StaticAccumulationPassInput {
  readonly currentColorTexture: BackendTextureHandle;
  readonly frame: StaticAccumulationGpuFrame;
}

export interface StaticAccumulationPassDiagnostics {
  readonly activeBindGroupCount: number;
  readonly executionCount: number;
  readonly ownerId: string;
  readonly resourceGeneration: number;
  readonly state: 'detached' | 'disposed' | 'ready';
}

interface StaticAccumulationPassResources {
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
    throw error('Static Accumulation Pass ownerId must not be empty.', 'INVALID_ARGUMENT');
  }
  return normalized;
}

export function packStaticAccumulationUniforms(frame: StaticAccumulationGpuFrame): Float32Array {
  if (
    !Number.isSafeInteger(frame.size.width) ||
    frame.size.width < 1 ||
    !Number.isSafeInteger(frame.size.height) ||
    frame.size.height < 1
  ) {
    throw error('Static Accumulation frame size is invalid.', 'INVALID_ARGUMENT');
  }
  const maximumPreviousSampleCount = TEMPORAL_SAMPLE_LIMIT.maximum - 1;
  if (
    !Number.isSafeInteger(frame.previousSampleCount) ||
    frame.previousSampleCount < 0 ||
    frame.previousSampleCount > maximumPreviousSampleCount
  ) {
    throw error(
      `Static Accumulation previous sample count must be from 0 through ${maximumPreviousSampleCount}.`,
      'INVALID_ARGUMENT',
    );
  }
  if (frame.historyValid && frame.previousSampleCount === 0) {
    throw error(
      'Valid Static Accumulation History must contain at least one prior sample.',
      'INVALID_ARGUMENT',
    );
  }
  if (!frame.historyValid && frame.previousSampleCount !== 0) {
    throw error(
      'Invalid Static Accumulation History must restart with zero prior samples.',
      'INVALID_ARGUMENT',
    );
  }

  const acceptedSampleCount = frame.historyValid ? frame.previousSampleCount : 0;
  const sampleCount = acceptedSampleCount + 1;
  return new Float32Array([
    acceptedSampleCount / sampleCount,
    1 / sampleCount,
    frame.historyValid ? 1 : 0,
    acceptedSampleCount,
  ]);
}

/**
 * Owns only the Static Accumulation Shader/Pipeline/Uniform and role-cached Bind Groups.
 * The caller owns both the current Dynamic TAA Color and Static Accumulation History resources.
 */
export class StaticAccumulationPass implements Disposable {
  readonly #bindGroups = new Map<string, BackendBindGroupHandle>();
  readonly #ownerId: string;
  #backend: GraphicsBackend | undefined;
  #bindingResourceGeneration = 0;
  #disposed = false;
  #executionCount = 0;
  #resourceGeneration = 0;
  #resources: StaticAccumulationPassResources | undefined;
  #unsubscribeLost: Unsubscribe | undefined;

  constructor(options: StaticAccumulationPassOptions) {
    this.#ownerId = validateOwnerId(options.ownerId);
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  async initialize(backend: GraphicsBackend): Promise<void> {
    this.#assertActive();
    if (backend.state !== 'ready') {
      throw error('Static Accumulation Pass requires a ready Backend.', 'INVALID_STATE');
    }
    if (this.#backend === backend && this.#resources !== undefined) return;
    if (this.#backend !== undefined) {
      throw error('Static Accumulation Pass is attached to another Backend.', 'INVALID_STATE');
    }

    const created: BackendResourceHandle[] = [];
    try {
      const shader = backend.createShaderModule({
        code: PHASE_04_STATIC_ACCUMULATION_WGSL,
        label: `static-accumulation-${this.#ownerId}-shader`,
        language: 'wgsl',
      });
      created.push(shader);
      const compilation = await backend.getShaderCompilationInfo(shader);
      if (!compilation.valid) {
        throw error(
          `Static Accumulation Shader compilation failed: ${compilation.messages
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
        label: `static-accumulation-${this.#ownerId}-pipeline`,
        primitive: { cullMode: 'none', topology: 'triangle-list' },
        vertex: { entryPoint: 'vertexMain', module: shader },
      });
      created.push(pipeline);
      const uniformBuffer = backend.createBuffer({
        label: `static-accumulation-${this.#ownerId}-uniform`,
        size: STATIC_ACCUMULATION_UNIFORM_LAYOUT.byteLength,
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
          'Static Accumulation Pass initialization failed.',
          { cause },
        );
      }
      throw cause;
    }
  }

  execute(input: StaticAccumulationPassInput): BackendRenderPassStatistics {
    this.#assertActive();
    const backend = this.#backend;
    const resources = this.#resources;
    if (backend === undefined || backend.state !== 'ready' || resources === undefined) {
      throw error('Static Accumulation resources are unavailable.', 'INVALID_STATE', true);
    }
    if (input.frame.ownerId !== this.#ownerId) {
      throw error('Static Accumulation frame belongs to another owner.', 'INVALID_ARGUMENT');
    }

    const uniformValues = packStaticAccumulationUniforms(input.frame);
    backend.writeBuffer(resources.uniformBuffer, uniformValues);
    const bindGroup = this.#resolveBindGroup(
      backend,
      resources,
      input.frame,
      input.currentColorTexture,
    );
    const commandEncoder = backend.createCommandEncoder({
      label: `static-accumulation-${this.#ownerId}-${this.#executionCount + 1}`,
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
            label: `static-accumulation-${this.#ownerId}-pass`,
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

  getDiagnostics(): StaticAccumulationPassDiagnostics {
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
      throw new AggregateError(errors, 'Static Accumulation Pass disposal failed.');
    }
  }

  #resolveBindGroup(
    backend: GraphicsBackend,
    resources: StaticAccumulationPassResources,
    frame: StaticAccumulationGpuFrame,
    currentColorTexture: BackendTextureHandle,
  ): BackendBindGroupHandle {
    if (this.#bindingResourceGeneration !== frame.resourceGeneration) {
      const errors = this.#destroyHandles(backend, [...this.#bindGroups.values()]);
      this.#bindGroups.clear();
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) {
        throw new AggregateError(errors, 'Static Accumulation Bind Group cleanup failed.');
      }
      this.#bindingResourceGeneration = frame.resourceGeneration;
    }
    const key = [
      currentColorTexture.id,
      frame.readColorTexture.id,
      frame.writeColorTexture.id,
    ].join(':');
    const existing = this.#bindGroups.get(key);
    if (existing !== undefined) return existing;
    const bindGroup = backend.createBindGroup({
      entries: [
        { binding: 0, resource: { buffer: resources.uniformBuffer } },
        { binding: 1, resource: { texture: currentColorTexture } },
        { binding: 2, resource: { texture: frame.readColorTexture } },
      ],
      group: 0,
      label: `static-accumulation-${this.#ownerId}-bindings`,
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
      throw error('Static Accumulation Pass is disposed.', 'ALREADY_DISPOSED');
    }
  }
}
