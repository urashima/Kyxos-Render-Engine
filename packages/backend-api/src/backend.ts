import type { Disposable, EventListener, Unsubscribe } from '@kyxos/render-core';

import type { BackendCapabilityReport, BackendType } from './capabilities.js';
import type {
  BackendResourceDescriptor,
  BackendResourceHandle,
  BackendResourceKind,
  BackendResourceStatistics,
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

  createResource<Kind extends BackendResourceKind>(
    kind: Kind,
    descriptor?: BackendResourceDescriptor,
  ): BackendResourceHandle<Kind>;
  createSurface(descriptor: BackendSurfaceDescriptor): BackendSurfaceHandle;
  destroyResource(handle: BackendResourceHandle): boolean;
  getSurfaceInfo(handle: BackendSurfaceHandle): BackendSurfaceInfo;
  getResourceStatistics(): BackendResourceStatistics;
  initialize(): Promise<void>;
  resizeSurface(handle: BackendSurfaceHandle, resize: BackendSurfaceResize): BackendSurfaceInfo;
  waitForIdle(): Promise<void>;
  on<EventName extends keyof BackendEvents>(
    eventName: EventName,
    listener: EventListener<BackendEvents[EventName]>,
  ): Unsubscribe;
}
