import type { GraphicsBackend } from '@kyxos/render-backend-api';
import type { FrameRequestDriver } from '@kyxos/render-frame-scheduler';
import { KyxosRenderer } from '@kyxos/render-renderer';

import { createBrowserFrameDriver } from './browser-frame-driver.js';

export interface CreateKyxosInjectedRendererOptions {
  readonly backend: GraphicsBackend;
  readonly frameDriver?: FrameRequestDriver;
}

export async function createKyxosRendererFromBackend(
  options: CreateKyxosInjectedRendererOptions,
): Promise<KyxosRenderer> {
  const renderer = new KyxosRenderer({
    backend: options.backend,
    frameDriver: options.frameDriver ?? createBrowserFrameDriver(),
  });
  try {
    await renderer.initialize();
    return renderer;
  } catch (error) {
    try {
      renderer.dispose();
    } catch (disposeError) {
      throw new AggregateError([error, disposeError], 'Renderer creation and cleanup failed.', {
        cause: disposeError,
      });
    }
    throw error;
  }
}
