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
import type {
  DirtyFlag,
  FrameRequestDriver,
  FrameSchedulerController,
} from '@kyxos/render-frame-scheduler';
import type { PbrOutputTransform, PbrOutputTransformDescriptor } from '@kyxos/render-material-pbr';
import {
  KyxosRenderer,
  PbrMaterialLibrary,
  PbrRenderFeature,
  PbrTextureLibrary,
} from '@kyxos/render-renderer';
import type {
  PbrDirectionalLightDescriptor,
  PbrEnvironmentDescriptor,
  PbrEnvironmentState,
  PbrRenderFeatureDiagnostics,
  RendererDiagnostics,
} from '@kyxos/render-renderer';
import type { Scene, SceneDiagnostics } from '@kyxos/render-scene';
import type { BuildRenderQueuesOptions, MeshRendererStore } from '@kyxos/render-visibility';

interface KyxosPbrCanvasRendererSharedOptions {
  readonly backend: GraphicsBackend;
  readonly camera: PerspectiveCamera;
  readonly feature: PbrRenderFeature;
  readonly materials: PbrMaterialLibrary;
  readonly meshRenderers: MeshRendererStore;
  readonly orbitController: OrbitController;
  readonly scene: Scene;
  readonly textures: PbrTextureLibrary;
}

export type KyxosPbrCanvasRendererOptions = KyxosPbrCanvasRendererSharedOptions &
  (
    | {
        readonly frameDriver: FrameRequestDriver;
        readonly frameScheduler?: never;
      }
    | {
        readonly frameDriver?: never;
        readonly frameScheduler: FrameSchedulerController;
      }
  );

export interface KyxosPbrRendererDiagnostics {
  readonly camera: ReturnType<PerspectiveCamera['diagnostics']>;
  readonly feature: PbrRenderFeatureDiagnostics;
  readonly materials: ReturnType<PbrMaterialLibrary['diagnostics']>;
  readonly meshRenderers: {
    readonly revision: number;
    readonly size: number;
  };
  readonly orbit: ReturnType<OrbitController['state']>;
  readonly renderer: RendererDiagnostics;
  readonly scene: SceneDiagnostics;
  readonly textures: ReturnType<PbrTextureLibrary['diagnostics']>;
}

/** Public SDK lifecycle wrapper for the independent Phase 3 PBR Render Feature. */
export class KyxosPbrCanvasRenderer extends KyxosRenderer {
  readonly #backend: GraphicsBackend;
  readonly #feature: PbrRenderFeature;
  readonly #subscriptions = new DisposeBag();
  readonly camera: PerspectiveCamera;
  readonly materials: PbrMaterialLibrary;
  readonly meshRenderers: MeshRendererStore;
  readonly orbitController: OrbitController;
  readonly scene: Scene;
  readonly textures: PbrTextureLibrary;

  constructor(options: KyxosPbrCanvasRendererOptions) {
    super(
      options.frameScheduler === undefined
        ? { backend: options.backend, frameDriver: options.frameDriver }
        : { backend: options.backend, frameScheduler: options.frameScheduler },
    );
    this.#backend = options.backend;
    this.#feature = options.feature;
    this.camera = options.camera;
    this.materials = options.materials;
    this.meshRenderers = options.meshRenderers;
    this.orbitController = options.orbitController;
    this.scene = options.scene;
    this.textures = options.textures;
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
    this.#subscriptions.add(
      this.materials.on('changed', () => this.#invalidateWhenReady('material')),
    );
    this.#subscriptions.add(
      this.textures.on('changed', () => this.#invalidateWhenReady('texture')),
    );
  }

  get environment(): PbrEnvironmentState {
    return this.#feature.environment;
  }

  get output(): PbrOutputTransform {
    return this.#feature.output;
  }

  getSurfaceInfo(): BackendSurfaceInfo {
    return this.#feature.getSurfaceInfo();
  }

  getPbrDiagnostics(): KyxosPbrRendererDiagnostics {
    return Object.freeze({
      camera: this.camera.diagnostics(),
      feature: this.#feature.getDiagnostics(),
      materials: this.materials.diagnostics(),
      meshRenderers: Object.freeze({
        revision: this.meshRenderers.revision,
        size: this.meshRenderers.size,
      }),
      orbit: this.orbitController.state(),
      renderer: this.getDiagnostics(),
      scene: this.scene.diagnostics(),
      textures: this.textures.diagnostics(),
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

  requestFrame(dirtyFlag: DirtyFlag = 'material'): void {
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

  setEnvironment(descriptor: PbrEnvironmentDescriptor): PbrEnvironmentState {
    const state = this.#feature.setEnvironment(descriptor);
    this.#invalidateWhenReady('environment');
    return state;
  }

  setLight(descriptor: PbrDirectionalLightDescriptor): void {
    this.#feature.setLight(descriptor);
    this.#invalidateWhenReady('light');
  }

  setOutputTransform(descriptor: PbrOutputTransformDescriptor): PbrOutputTransform {
    const state = this.#feature.setOutputTransform(descriptor);
    this.#invalidateWhenReady('post-process');
    return state;
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
      () => this.materials.dispose(),
      () => this.textures.dispose(),
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
      throw new AggregateError(errors, 'PBR Canvas Renderer disposal failed.');
    }
  }

  #invalidateWhenReady(dirtyFlag: DirtyFlag): void {
    if (this.state === 'ready') this.invalidate(dirtyFlag);
  }
}
