import type { BackendFeature, BackendLimits, BackendLossInfo } from '@kyxos/render-backend-api';

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

export interface WebGpuDevicePort {
  readonly lost: Promise<BackendLossInfo>;
  readonly queue: WebGpuQueuePort;
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
