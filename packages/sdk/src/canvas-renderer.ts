import type {
  BackendClearColor,
  BackendSurfaceInfo,
  BackendSurfaceResize,
  GraphicsBackend,
} from '@kyxos/render-backend-api';
import type { DirtyFlag, FrameRequestDriver } from '@kyxos/render-frame-scheduler';
import { KyxosEngineError } from '@kyxos/render-core';
import { BasicGeometryFeature, KyxosRenderer } from '@kyxos/render-renderer';
import type { BasicGeometryPrimitive } from '@kyxos/render-renderer';

export interface KyxosCanvasRendererOptions {
  readonly backend: GraphicsBackend;
  readonly feature: BasicGeometryFeature;
  readonly frameDriver: FrameRequestDriver;
}

export class KyxosCanvasRenderer extends KyxosRenderer {
  readonly #backend: GraphicsBackend;
  readonly #feature: BasicGeometryFeature;

  constructor(options: KyxosCanvasRendererOptions) {
    super({ backend: options.backend, frameDriver: options.frameDriver });
    this.#backend = options.backend;
    this.#feature = options.feature;
    this.registerRenderFeature(options.feature);
  }

  get primitive(): BasicGeometryPrimitive {
    return this.#feature.primitive;
  }

  getSurfaceInfo(): BackendSurfaceInfo {
    return this.#feature.getSurfaceInfo();
  }

  debugSimulateDeviceLoss(): void {
    const simulate = this.#backend.debugSimulateDeviceLoss;
    if (simulate === undefined) {
      throw new KyxosEngineError('The selected backend does not provide Device Lost simulation.', {
        code: 'UNSUPPORTED_CAPABILITY',
        module: 'sdk',
        recoverable: false,
      });
    }
    simulate.call(this.#backend);
  }

  requestFrame(dirtyFlag: DirtyFlag = 'geometry'): void {
    this.invalidate(dirtyFlag);
  }

  resize(resize: BackendSurfaceResize): BackendSurfaceInfo {
    const info = this.#feature.resize(resize);
    this.invalidate('viewport');
    return info;
  }

  setClearColor(clearColor: BackendClearColor): void {
    this.#feature.setClearColor(clearColor);
    this.invalidate('material');
  }

  setPrimitive(primitive: BasicGeometryPrimitive): void {
    this.#feature.setPrimitive(primitive);
    this.invalidate('geometry');
  }

  async recover(): Promise<void> {
    await this.initialize();
    this.invalidate('geometry');
  }
}
