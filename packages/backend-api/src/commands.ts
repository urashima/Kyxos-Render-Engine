import type {
  BackendBindGroupHandle,
  BackendBufferHandle,
  BackendCommandEncoderHandle,
  BackendPipelineHandle,
  BackendTextureHandle,
  BackendTextureViewDescriptor,
} from './resources.js';
import type { BackendSurfaceHandle } from './surface.js';

export type BackendBufferData = ArrayBuffer | ArrayBufferView;

export interface BackendClearColor {
  readonly a: number;
  readonly b: number;
  readonly g: number;
  readonly r: number;
}

export interface BackendVertexBufferBinding {
  readonly buffer: BackendBufferHandle;
  readonly offset?: number;
  readonly size?: number;
  readonly slot: number;
}

export type BackendIndexFormat = 'uint16' | 'uint32';

export interface BackendIndexBufferBinding {
  readonly buffer: BackendBufferHandle;
  readonly format: BackendIndexFormat;
  readonly offset?: number;
  readonly size?: number;
}

export interface BackendBindGroupBinding {
  readonly bindGroup: BackendBindGroupHandle;
  readonly group: number;
}

export interface BackendDepthAttachment {
  readonly clearValue?: number;
  readonly loadOp?: 'clear' | 'load';
  readonly storeOp?: 'discard' | 'store';
  readonly texture: BackendTextureHandle;
}

export interface BackendColorAttachment {
  readonly loadOp?: 'clear' | 'load';
  readonly storeOp?: 'discard' | 'store';
  readonly texture: BackendTextureHandle;
  /** Render attachments select exactly one 2D mip and array layer. */
  readonly view?: BackendTextureViewDescriptor;
}

export interface BackendDrawCommand {
  readonly bindGroups?: readonly BackendBindGroupBinding[];
  readonly firstIndex?: number;
  readonly firstInstance?: number;
  readonly firstVertex?: number;
  readonly indexBuffer?: BackendIndexBufferBinding;
  readonly indexCount?: number;
  readonly instanceCount?: number;
  readonly pipeline: BackendPipelineHandle;
  readonly vertexBuffers?: readonly BackendVertexBufferBinding[];
  readonly vertexCount?: number;
}

interface BackendRenderPassBase {
  readonly clearColor: BackendClearColor;
  readonly draws?: readonly BackendDrawCommand[];
  readonly depthAttachment?: BackendDepthAttachment;
  readonly label?: string;
}

export interface BackendSurfaceRenderPassDescriptor extends BackendRenderPassBase {
  readonly colorAttachment?: never;
  readonly surface: BackendSurfaceHandle;
}

export interface BackendTextureRenderPassDescriptor extends BackendRenderPassBase {
  readonly colorAttachment: BackendColorAttachment;
  readonly surface?: never;
}

export type BackendRenderPassDescriptor =
  BackendSurfaceRenderPassDescriptor | BackendTextureRenderPassDescriptor;

export interface BackendRenderPassStatistics {
  readonly drawCalls: number;
  readonly instances: number;
  readonly triangles: number;
  readonly vertices: number;
}

export interface BackendFrameSubmission {
  readonly commandEncoder: BackendCommandEncoderHandle;
  readonly renderPasses: readonly BackendRenderPassDescriptor[];
}
