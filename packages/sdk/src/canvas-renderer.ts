import type {
  BackendClearColor,
  BackendSurfaceInfo,
  BackendSurfaceResize,
  GraphicsBackend,
} from '@kyxos/render-backend-api';
import type { DirtyFlag, FrameRequestDriver } from '@kyxos/render-frame-scheduler';
import { BasicGeometryFeature, KyxosRenderer } from '@kyxos/render-renderer';
import type { BasicGeometryPrimitive } from '@kyxos/render-renderer';

export interface KyxosCanvasRendererOptions {
  readonly backend: GraphicsBackend;
  readonly feature: BasicGeometryFeature;
  readonly frameDriver: FrameRequestDriver;
}

export class KyxosCanvasRenderer extends KyxosRenderer {
  readonly #feature: BasicGeometryFeature;

  constructor(options: KyxosCanvasRendererOptions) {
    super({ backend: options.backend, frameDriver: options.frameDriver });
    this.#feature = options.feature;
    this.registerRenderFeature(options.feature);
  }

  get primitive(): BasicGeometryPrimitive {
    return this.#feature.primitive;
  }

  getSurfaceInfo(): BackendSurfaceInfo {
    return this.#feature.getSurfaceInfo();
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
