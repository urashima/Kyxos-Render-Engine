import type { Disposable, EventListener, Unsubscribe } from '@kyxos/render-core';

import type { BackendCapabilityReport, BackendType } from './capabilities.js';
import type {
  BackendBufferData,
  BackendFrameSubmission,
  BackendRenderPassStatistics,
} from './commands.js';
import type {
  BackendBufferDescriptor,
  BackendBufferHandle,
  BackendCommandEncoderDescriptor,
  BackendCommandEncoderHandle,
  BackendPipelineHandle,
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
  BackendTextureDescriptor,
  BackendTextureHandle,
} from './resources.js';
import type {
  BackendSurfaceDescriptor,
  BackendSurfaceHandle,
  BackendSurfaceInfo,
  BackendSurfaceResize,
} from './surface.js';

export type BackendLifecycleState = 'disposed' | 'initializing' | 'lost' | 'new' | 'ready';

export interface BackendLossInfo {
  readonly message: string;
  readonly reason: 'destroyed' | 'unknown';
  readonly recoverable: boolean;
}

export interface BackendStateChange {
  readonly current: BackendLifecycleState;
  readonly previous: BackendLifecycleState;
}

export interface BackendEvents {
  readonly lost: BackendLossInfo;
  readonly statechange: BackendStateChange;
}

/** Backend-neutral contract. Concrete browser GPU objects never cross this boundary. */
export interface GraphicsBackend extends Disposable {
  readonly capabilities: BackendCapabilityReport;
  readonly state: BackendLifecycleState;
  readonly type: BackendType;

  createBuffer(descriptor: BackendBufferDescriptor): BackendBufferHandle;
  createCommandEncoder(descriptor?: BackendCommandEncoderDescriptor): BackendCommandEncoderHandle;
  createRenderPipeline(descriptor: BackendRenderPipelineDescriptor): Promise<BackendPipelineHandle>;
  createResource<Kind extends BackendResourceKind>(
    kind: Kind,
    descriptor?: BackendResourceDescriptor,
  ): BackendResourceHandle<Kind>;
  createSampler(descriptor?: BackendSamplerDescriptor): BackendSamplerHandle;
  createShaderModule(descriptor: BackendShaderModuleDescriptor): BackendShaderModuleHandle;
  createSurface(descriptor: BackendSurfaceDescriptor): BackendSurfaceHandle;
  createTexture(descriptor: BackendTextureDescriptor): BackendTextureHandle;
  /** Acceptance/debug hook. Implementations must not expose their native device. */
  debugSimulateDeviceLoss?(): void;
  destroyResource(handle: BackendResourceHandle): boolean;
  executeFrame(submission: BackendFrameSubmission): BackendRenderPassStatistics;
  getShaderCompilationInfo(
    handle: BackendShaderModuleHandle,
  ): Promise<BackendShaderCompilationInfo>;
  getSurfaceInfo(handle: BackendSurfaceHandle): BackendSurfaceInfo;
  getResourceStatistics(): BackendResourceStatistics;
  initialize(): Promise<void>;
  resizeSurface(handle: BackendSurfaceHandle, resize: BackendSurfaceResize): BackendSurfaceInfo;
  waitForIdle(): Promise<void>;
  writeBuffer(handle: BackendBufferHandle, data: BackendBufferData, offset?: number): void;
  on<EventName extends keyof BackendEvents>(
    eventName: EventName,
    listener: EventListener<BackendEvents[EventName]>,
  ): Unsubscribe;
}
