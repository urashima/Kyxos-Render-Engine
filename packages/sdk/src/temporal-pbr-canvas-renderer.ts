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
import type { DirtyFlag, FrameActivity } from '@kyxos/render-frame-scheduler';
import { TemporalFrameScheduler } from '@kyxos/render-frame-scheduler';
import type { PbrOutputTransform, PbrOutputTransformDescriptor } from '@kyxos/render-material-pbr';
import {
  KyxosRenderer,
  PbrMaterialLibrary,
  PbrTextureLibrary,
  TemporalPbrRenderFeature,
} from '@kyxos/render-renderer';
import type {
  PbrDirectionalLightDescriptor,
  PbrEnvironmentDescriptor,
  PbrEnvironmentState,
  RendererDiagnostics,
  TemporalPbrRenderFeatureDiagnostics,
} from '@kyxos/render-renderer';
import type { Scene, SceneDiagnostics } from '@kyxos/render-scene';
import type { BuildRenderQueuesOptions, MeshRendererStore } from '@kyxos/render-visibility';

export interface TemporalPbrRevisionState {
  device: number;
  environment: number;
  lighting: number;
  postProcess: number;
  viewport: number;
}

export interface KyxosTemporalPbrCanvasRendererOptions {
  readonly backend: GraphicsBackend;
  readonly camera: PerspectiveCamera;
  readonly feature: TemporalPbrRenderFeature;
  readonly materials: PbrMaterialLibrary;
  readonly meshRenderers: MeshRendererStore;
  readonly orbitController: OrbitController;
  readonly revisions: TemporalPbrRevisionState;
  readonly scene: Scene;
  readonly scheduler: TemporalFrameScheduler;
  readonly textures: PbrTextureLibrary;
}

export interface KyxosTemporalPbrRendererDiagnostics {
  readonly camera: ReturnType<PerspectiveCamera['diagnostics']>;
  readonly feature: TemporalPbrRenderFeatureDiagnostics;
  readonly materials: ReturnType<PbrMaterialLibrary['diagnostics']>;
  readonly meshRenderers: {
    readonly revision: number;
    readonly size: number;
  };
  readonly orbit: ReturnType<OrbitController['state']>;
  readonly renderer: RendererDiagnostics;
  readonly scene: SceneDiagnostics;
  readonly scheduler: ReturnType<TemporalFrameScheduler['getDiagnostics']>;
  readonly textures: ReturnType<PbrTextureLibrary['diagnostics']>;
}

/** Public SDK lifecycle wrapper for the Phase 4 Scheduler-driven temporal PBR pipeline. */
export class KyxosTemporalPbrCanvasRenderer extends KyxosRenderer {
  readonly #backend: GraphicsBackend;
  readonly #feature: TemporalPbrRenderFeature;
  readonly #revisions: TemporalPbrRevisionState;
  readonly #scheduler: TemporalFrameScheduler;
  readonly #subscriptions = new DisposeBag();
  readonly camera: PerspectiveCamera;
  readonly materials: PbrMaterialLibrary;
  readonly meshRenderers: MeshRendererStore;
  readonly orbitController: OrbitController;
  readonly scene: Scene;
  readonly textures: PbrTextureLibrary;

  constructor(options: KyxosTemporalPbrCanvasRendererOptions) {
    super({ backend: options.backend, frameScheduler: options.scheduler });
    this.#backend = options.backend;
    this.#feature = options.feature;
    this.#revisions = options.revisions;
    this.#scheduler = options.scheduler;
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
    this.#subscriptions.add(
      this.on('device-lost', () => {
        this.#revisions.device += 1;
      }),
    );
  }

  get environment(): PbrEnvironmentState {
    return this.#feature.pbr.environment;
  }

  get output(): PbrOutputTransform {
    return this.#feature.pbr.output;
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

  getSurfaceInfo(): BackendSurfaceInfo {
    return this.#feature.getSurfaceInfo();
  }

  getTemporalDiagnostics(): KyxosTemporalPbrRendererDiagnostics {
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
      scheduler: this.#scheduler.getDiagnostics(),
      textures: this.textures.diagnostics(),
    });
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

  resetTemporalHistory(dirtyFlag: DirtyFlag = 'accumulation'): void {
    this.invalidate(dirtyFlag);
  }

  resize(resize: BackendSurfaceResize): BackendSurfaceInfo {
    const info = this.#feature.resize(resize);
    this.#revisions.viewport += 1;
    this.#invalidateWhenReady('viewport');
    return info;
  }

  setActivity(activity: FrameActivity, active: boolean, dirtyFlag: DirtyFlag = 'accumulation'): void {
    this.#scheduler.setActivity(activity, active, dirtyFlag);
  }

  setClearColor(clearColor: BackendClearColor): void {
    this.#feature.pbr.setClearColor(clearColor);
    this.#revisions.postProcess += 1;
    this.#invalidateWhenReady('post-process');
  }

  setEnvironment(descriptor: PbrEnvironmentDescriptor): PbrEnvironmentState {
    const state = this.#feature.pbr.setEnvironment(descriptor);
    this.#revisions.environment += 1;
    this.#invalidateWhenReady('environment');
    return state;
  }

  setLight(descriptor: PbrDirectionalLightDescriptor): void {
    this.#feature.pbr.setLight(descriptor);
    this.#revisions.lighting += 1;
    this.#invalidateWhenReady('light');
  }

  setOutputTransform(descriptor: PbrOutputTransformDescriptor): PbrOutputTransform {
    const state = this.#feature.pbr.setOutputTransform(descriptor);
    this.#revisions.postProcess += 1;
    this.#invalidateWhenReady('post-process');
    return state;
  }

  setVisibilityOptions(options: BuildRenderQueuesOptions): void {
    this.#feature.pbr.setVisibilityOptions(options);
    this.#invalidateWhenReady('geometry');
  }

  suspendTemporal(): void {
    this.#scheduler.suspend();
  }

  async recover(): Promise<void> {
    await this.initialize();
    this.invalidate('accumulation');
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
      throw new AggregateError(errors, 'Temporal PBR Canvas Renderer disposal failed.');
    }
  }

  #invalidateWhenReady(dirtyFlag: DirtyFlag): void {
    if (this.state === 'ready') this.invalidate(dirtyFlag);
  }
}
