import { describe, expect, it } from 'vitest';

import {
  BACKEND_RESOURCE_KINDS,
  PbrMaterial,
  PbrTextureLibrary,
  PbrTextureSource,
  createBackendCapabilityReport,
  createKyxosRendererFromBackend,
  srgbToLinearRgba,
} from '../src/index.js';
import type {
  BackendBindGroupDescriptor,
  BackendBindGroupHandle,
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
  BackendTextureData,
  BackendTextureDescriptor,
  BackendTextureHandle,
  BackendTextureWriteDescriptor,
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

  createBindGroup(descriptor: BackendBindGroupDescriptor): BackendBindGroupHandle {
    void descriptor;
    throw new Error('The SDK-only foundation fixture does not allocate Bind Groups.');
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

  writeTexture(
    handle: BackendTextureHandle,
    data: BackendTextureData,
    descriptor: BackendTextureWriteDescriptor,
  ): void {
    void handle;
    void data;
    void descriptor;
    throw new Error('The SDK-only foundation fixture does not allocate textures.');
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

  it('creates PBR material state using only the public SDK entry point', () => {
    const material = new PbrMaterial({
      baseColorFactor: srgbToLinearRgba([0.5, 0.25, 0.75, 1]),
      metallicFactor: 0.8,
      roughnessFactor: 0.3,
    });

    expect(material.snapshot()).toMatchObject({
      alphaMode: 'opaque',
      metallicFactor: 0.8,
      revision: 0,
      roughnessFactor: 0.3,
    });
    material.dispose();
  });

  it('registers immutable PBR Texture sources using only the public SDK entry point', () => {
    const source = new PbrTextureSource({
      height: 1,
      id: 'sdk-base-color',
      pixels: new Uint8Array([255, 255, 255, 255]),
      transferFunction: 'srgb',
      width: 1,
    });
    const library = new PbrTextureLibrary();
    library.set(source);

    expect(library.diagnostics()).toEqual({
      revision: 1,
      textureCount: 1,
      textureIds: ['sdk-base-color'],
    });
    library.dispose();
    expect([...source.copyPixels()]).toEqual([255, 255, 255, 255]);
  });
});
