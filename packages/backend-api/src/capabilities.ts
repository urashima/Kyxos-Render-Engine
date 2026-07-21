export const BACKEND_FEATURES = [
  'compute',
  'timestamp-query',
  'texture-compression-bc',
  'texture-compression-etc2',
  'texture-compression-astc',
  'float32-filterable',
  'depth-clip-control',
  'indirect-first-instance',
  'shader-f16',
] as const;

export type BackendFeature = (typeof BACKEND_FEATURES)[number];
export type BackendType = 'mock' | 'webgl2' | 'webgpu';

export interface BackendLimits {
  readonly maxBindGroups: number;
  readonly maxColorAttachments: number;
  readonly maxSampledTexturesPerShaderStage: number;
  readonly maxStorageBufferBindingSize: number;
  readonly maxTextureDimension2D: number;
  readonly maxUniformBufferBindingSize: number;
}

export interface BackendCapabilityReport {
  readonly available: boolean;
  readonly backend: BackendType;
  readonly features: Readonly<Record<BackendFeature, boolean>>;
  readonly limits: BackendLimits;
  readonly unavailableReason?: string;
}

export interface BackendCapabilityReportOptions {
  readonly available?: boolean;
  readonly backend: BackendType;
  readonly features?: Partial<Record<BackendFeature, boolean>>;
  readonly limits?: Partial<BackendLimits>;
  readonly unavailableReason?: string;
}

const DEFAULT_LIMITS: BackendLimits = {
  maxBindGroups: 4,
  maxColorAttachments: 4,
  maxSampledTexturesPerShaderStage: 16,
  maxStorageBufferBindingSize: 128 * 1024 * 1024,
  maxTextureDimension2D: 8192,
  maxUniformBufferBindingSize: 64 * 1024,
};

export function createBackendCapabilityReport(
  options: BackendCapabilityReportOptions,
): BackendCapabilityReport {
  const features = Object.fromEntries(
    BACKEND_FEATURES.map((feature) => [feature, options.features?.[feature] ?? false]),
  ) as Record<BackendFeature, boolean>;

  return Object.freeze({
    available: options.available ?? true,
    backend: options.backend,
    features: Object.freeze(features),
    limits: Object.freeze({ ...DEFAULT_LIMITS, ...options.limits }),
    ...(options.unavailableReason === undefined
      ? {}
      : { unavailableReason: options.unavailableReason }),
  });
}
