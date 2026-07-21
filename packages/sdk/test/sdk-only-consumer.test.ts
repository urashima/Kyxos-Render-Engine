import { describe, expect, it } from 'vitest';

import {
  BACKEND_RESOURCE_KINDS,
  createBackendCapabilityReport,
  createKyxosRendererFromBackend,
} from '../src/index.js';
import type {
  BackendBufferData,
  BackendBufferDescriptor,
  BackendBufferHandle,
  BackendCommandEncoderDescriptor,
  BackendCommandEncoderHandle,
  BackendEvents,
  BackendFrameSubmission,
  BackendLifecycleState,
  BackendPipelineHandle,
  BackendRenderPassStatistics,
  BackendRenderPipelineDescriptor,
  BackendResourceDescriptor,
  BackendResourceHandle,
  BackendResourceKind,
  BackendResourceStatistics,
  BackendSamplerDescriptor,
  BackendSamplerHandle,
  BackendShaderCompilationInfo,
  BackendShaderModuleDescriptor,
  BackendShaderModuleHandle,
  BackendSurfaceDescriptor,
  BackendSurfaceHandle,
  BackendSurfaceInfo,
  BackendSurfaceResize,
  BackendTextureDescriptor,
  BackendTextureHandle,
  FrameRequestDriver,
  GraphicsBackend,
} from '../src/index.js';

class SdkOnlyBackend implements GraphicsBackend {
  #state: BackendLifecycleState = 'new';
  readonly capabilities = createBackendCapabilityReport({ backend: 'mock' });
  readonly type = 'mock' as const;

  get disposed(): boolean {
    return this.#state === 'disposed';
  }

  get state(): BackendLifecycleState {
    return this.#state;
  }

  async initialize(): Promise<void> {
    this.#state = 'ready';
  }

  async waitForIdle(): Promise<void> {
    await Promise.resolve();
  }

  createBuffer(descriptor: BackendBufferDescriptor): BackendBufferHandle {
    void descriptor;
    throw new Error('The SDK-only foundation fixture does not allocate buffers.');
  }

  createTexture(descriptor: BackendTextureDescriptor): BackendTextureHandle {
    void descriptor;
    throw new Error('The SDK-only foundation fixture does not allocate textures.');
  }

  createSampler(descriptor?: BackendSamplerDescriptor): BackendSamplerHandle {
    void descriptor;
    throw new Error('The SDK-only foundation fixture does not allocate samplers.');
  }

  createShaderModule(descriptor: BackendShaderModuleDescriptor): BackendShaderModuleHandle {
    void descriptor;
    throw new Error('The SDK-only foundation fixture does not allocate Shader Modules.');
  }

  async getShaderCompilationInfo(
    handle: BackendShaderModuleHandle,
  ): Promise<BackendShaderCompilationInfo> {
    void handle;
    throw new Error('The SDK-only foundation fixture does not allocate Shader Modules.');
  }

  async createRenderPipeline(
    descriptor: BackendRenderPipelineDescriptor,
  ): Promise<BackendPipelineHandle> {
    void descriptor;
    throw new Error('The SDK-only foundation fixture does not allocate Render Pipelines.');
  }

  createCommandEncoder(descriptor?: BackendCommandEncoderDescriptor): BackendCommandEncoderHandle {
    void descriptor;
    throw new Error('The SDK-only foundation fixture does not allocate Command Encoders.');
  }

  writeBuffer(handle: BackendBufferHandle, data: BackendBufferData, offset?: number): void {
    void handle;
    void data;
    void offset;
    throw new Error('The SDK-only foundation fixture does not allocate buffers.');
  }

  executeFrame(submission: BackendFrameSubmission): BackendRenderPassStatistics {
    void submission;
    throw new Error('The SDK-only foundation fixture does not execute frames.');
  }

  on<EventName extends keyof BackendEvents>(
    eventName: EventName,
    listener: (payload: BackendEvents[EventName]) => void,
  ): () => void {
    void eventName;
    void listener;
    return () => undefined;
  }

  createResource<Kind extends BackendResourceKind>(
    kind: Kind,
    descriptor?: BackendResourceDescriptor,
  ): BackendResourceHandle<Kind> {
    void kind;
    void descriptor;
    throw new Error('The SDK-only foundation fixture does not allocate resources.');
  }

  createSurface(descriptor: BackendSurfaceDescriptor): BackendSurfaceHandle {
    void descriptor;
    throw new Error('The SDK-only foundation fixture does not allocate surfaces.');
  }

  destroyResource(handle: BackendResourceHandle): boolean {
    void handle;
    return false;
  }

  getSurfaceInfo(handle: BackendSurfaceHandle): BackendSurfaceInfo {
    void handle;
    throw new Error('The SDK-only foundation fixture does not allocate surfaces.');
  }

  getResourceStatistics(): BackendResourceStatistics {
    const byKind = Object.fromEntries(
      BACKEND_RESOURCE_KINDS.map((kind) => [
        kind,
        Object.freeze({ activeCount: 0, activeEstimatedBytes: 0 }),
      ]),
    ) as BackendResourceStatistics['byKind'];

    return Object.freeze({
      activeCount: 0,
      activeEstimatedBytes: 0,
      byKind: Object.freeze(byKind),
      createdTotal: 0,
      destroyedTotal: 0,
    });
  }

  resizeSurface(handle: BackendSurfaceHandle, resize: BackendSurfaceResize): BackendSurfaceInfo {
    void handle;
    void resize;
    throw new Error('The SDK-only foundation fixture does not allocate surfaces.');
  }

  dispose(): void {
    this.#state = 'disposed';
  }
}

class SdkOnlyFrameDriver implements FrameRequestDriver {
  callback: ((timestamp: number) => void) | undefined;

  cancelFrame(): void {
    this.callback = undefined;
  }

  requestFrame(callback: (timestamp: number) => void): number {
    this.callback = callback;
    return 1;
  }
}

describe('SDK-only consumer', () => {
  it('creates and controls a renderer using only the public SDK entry point', async () => {
    const frameDriver = new SdkOnlyFrameDriver();
    const renderer = await createKyxosRendererFromBackend({
      backend: new SdkOnlyBackend(),
      frameDriver,
    });

    renderer.invalidate('material');
    frameDriver.callback?.(10);

    expect(renderer.getDiagnostics()).toMatchObject({
      frameIndex: 1,
      renderMode: 'sleeping',
      state: 'ready',
    });
    renderer.dispose();
    expect(renderer.disposed).toBe(true);
  });
});
