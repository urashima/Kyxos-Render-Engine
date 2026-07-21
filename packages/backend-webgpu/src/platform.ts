import type {
  BackendBufferDescriptor,
  BackendColorTargetDescriptor,
  BackendCommandEncoderDescriptor,
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

export interface WebGpuTexturePort {
  destroy(): void;
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

export interface WebGpuCommandEncoderPort {
  readonly kind: 'command-encoder';
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
  readonly fragment: WebGpuFragmentStageRequest | undefined;
  readonly label: string | undefined;
  readonly primitive: BackendPrimitiveState | undefined;
  readonly vertex: WebGpuVertexStageRequest;
}

export interface WebGpuDevicePort {
  readonly lost: Promise<BackendLossInfo>;
  readonly queue: WebGpuQueuePort;
  createBuffer(descriptor: BackendBufferDescriptor): WebGpuBufferPort;
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
