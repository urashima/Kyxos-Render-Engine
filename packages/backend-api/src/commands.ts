import type {
  BackendBufferHandle,
  BackendCommandEncoderHandle,
  BackendPipelineHandle,
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

export interface BackendDrawCommand {
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

export interface BackendRenderPassDescriptor {
  readonly clearColor: BackendClearColor;
  readonly draws?: readonly BackendDrawCommand[];
  readonly label?: string;
  readonly surface: BackendSurfaceHandle;
}

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
