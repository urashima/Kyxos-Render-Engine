import type { FrameRequestDriver, FrameRequestId } from '@kyxos/render-frame-scheduler';

export class ManualFrameDriver implements FrameRequestDriver {
  readonly #callbacks = new Map<FrameRequestId, (timestamp: number) => void>();
  #nextRequestId = 1;

  get pendingCount(): number {
    return this.#callbacks.size;
  }

  cancelFrame(requestId: FrameRequestId): void {
    this.#callbacks.delete(requestId);
  }

  requestFrame(callback: (timestamp: number) => void): FrameRequestId {
    const requestId = this.#nextRequestId;
    this.#nextRequestId += 1;
    this.#callbacks.set(requestId, callback);
    return requestId;
  }

  flush(timestamp = 0): number {
    const callbacks = [...this.#callbacks.values()];
    this.#callbacks.clear();
    for (const callback of callbacks) {
      callback(timestamp);
    }
    return callbacks.length;
  }
}
