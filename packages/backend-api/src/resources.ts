import { isHandle } from '@kyxos/render-core';
import type { Handle } from '@kyxos/render-core';

export const BACKEND_RESOURCE_KINDS = [
  'bind-group',
  'buffer',
  'command-encoder',
  'pipeline',
  'sampler',
  'shader-module',
  'surface',
  'texture',
] as const;

export type BackendResourceKind = (typeof BACKEND_RESOURCE_KINDS)[number];
export type BackendResourceHandleKind<Kind extends BackendResourceKind> = `backend:${Kind}`;
export type BackendResourceHandle<Kind extends BackendResourceKind = BackendResourceKind> = Handle<
  BackendResourceHandleKind<Kind>
>;

export interface BackendResourceDescriptor {
  readonly estimatedBytes?: number;
  readonly label?: string;
}

export const BACKEND_BUFFER_USAGES = [
  'copy-dst',
  'copy-src',
  'index',
  'indirect',
  'map-read',
  'map-write',
  'query-resolve',
  'storage',
  'uniform',
  'vertex',
] as const;

export type BackendBufferUsage = (typeof BACKEND_BUFFER_USAGES)[number];

export interface BackendBufferDescriptor {
  readonly label?: string;
  readonly mappedAtCreation?: boolean;
  readonly size: number;
  readonly usage: readonly BackendBufferUsage[];
}

export type BackendBufferHandle = BackendResourceHandle<'buffer'>;

export const BACKEND_TEXTURE_USAGES = [
  'copy-dst',
  'copy-src',
  'render-attachment',
  'sampled',
  'storage',
] as const;

export type BackendTextureUsage = (typeof BACKEND_TEXTURE_USAGES)[number];
export type BackendTextureFormat =
  | 'bgra8unorm'
  | 'bgra8unorm-srgb'
  | 'depth24plus'
  | 'depth32float'
  | 'rgba8unorm'
  | 'rgba8unorm-srgb';

export interface BackendTextureSize {
  readonly depthOrArrayLayers?: number;
  readonly height: number;
  readonly width: number;
}

export interface BackendTextureDescriptor {
  readonly format: BackendTextureFormat;
  readonly label?: string;
  readonly mipLevelCount?: number;
  readonly sampleCount?: 1 | 4;
  readonly size: BackendTextureSize;
  readonly usage: readonly BackendTextureUsage[];
}

export type BackendTextureHandle = BackendResourceHandle<'texture'>;

export type BackendAddressMode = 'clamp-to-edge' | 'mirror-repeat' | 'repeat';
export type BackendFilterMode = 'linear' | 'nearest';
export type BackendMipmapFilterMode = BackendFilterMode;

export interface BackendSamplerDescriptor {
  readonly addressModeU?: BackendAddressMode;
  readonly addressModeV?: BackendAddressMode;
  readonly addressModeW?: BackendAddressMode;
  readonly label?: string;
  readonly magFilter?: BackendFilterMode;
  readonly maxAnisotropy?: number;
  readonly minFilter?: BackendFilterMode;
  readonly mipmapFilter?: BackendMipmapFilterMode;
}

export type BackendSamplerHandle = BackendResourceHandle<'sampler'>;

export interface BackendShaderModuleDescriptor {
  readonly code: string;
  readonly label?: string;
  readonly language: 'wgsl';
}

export type BackendShaderModuleHandle = BackendResourceHandle<'shader-module'>;
export type BackendShaderMessageType = 'error' | 'info' | 'warning';

export interface BackendShaderCompilationMessage {
  readonly length: number;
  readonly lineNumber: number;
  readonly linePosition: number;
  readonly message: string;
  readonly offset: number;
  readonly type: BackendShaderMessageType;
}

export interface BackendShaderCompilationInfo {
  readonly messages: readonly BackendShaderCompilationMessage[];
  readonly valid: boolean;
}

export type BackendVertexFormat = 'float32x2' | 'float32x3' | 'float32x4';
export type BackendVertexStepMode = 'instance' | 'vertex';

export interface BackendVertexAttribute {
  readonly format: BackendVertexFormat;
  readonly offset: number;
  readonly shaderLocation: number;
}

export interface BackendVertexBufferLayout {
  readonly arrayStride: number;
  readonly attributes: readonly BackendVertexAttribute[];
  readonly stepMode?: BackendVertexStepMode;
}

export interface BackendVertexStageDescriptor {
  readonly buffers?: readonly BackendVertexBufferLayout[];
  readonly entryPoint: string;
  readonly module: BackendShaderModuleHandle;
}

export interface BackendColorTargetDescriptor {
  readonly format: BackendTextureFormat;
}

export interface BackendFragmentStageDescriptor {
  readonly entryPoint: string;
  readonly module: BackendShaderModuleHandle;
  readonly targets: readonly BackendColorTargetDescriptor[];
}

export type BackendPrimitiveTopology =
  'line-list' | 'line-strip' | 'point-list' | 'triangle-list' | 'triangle-strip';
export type BackendCullMode = 'back' | 'front' | 'none';
export type BackendFrontFace = 'ccw' | 'cw';

export interface BackendPrimitiveState {
  readonly cullMode?: BackendCullMode;
  readonly frontFace?: BackendFrontFace;
  readonly topology?: BackendPrimitiveTopology;
}

export interface BackendRenderPipelineDescriptor {
  readonly fragment?: BackendFragmentStageDescriptor;
  readonly label?: string;
  readonly primitive?: BackendPrimitiveState;
  readonly vertex: BackendVertexStageDescriptor;
}

export type BackendPipelineHandle = BackendResourceHandle<'pipeline'>;

export interface BackendCommandEncoderDescriptor {
  readonly label?: string;
}

export type BackendCommandEncoderHandle = BackendResourceHandle<'command-encoder'>;

export interface BackendResourceKindStatistics {
  readonly activeCount: number;
  readonly activeEstimatedBytes: number;
}

export interface BackendResourceStatistics {
  readonly activeCount: number;
  readonly activeEstimatedBytes: number;
  readonly byKind: Readonly<Record<BackendResourceKind, BackendResourceKindStatistics>>;
  readonly createdTotal: number;
  readonly destroyedTotal: number;
}

export function backendResourceHandleKind<Kind extends BackendResourceKind>(
  kind: Kind,
): BackendResourceHandleKind<Kind> {
  return `backend:${kind}`;
}

export function isBackendResourceHandle(
  value: unknown,
): value is BackendResourceHandle<BackendResourceKind> {
  return (
    isHandle(value) &&
    BACKEND_RESOURCE_KINDS.some((kind) => value.kind === backendResourceHandleKind(kind))
  );
}
