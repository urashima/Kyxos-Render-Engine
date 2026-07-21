import type { GraphicsBackend } from '@kyxos/render-backend-api';
import type { FrameRequestDriver } from '@kyxos/render-frame-scheduler';
import { KyxosRenderer } from '@kyxos/render-renderer';

import { createBrowserFrameDriver } from './browser-frame-driver.js';

export interface CreateKyxosRendererOptions {
  readonly backend: GraphicsBackend;
  readonly frameDriver?: FrameRequestDriver;
}

export async function createKyxosRenderer(
  options: CreateKyxosRendererOptions,
): Promise<KyxosRenderer> {
  const renderer = new KyxosRenderer({
    backend: options.backend,
    frameDriver: options.frameDriver ?? createBrowserFrameDriver(),
  });

  try {
    await renderer.initialize();
    return renderer;
  } catch (error) {
    renderer.dispose();
    throw error;
  }
}
