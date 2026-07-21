import { KyxosEngineError } from '@kyxos/render-core';
import type { FrameRequestDriver, FrameRequestId } from '@kyxos/render-frame-scheduler';

export function createBrowserFrameDriver(): FrameRequestDriver {
  const requestFrame = globalThis.requestAnimationFrame?.bind(globalThis);
  const cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis);

  if (requestFrame === undefined || cancelFrame === undefined) {
    throw new KyxosEngineError(
      'No browser animation-frame API is available; provide a custom frameDriver.',
      {
        code: 'UNSUPPORTED_CAPABILITY',
        module: 'scheduler',
        recoverable: true,
        suggestedAction: 'Run in a browser or inject a deterministic frame driver.',
      },
    );
  }

  return Object.freeze({
    cancelFrame: (requestId: FrameRequestId) => cancelFrame(requestId),
    requestFrame: (callback: (timestamp: number) => void) => requestFrame(callback),
  });
}
