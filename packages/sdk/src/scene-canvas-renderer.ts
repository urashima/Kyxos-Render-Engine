import type {
  BackendClearColor,
  BackendSurfaceInfo,
  BackendSurfaceResize,
  GraphicsBackend,
} from '@kyxos/render-backend-api';
import type {
  CameraFitResult,
  FrameSceneOptions,
  OrbitController,
  PerspectiveCamera,
} from '@kyxos/render-camera';
import { DisposeBag, KyxosEngineError } from '@kyxos/render-core';
import type { DirtyFlag, FrameRequestDriver } from '@kyxos/render-frame-scheduler';
import { KyxosRenderer } from '@kyxos/render-renderer';
import type {
  RendererDiagnostics,
  SceneRenderFeature,
  SceneRenderFeatureDiagnostics,
} from '@kyxos/render-renderer';
import type { Scene, SceneDiagnostics } from '@kyxos/render-scene';
import type { BuildRenderQueuesOptions, MeshRendererStore } from '@kyxos/render-visibility';

export interface KyxosSceneCanvasRendererOptions {
  readonly backend: GraphicsBackend;
  readonly camera: PerspectiveCamera;
  readonly feature: SceneRenderFeature;
  readonly frameDriver: FrameRequestDriver;
  readonly meshRenderers: MeshRendererStore;
  readonly orbitController: OrbitController;
  readonly scene: Scene;
}

export interface KyxosSceneRendererDiagnostics {
  readonly camera: ReturnType<PerspectiveCamera['diagnostics']>;
  readonly feature: SceneRenderFeatureDiagnostics;
  readonly meshRenderers: {
    readonly revision: number;
    readonly size: number;
  };
  readonly orbit: ReturnType<OrbitController['state']>;
  readonly renderer: RendererDiagnostics;
  readonly scene: SceneDiagnostics;
}

export class KyxosSceneCanvasRenderer extends KyxosRenderer {
  readonly #backend: GraphicsBackend;
  readonly #feature: SceneRenderFeature;
  readonly #subscriptions = new DisposeBag();
  readonly camera: PerspectiveCamera;
  readonly meshRenderers: MeshRendererStore;
  readonly orbitController: OrbitController;
  readonly scene: Scene;

  constructor(options: KyxosSceneCanvasRendererOptions) {
    super({ backend: options.backend, frameDriver: options.frameDriver });
    this.#backend = options.backend;
    this.#feature = options.feature;
    this.camera = options.camera;
    this.meshRenderers = options.meshRenderers;
    this.orbitController = options.orbitController;
    this.scene = options.scene;
    this.registerRenderFeature(options.feature);
    this.#subscriptions.add(
      this.scene.on('changed', ({ kind }) => {
        if (kind === 'name') return;
        this.#invalidateWhenReady(
          kind === 'transform' || kind === 'hierarchy' ? 'transform' : 'geometry',
        );
      }),
    );
    this.#subscriptions.add(this.camera.on('changed', () => this.#invalidateWhenReady('camera')));
    this.#subscriptions.add(
      this.meshRenderers.on('changed', () => this.#invalidateWhenReady('geometry')),
    );
  }

  getSurfaceInfo(): BackendSurfaceInfo {
    return this.#feature.getSurfaceInfo();
  }

  getSceneDiagnostics(): KyxosSceneRendererDiagnostics {
    return Object.freeze({
      camera: this.camera.diagnostics(),
      feature: this.#feature.getDiagnostics(),
      meshRenderers: Object.freeze({
        revision: this.meshRenderers.revision,
        size: this.meshRenderers.size,
      }),
      orbit: this.orbitController.state(),
      renderer: this.getDiagnostics(),
      scene: this.scene.diagnostics(),
    });
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

  dolly(scale: number): void {
    this.orbitController.dolly(scale);
    this.orbitController.applyTo(this.camera);
  }

  frameScene(options: FrameSceneOptions = {}): CameraFitResult | null {
    const bounds = this.scene.calculateWorldBounds(options.bounds);
    if (bounds === null) return null;
    return this.orbitController.fitBounds(this.camera, bounds, options.fit);
  }

  orbit(deltaYawRadians: number, deltaPitchRadians: number): void {
    this.orbitController.orbit(deltaYawRadians, deltaPitchRadians);
    this.orbitController.applyTo(this.camera);
  }

  pan(rightDistance: number, upDistance: number): void {
    this.orbitController.pan(rightDistance, upDistance);
    this.orbitController.applyTo(this.camera);
  }

  requestFrame(dirtyFlag: DirtyFlag = 'geometry'): void {
    this.invalidate(dirtyFlag);
  }

  resize(resize: BackendSurfaceResize): BackendSurfaceInfo {
    const info = this.#feature.resize(resize);
    this.#invalidateWhenReady('viewport');
    return info;
  }

  setClearColor(clearColor: BackendClearColor): void {
    this.#feature.setClearColor(clearColor);
    this.#invalidateWhenReady('material');
  }

  setVisibilityOptions(options: BuildRenderQueuesOptions): void {
    this.#feature.setVisibilityOptions(options);
    this.#invalidateWhenReady('geometry');
  }

  async recover(): Promise<void> {
    await this.initialize();
    this.invalidate('geometry');
  }

  override dispose(): void {
    if (this.disposed) return;
    const errors: unknown[] = [];
    for (const dispose of [
      () => this.#subscriptions.dispose(),
      () => super.dispose(),
      () => this.meshRenderers.dispose(),
      () => this.camera.dispose(),
      () => this.scene.dispose(),
    ]) {
      try {
        dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(errors, 'Scene Canvas Renderer disposal failed.');
    }
  }

  #invalidateWhenReady(dirtyFlag: DirtyFlag): void {
    if (this.state === 'ready') this.invalidate(dirtyFlag);
  }
}
