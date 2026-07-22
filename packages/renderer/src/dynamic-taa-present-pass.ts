import type {
  BackendBindGroupHandle,
  BackendBufferHandle,
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
import type { Disposable, Unsubscribe } from '@kyxos/render-core';
import {
  type PbrOutputTransform,
  type PbrOutputTransformDescriptor,
  createPbrOutputTransform,
} from '@kyxos/render-material-pbr';

import type { DynamicTaaGpuFrame } from './dynamic-taa-gpu-history.js';
import { PHASE_04_TAA_PRESENT_WGSL } from './generated/phase-04-taa-present.wgsl.js';

const FLOAT_BYTES = Float32Array.BYTES_PER_ELEMENT;
const EMPTY_STATISTICS: BackendRenderPassStatistics = Object.freeze({
  drawCalls: 0,
  instances: 0,
  triangles: 0,
  vertices: 0,
});

export const DYNAMIC_TAA_PRESENT_UNIFORM_LAYOUT = Object.freeze({
  byteLength: 4 * FLOAT_BYTES,
  exposureMultiplierOffset: 0,
  toneMappingEnabledOffset: FLOAT_BYTES,
});

export interface DynamicTaaPresentPassOptions {
  readonly output?: PbrOutputTransformDescriptor;
  readonly ownerId: string;
  readonly surface: BackendSurfaceDescriptor;
}

export interface DynamicTaaPresentPassInput {
  /** Resolved Color is read from the open frame's write target before History commit. */
  readonly frame: DynamicTaaGpuFrame;
}

export interface DynamicTaaPresentPassDiagnostics {
  readonly activeBindGroupCount: number;
  readonly executionCount: number;
  readonly outputExposure: number;
  readonly outputExposureMultiplier: number;
  readonly outputToneMapping: PbrOutputTransform['toneMapping'];
  readonly ownerId: string;
  readonly resourceGeneration: number;
  readonly state: 'detached' | 'disposed' | 'ready';
  readonly surface: BackendSurfaceInfo | null;
}

interface DynamicTaaPresentResources {
  readonly pipeline: BackendPipelineHandle;
  readonly shader: BackendShaderModuleHandle;
  readonly surface: BackendSurfaceHandle;
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
    throw error('Dynamic TAA Present ownerId must not be empty.', 'INVALID_ARGUMENT');
  }
  return normalized;
}

export function packDynamicTaaPresentUniforms(
  descriptor: PbrOutputTransformDescriptor = {},
): Float32Array {
  const output = createPbrOutputTransform(descriptor);
  return new Float32Array([
    output.exposureMultiplier,
    output.toneMapping === 'khronos-pbr-neutral' ? 1 : 0,
    0,
    0,
  ]);
}

/**
 * Owns only final display-transform resources and one Canvas Surface.
 * Dynamic TAA History resources and the Backend remain caller-owned.
 */
export class DynamicTaaPresentPass implements Disposable {
  readonly #bindGroups = new Map<string, BackendBindGroupHandle>();
  readonly #ownerId: string;
  readonly #surfaceDescriptor: BackendSurfaceDescriptor;
  #backend: GraphicsBackend | undefined;
  #bindingResourceGeneration = 0;
  #disposed = false;
  #executionCount = 0;
  #output: PbrOutputTransform;
  #resourceGeneration = 0;
  #resources: DynamicTaaPresentResources | undefined;
  #unsubscribeLost: Unsubscribe | undefined;

  constructor(options: DynamicTaaPresentPassOptions) {
    this.#ownerId = validateOwnerId(options.ownerId);
    this.#surfaceDescriptor = options.surface;
    this.#output = createPbrOutputTransform(options.output);
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  async initialize(backend: GraphicsBackend): Promise<void> {
    this.#assertActive();
    if (backend.state !== 'ready') {
      throw error('Dynamic TAA Present Pass requires a ready Backend.', 'INVALID_STATE');
    }
    if (this.#backend === backend && this.#resources !== undefined) return;
    if (this.#backend !== undefined) {
      throw error('Dynamic TAA Present Pass is attached to another Backend.', 'INVALID_STATE');
    }

    const created: BackendResourceHandle[] = [];
    try {
      const surface = backend.createSurface(this.#surfaceDescriptor);
      created.push(surface);
      const surfaceInfo = backend.getSurfaceInfo(surface);
      const shader = backend.createShaderModule({
        code: PHASE_04_TAA_PRESENT_WGSL,
        label: `taa-present-${this.#ownerId}-shader`,
        language: 'wgsl',
      });
      created.push(shader);
      const compilation = await backend.getShaderCompilationInfo(shader);
      if (!compilation.valid) {
        throw error(
          `Dynamic TAA Present Shader compilation failed: ${compilation.messages
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
          targets: [{ format: surfaceInfo.format }],
        },
        label: `taa-present-${this.#ownerId}-pipeline`,
        primitive: { cullMode: 'none', topology: 'triangle-list' },
        vertex: { entryPoint: 'vertexMain', module: shader },
      });
      created.push(pipeline);
      const uniformBuffer = backend.createBuffer({
        label: `taa-present-${this.#ownerId}-uniform`,
        size: DYNAMIC_TAA_PRESENT_UNIFORM_LAYOUT.byteLength,
        usage: ['copy-dst', 'uniform'],
      });
      created.push(uniformBuffer);
      this.#backend = backend;
      this.#resources = Object.freeze({ pipeline, shader, surface, uniformBuffer });
      this.#resourceGeneration += 1;
      this.#unsubscribeLost = backend.on('lost', () => this.#onBackendLost(backend));
    } catch (cause) {
      const cleanupErrors = this.#destroyHandles(backend, created.reverse());
      if (cleanupErrors.length > 0) {
        throw new AggregateError(
          [cause, ...cleanupErrors],
          'Dynamic TAA Present Pass initialization failed.',
          { cause },
        );
      }
      throw cause;
    }
  }

  execute(input: DynamicTaaPresentPassInput): BackendRenderPassStatistics {
    this.#assertActive();
    const backend = this.#backend;
    const resources = this.#resources;
    if (backend === undefined || backend.state !== 'ready' || resources === undefined) {
      throw error('Dynamic TAA Present resources are unavailable.', 'INVALID_STATE', true);
    }
    if (input.frame.ownerId !== this.#ownerId) {
      throw error('Dynamic TAA Present frame belongs to another owner.', 'INVALID_ARGUMENT');
    }
    const surfaceInfo = backend.getSurfaceInfo(resources.surface);
    if (surfaceInfo.size.suspended) return EMPTY_STATISTICS;
    if (
      input.frame.size.width !== surfaceInfo.size.physicalWidth ||
      input.frame.size.height !== surfaceInfo.size.physicalHeight
    ) {
      throw error(
        `Dynamic TAA Present frame ${input.frame.size.width}x${input.frame.size.height} does not match Surface ${surfaceInfo.size.physicalWidth}x${surfaceInfo.size.physicalHeight}.`,
        'INVALID_ARGUMENT',
      );
    }

    backend.writeBuffer(
      resources.uniformBuffer,
      new Float32Array([
        this.#output.exposureMultiplier,
        this.#output.toneMapping === 'khronos-pbr-neutral' ? 1 : 0,
        0,
        0,
      ]),
    );
    const bindGroup = this.#resolveBindGroup(backend, resources, input.frame);
    const commandEncoder = backend.createCommandEncoder({
      label: `taa-present-${this.#ownerId}-${this.#executionCount + 1}`,
    });
    try {
      const statistics = backend.executeFrame({
        commandEncoder,
        renderPasses: [
          {
            clearColor: { a: 1, b: 0, g: 0, r: 0 },
            draws: [
              {
                bindGroups: [{ bindGroup, group: 0 }],
                pipeline: resources.pipeline,
                vertexCount: 3,
              },
            ],
            label: `taa-present-${this.#ownerId}-pass`,
            surface: resources.surface,
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

  getDiagnostics(): DynamicTaaPresentPassDiagnostics {
    const backend = this.#backend;
    const resources = this.#resources;
    return Object.freeze({
      activeBindGroupCount: this.#bindGroups.size,
      executionCount: this.#executionCount,
      outputExposure: this.#output.exposure,
      outputExposureMultiplier: this.#output.exposureMultiplier,
      outputToneMapping: this.#output.toneMapping,
      ownerId: this.#ownerId,
      resourceGeneration: this.#resourceGeneration,
      state: this.#disposed ? 'disposed' : resources === undefined ? 'detached' : 'ready',
      surface:
        backend === undefined || resources === undefined
          ? null
          : backend.getSurfaceInfo(resources.surface),
    });
  }

  resize(resize: BackendSurfaceResize): BackendSurfaceInfo {
    this.#assertActive();
    const backend = this.#backend;
    const resources = this.#resources;
    if (backend === undefined || backend.state !== 'ready' || resources === undefined) {
      throw error('Dynamic TAA Present Surface is unavailable.', 'INVALID_STATE', true);
    }
    return backend.resizeSurface(resources.surface, resize);
  }

  setOutput(descriptor: PbrOutputTransformDescriptor): PbrOutputTransform {
    this.#assertActive();
    this.#output = createPbrOutputTransform(descriptor);
    return this.#output;
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
            resources.surface,
          ]);
    this.#bindGroups.clear();
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(errors, 'Dynamic TAA Present Pass disposal failed.');
    }
  }

  #resolveBindGroup(
    backend: GraphicsBackend,
    resources: DynamicTaaPresentResources,
    frame: DynamicTaaGpuFrame,
  ): BackendBindGroupHandle {
    if (this.#bindingResourceGeneration !== frame.resourceGeneration) {
      const errors = this.#destroyHandles(backend, [...this.#bindGroups.values()]);
      this.#bindGroups.clear();
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) {
        throw new AggregateError(errors, 'Dynamic TAA Present Bind Group cleanup failed.');
      }
      this.#bindingResourceGeneration = frame.resourceGeneration;
    }
    const key = String(frame.writeColorTexture.id);
    const existing = this.#bindGroups.get(key);
    if (existing !== undefined) return existing;
    const bindGroup = backend.createBindGroup({
      entries: [
        { binding: 0, resource: { buffer: resources.uniformBuffer } },
        { binding: 1, resource: { texture: frame.writeColorTexture } },
      ],
      group: 0,
      label: `taa-present-${this.#ownerId}-bindings`,
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
      throw error('Dynamic TAA Present Pass is disposed.', 'ALREADY_DISPOSED');
    }
  }
}
