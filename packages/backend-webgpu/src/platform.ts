import type {
  BackendBufferData,
  BackendBufferDescriptor,
  BackendClearColor,
  BackendColorTargetDescriptor,
  BackendCommandEncoderDescriptor,
  BackendDepthStencilState,
  BackendFeature,
  BackendLimits,
  BackendLossInfo,
  BackendPrimitiveState,
  BackendSamplerDescriptor,
  BackendShaderCompilationInfo,
  BackendShaderModuleDescriptor,
  BackendSurfaceAlphaMode,
  BackendSurfaceColorSpace,
  BackendSurfaceFormat,
  BackendSurfaceSize,
  BackendSurfaceTarget,
  BackendTextureDescriptor,
  BackendVertexBufferLayout,
} from '@kyxos/render-backend-api';

export type WebGpuPowerPreference = 'high-performance' | 'low-power';

export interface WebGpuAdapterRequest {
  readonly forceFallbackAdapter: boolean;
  readonly powerPreference: WebGpuPowerPreference | undefined;
}

export interface WebGpuDeviceRequest {
  readonly label: string | undefined;
  readonly requiredFeatures: readonly BackendFeature[];
}

export interface WebGpuQueuePort {
  onSubmittedWorkDone(): Promise<void>;
  submit(commandBuffers: readonly WebGpuCommandBufferPort[]): void;
  writeBuffer(buffer: WebGpuBufferPort, offset: number, data: BackendBufferData): void;
}

export interface WebGpuSurfaceRequest {
  readonly alphaMode: BackendSurfaceAlphaMode;
  readonly colorSpace: BackendSurfaceColorSpace;
  readonly label: string | undefined;
  readonly target: BackendSurfaceTarget;
}

export interface WebGpuSurfacePort {
  readonly format: BackendSurfaceFormat;
  configure(size: BackendSurfaceSize): void;
  unconfigure(): void;
}

export interface WebGpuBufferPort {
  destroy(): void;
}

export interface WebGpuCommandBufferPort {
  readonly kind: 'command-buffer';
}

export interface WebGpuTexturePort {
  createView(): WebGpuTextureViewPort;
  destroy(): void;
}

export interface WebGpuTextureViewPort {
  readonly kind: 'texture-view';
}

export interface WebGpuSamplerPort {
  readonly kind: 'sampler';
}

export interface WebGpuShaderModulePort {
  getCompilationInfo(): Promise<BackendShaderCompilationInfo>;
}

export interface WebGpuPipelinePort {
  readonly kind: 'pipeline';
}

export interface WebGpuBindGroupPort {
  readonly kind: 'bind-group';
}

export interface WebGpuBindGroupEntryRequest {
  readonly binding: number;
  readonly buffer: WebGpuBufferPort;
  readonly offset: number;
  readonly size: number;
}

export interface WebGpuBindGroupRequest {
  readonly entries: readonly WebGpuBindGroupEntryRequest[];
  readonly group: number;
  readonly label: string | undefined;
  readonly pipeline: WebGpuPipelinePort;
}

export interface WebGpuCommandEncoderPort {
  readonly kind: 'command-encoder';
  encodeRenderPass(request: WebGpuRenderPassRequest): void;
  finish(): WebGpuCommandBufferPort;
}

export interface WebGpuVertexBufferBinding {
  readonly buffer: WebGpuBufferPort;
  readonly offset: number;
  readonly size: number | undefined;
  readonly slot: number;
}

export interface WebGpuIndexBufferBinding {
  readonly buffer: WebGpuBufferPort;
  readonly format: 'uint16' | 'uint32';
  readonly offset: number;
  readonly size: number | undefined;
}

export interface WebGpuBindGroupBinding {
  readonly bindGroup: WebGpuBindGroupPort;
  readonly group: number;
}

export interface WebGpuDrawRequest {
  readonly bindGroups: readonly WebGpuBindGroupBinding[];
  readonly firstIndex: number;
  readonly firstInstance: number;
  readonly firstVertex: number;
  readonly indexBuffer: WebGpuIndexBufferBinding | undefined;
  readonly indexCount: number | undefined;
  readonly instanceCount: number;
  readonly pipeline: WebGpuPipelinePort;
  readonly vertexBuffers: readonly WebGpuVertexBufferBinding[];
  readonly vertexCount: number | undefined;
}

export interface WebGpuDepthAttachmentRequest {
  readonly clearValue: number;
  readonly loadOp: 'clear' | 'load';
  readonly storeOp: 'discard' | 'store';
  readonly view: WebGpuTextureViewPort;
}

export interface WebGpuRenderPassRequest {
  readonly clearColor: BackendClearColor;
  readonly depthAttachment: WebGpuDepthAttachmentRequest | undefined;
  readonly draws: readonly WebGpuDrawRequest[];
  readonly label: string | undefined;
  readonly surface: WebGpuSurfacePort;
}

export interface WebGpuVertexStageRequest {
  readonly buffers: readonly BackendVertexBufferLayout[];
  readonly entryPoint: string;
  readonly module: WebGpuShaderModulePort;
}

export interface WebGpuFragmentStageRequest {
  readonly entryPoint: string;
  readonly module: WebGpuShaderModulePort;
  readonly targets: readonly BackendColorTargetDescriptor[];
}

export interface WebGpuRenderPipelineRequest {
  readonly depthStencil: BackendDepthStencilState | undefined;
  readonly fragment: WebGpuFragmentStageRequest | undefined;
  readonly label: string | undefined;
  readonly primitive: BackendPrimitiveState | undefined;
  readonly vertex: WebGpuVertexStageRequest;
}

export interface WebGpuDevicePort {
  readonly lost: Promise<BackendLossInfo>;
  readonly queue: WebGpuQueuePort;
  createBuffer(descriptor: BackendBufferDescriptor): WebGpuBufferPort;
  createBindGroup(request: WebGpuBindGroupRequest): WebGpuBindGroupPort;
  createCommandEncoder(descriptor: BackendCommandEncoderDescriptor): WebGpuCommandEncoderPort;
  createRenderPipeline(request: WebGpuRenderPipelineRequest): Promise<WebGpuPipelinePort>;
  createSampler(descriptor: BackendSamplerDescriptor): WebGpuSamplerPort;
  createShaderModule(descriptor: BackendShaderModuleDescriptor): WebGpuShaderModulePort;
  createSurface(request: WebGpuSurfaceRequest): WebGpuSurfacePort;
  createTexture(descriptor: BackendTextureDescriptor): WebGpuTexturePort;
  destroy(): void;
}

export interface WebGpuAdapterPort {
  readonly features: ReadonlySet<BackendFeature>;
  readonly limits: BackendLimits;
  requestDevice(request: WebGpuDeviceRequest): Promise<WebGpuDevicePort>;
}

/** Internal native seam. It is intentionally absent from the package root export. */
export interface WebGpuPlatformPort {
  readonly available: boolean;
  requestAdapter(request: WebGpuAdapterRequest): Promise<WebGpuAdapterPort | null>;
}
