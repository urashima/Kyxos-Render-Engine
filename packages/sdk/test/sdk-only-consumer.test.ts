import { describe, expect, it } from 'vitest';

import {
  BACKEND_RESOURCE_KINDS,
  createBackendCapabilityReport,
  createKyxosRenderer,
} from '../src/index.js';
import type {
  BackendEvents,
  BackendLifecycleState,
  BackendResourceDescriptor,
  BackendResourceHandle,
  BackendResourceKind,
  BackendResourceStatistics,
  FrameRequestDriver,
  GraphicsBackend,
} from '../src/index.js';

class SdkOnlyBackend implements GraphicsBackend {
  #state: BackendLifecycleState = 'new';
  readonly capabilities = createBackendCapabilityReport({ backend: 'mock' });
  readonly type = 'mock' as const;

  get disposed(): boolean {
    return this.#state === 'disposed';
  }

  get state(): BackendLifecycleState {
    return this.#state;
  }

  async initialize(): Promise<void> {
    this.#state = 'ready';
  }

  on<EventName extends keyof BackendEvents>(
    eventName: EventName,
    listener: (payload: BackendEvents[EventName]) => void,
  ): () => void {
    void eventName;
    void listener;
    return () => undefined;
  }

  createResource<Kind extends BackendResourceKind>(
    kind: Kind,
    descriptor?: BackendResourceDescriptor,
  ): BackendResourceHandle<Kind> {
    void kind;
    void descriptor;
    throw new Error('The SDK-only foundation fixture does not allocate resources.');
  }

  destroyResource(handle: BackendResourceHandle): boolean {
    void handle;
    return false;
  }

  getResourceStatistics(): BackendResourceStatistics {
    const byKind = Object.fromEntries(
      BACKEND_RESOURCE_KINDS.map((kind) => [
        kind,
        Object.freeze({ activeCount: 0, activeEstimatedBytes: 0 }),
      ]),
    ) as BackendResourceStatistics['byKind'];

    return Object.freeze({
      activeCount: 0,
      activeEstimatedBytes: 0,
      byKind: Object.freeze(byKind),
      createdTotal: 0,
      destroyedTotal: 0,
    });
  }

  dispose(): void {
    this.#state = 'disposed';
  }
}

class SdkOnlyFrameDriver implements FrameRequestDriver {
  callback: ((timestamp: number) => void) | undefined;

  cancelFrame(): void {
    this.callback = undefined;
  }

  requestFrame(callback: (timestamp: number) => void): number {
    this.callback = callback;
    return 1;
  }
}

describe('SDK-only consumer', () => {
  it('creates and controls a renderer using only the public SDK entry point', async () => {
    const frameDriver = new SdkOnlyFrameDriver();
    const renderer = await createKyxosRenderer({
      backend: new SdkOnlyBackend(),
      frameDriver,
    });

    renderer.invalidate('material');
    frameDriver.callback?.(10);

    expect(renderer.getDiagnostics()).toMatchObject({
      frameIndex: 1,
      renderMode: 'sleeping',
      state: 'ready',
    });
    renderer.dispose();
    expect(renderer.disposed).toBe(true);
  });
});
