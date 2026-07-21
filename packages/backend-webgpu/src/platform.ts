import type {
  BackendFeature,
  BackendLimits,
  BackendLossInfo,
  BackendSurfaceAlphaMode,
  BackendSurfaceColorSpace,
  BackendSurfaceFormat,
  BackendSurfaceSize,
  BackendSurfaceTarget,
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

export interface WebGpuDevicePort {
  readonly lost: Promise<BackendLossInfo>;
  readonly queue: WebGpuQueuePort;
  createSurface(request: WebGpuSurfaceRequest): WebGpuSurfacePort;
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
