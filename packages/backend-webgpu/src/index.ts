/** Stable package identity for diagnostics and boundary tests. */
export const BACKEND_WEBGPU_PACKAGE_NAME = '@kyxos/render-backend-webgpu' as const;

export type { WebGpuBackendOptions } from './backend.js';
export { createWebGpuBackend } from './backend.js';
export type { WebGpuPowerPreference } from './platform.js';
