import { aabbCenter, distanceVec3, frustumIntersectsAabb } from '@kyxos/render-math';

import type { PerspectiveCamera } from '@kyxos/render-camera';
import type { MeshData } from '@kyxos/render-geometry';
import type { Aabb, Mat4 } from '@kyxos/render-math';
import type { EntityHandle, Scene } from '@kyxos/render-scene';
import type { AlphaMode, MeshRendererComponent, MeshRendererStore } from './mesh-renderer-store.js';

export interface RenderItem {
  readonly alphaMode: AlphaMode;
  readonly distanceToCamera: number;
  readonly entity: EntityHandle;
  readonly materialKey: string;
  readonly mesh: MeshData;
  readonly pipelineKey: string;
  readonly renderOrder: number;
  readonly sequence: number;
  readonly worldBounds: Aabb;
  readonly worldMatrix: Mat4;
}

export interface VisibilityDiagnostics {
  readonly disabledCount: number;
  readonly frustumCulledCount: number;
  readonly hiddenCount: number;
  readonly layerCulledCount: number;
  readonly opaqueCount: number;
  readonly totalCount: number;
  readonly transparentCount: number;
  readonly visibleCount: number;
}

export interface RenderQueues {
  readonly cameraRevision: number;
  readonly diagnostics: VisibilityDiagnostics;
  readonly opaque: readonly RenderItem[];
  readonly sceneRevision: number;
  readonly storeRevision: number;
  readonly transparent: readonly RenderItem[];
}

export interface BuildRenderQueuesOptions {
  readonly cameraLayerMask?: number;
  readonly frustumCulling?: boolean;
}

interface CacheState {
  readonly camera: PerspectiveCamera;
  readonly cameraLayerMask: number;
  readonly cameraRevision: number;
  readonly frustumCulling: boolean;
  readonly result: RenderQueues;
  readonly scene: Scene;
  readonly sceneRevision: number;
  readonly store: MeshRendererStore;
  readonly storeRevision: number;
}

const ALL_LAYERS = 0xffff_ffff;

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareOpaque(left: RenderItem, right: RenderItem): number {
  return (
    left.renderOrder - right.renderOrder ||
    compareStrings(left.pipelineKey, right.pipelineKey) ||
    compareStrings(left.materialKey, right.materialKey) ||
    left.distanceToCamera - right.distanceToCamera ||
    left.sequence - right.sequence
  );
}

function compareTransparent(left: RenderItem, right: RenderItem): number {
  return (
    left.renderOrder - right.renderOrder ||
    right.distanceToCamera - left.distanceToCamera ||
    compareStrings(left.pipelineKey, right.pipelineKey) ||
    compareStrings(left.materialKey, right.materialKey) ||
    left.sequence - right.sequence
  );
}

export class VisibilitySystem {
  #cache: CacheState | null = null;

  build(
    scene: Scene,
    camera: PerspectiveCamera,
    store: MeshRendererStore,
    options: BuildRenderQueuesOptions = {},
  ): RenderQueues {
    const cameraLayerMask = this.#layerMask(options.cameraLayerMask ?? ALL_LAYERS);
    const frustumCulling = options.frustumCulling ?? true;
    const cache = this.#cache;
    if (
      cache !== null &&
      cache.scene === scene &&
      cache.camera === camera &&
      cache.store === store &&
      cache.sceneRevision === scene.revision &&
      cache.cameraRevision === camera.revision &&
      cache.storeRevision === store.revision &&
      cache.cameraLayerMask === cameraLayerMask &&
      cache.frustumCulling === frustumCulling
    ) {
      return cache.result;
    }

    const opaque: RenderItem[] = [];
    const transparent: RenderItem[] = [];
    let disabledCount = 0;
    let hiddenCount = 0;
    let layerCulledCount = 0;
    let frustumCulledCount = 0;
    const frustum = camera.frustum();

    for (const [entity, component] of store.entries()) {
      if (!component.enabled) {
        disabledCount += 1;
        continue;
      }
      if (!scene.isWorldVisible(entity)) {
        hiddenCount += 1;
        continue;
      }
      if ((scene.layerMaskOf(entity) & cameraLayerMask) === 0) {
        layerCulledCount += 1;
        continue;
      }
      const worldBounds = scene.worldBoundsOf(entity);
      if (worldBounds === null) continue;
      if (frustumCulling && !frustumIntersectsAabb(frustum, worldBounds)) {
        frustumCulledCount += 1;
        continue;
      }
      const item = this.#createItem(entity, component, worldBounds, scene, camera);
      if (item.alphaMode === 'blend') transparent.push(item);
      else opaque.push(item);
    }

    opaque.sort(compareOpaque);
    transparent.sort(compareTransparent);
    const diagnostics = Object.freeze({
      disabledCount,
      frustumCulledCount,
      hiddenCount,
      layerCulledCount,
      opaqueCount: opaque.length,
      totalCount: store.size,
      transparentCount: transparent.length,
      visibleCount: opaque.length + transparent.length,
    });
    const result = Object.freeze({
      cameraRevision: camera.revision,
      diagnostics,
      opaque: Object.freeze(opaque),
      sceneRevision: scene.revision,
      storeRevision: store.revision,
      transparent: Object.freeze(transparent),
    });
    this.#cache = {
      camera,
      cameraLayerMask,
      cameraRevision: camera.revision,
      frustumCulling,
      result,
      scene,
      sceneRevision: scene.revision,
      store,
      storeRevision: store.revision,
    };
    return result;
  }

  clearCache(): void {
    this.#cache = null;
  }

  #createItem(
    entity: EntityHandle,
    component: MeshRendererComponent,
    worldBounds: Aabb,
    scene: Scene,
    camera: PerspectiveCamera,
  ): RenderItem {
    return Object.freeze({
      alphaMode: component.alphaMode,
      distanceToCamera: distanceVec3(camera.position, aabbCenter(worldBounds)),
      entity,
      materialKey: component.materialKey,
      mesh: component.mesh,
      pipelineKey: component.pipelineKey,
      renderOrder: component.renderOrder,
      sequence: component.sequence,
      worldBounds,
      worldMatrix: scene.worldMatrixOf(entity),
    });
  }

  #layerMask(value: number): number {
    if (!Number.isInteger(value) || value < 0 || value > ALL_LAYERS) {
      throw new RangeError('cameraLayerMask must be an unsigned 32-bit integer.');
    }
    return value >>> 0;
  }
}
