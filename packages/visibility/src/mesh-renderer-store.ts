import { KyxosEngineError } from '@kyxos/render-core';
import { createAabb } from '@kyxos/render-math';

import type { Disposable, Unsubscribe } from '@kyxos/render-core';
import type { MeshData } from '@kyxos/render-geometry';
import type { Aabb } from '@kyxos/render-math';
import type { EntityHandle, Scene } from '@kyxos/render-scene';

export type AlphaMode = 'blend' | 'opaque';

export interface MeshRendererDescriptor {
  readonly alphaMode?: AlphaMode;
  readonly enabled?: boolean;
  readonly localBounds?: Aabb;
  readonly materialKey?: string;
  readonly mesh: MeshData;
  readonly pipelineKey?: string;
  readonly renderOrder?: number;
}

export interface MeshRendererComponent {
  readonly alphaMode: AlphaMode;
  readonly enabled: boolean;
  readonly localBounds: Aabb;
  readonly materialKey: string;
  readonly mesh: MeshData;
  readonly pipelineKey: string;
  readonly renderOrder: number;
  readonly sequence: number;
}

export class MeshRendererStore implements Disposable {
  readonly #components = new Map<EntityHandle, MeshRendererComponent>();
  readonly #scene: Scene;
  readonly #unsubscribe: Unsubscribe;
  #disposed = false;
  #nextSequence = 1;
  #revision = 0;

  constructor(scene: Scene) {
    if (scene.disposed) throw this.#error('Cannot bind to a disposed Scene.', 'INVALID_ARGUMENT');
    this.#scene = scene;
    this.#unsubscribe = scene.on('changed', ({ kind }) => {
      if (kind === 'entity-destroyed' || kind === 'scene-cleared') this.#purgeStale();
    });
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  get revision(): number {
    return this.#revision;
  }

  get size(): number {
    return this.#components.size;
  }

  attach(entity: EntityHandle, descriptor: MeshRendererDescriptor): MeshRendererComponent {
    this.#assertActive();
    this.#assertEntity(entity);
    if (this.#components.has(entity)) {
      throw this.#error('Entity already has a Mesh Renderer.', 'INVALID_STATE');
    }
    const component = this.#createComponent(descriptor, this.#nextSequence);
    this.#nextSequence += 1;
    this.#components.set(entity, component);
    this.#scene.setLocalBounds(entity, component.localBounds);
    this.#revision += 1;
    return component;
  }

  update(entity: EntityHandle, descriptor: MeshRendererDescriptor): MeshRendererComponent {
    this.#assertActive();
    this.#assertEntity(entity);
    const previous = this.#components.get(entity);
    if (previous === undefined) {
      throw this.#error('Entity has no Mesh Renderer to update.', 'INVALID_STATE');
    }
    const component = this.#createComponent(descriptor, previous.sequence);
    this.#components.set(entity, component);
    this.#scene.setLocalBounds(entity, component.localBounds);
    this.#revision += 1;
    return component;
  }

  detach(entity: EntityHandle): boolean {
    this.#assertActive();
    if (!this.#components.delete(entity)) return false;
    if (this.#scene.hasEntity(entity)) this.#scene.setLocalBounds(entity, null);
    this.#revision += 1;
    return true;
  }

  componentOf(entity: EntityHandle): MeshRendererComponent | null {
    this.#assertActive();
    return this.#components.get(entity) ?? null;
  }

  entries(): readonly (readonly [EntityHandle, MeshRendererComponent])[] {
    this.#assertActive();
    return Object.freeze(
      [...this.#components.entries()].map(([entity, component]) =>
        Object.freeze([entity, component] as const),
      ),
    );
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#unsubscribe();
    const entities = [...this.#components.keys()];
    this.#components.clear();
    for (const entity of entities) {
      if (this.#scene.hasEntity(entity)) this.#scene.setLocalBounds(entity, null);
    }
  }

  #createComponent(descriptor: MeshRendererDescriptor, sequence: number): MeshRendererComponent {
    this.#validateMesh(descriptor.mesh);
    const materialKey = this.#nonemptyKey('materialKey', descriptor.materialKey ?? 'default');
    const pipelineKey = this.#nonemptyKey('pipelineKey', descriptor.pipelineKey ?? 'basic');
    const renderOrder = descriptor.renderOrder ?? 0;
    if (!Number.isSafeInteger(renderOrder)) {
      throw this.#error('renderOrder must be a safe integer.', 'INVALID_ARGUMENT');
    }
    const alphaMode = descriptor.alphaMode ?? 'opaque';
    if (alphaMode !== 'opaque' && alphaMode !== 'blend') {
      throw this.#error('alphaMode must be "opaque" or "blend".', 'INVALID_ARGUMENT');
    }
    const enabled = descriptor.enabled ?? true;
    if (typeof enabled !== 'boolean') {
      throw this.#error('enabled must be boolean.', 'INVALID_ARGUMENT');
    }
    const sourceBounds = descriptor.localBounds ?? descriptor.mesh.bounds;
    return Object.freeze({
      alphaMode,
      enabled,
      localBounds: createAabb(sourceBounds.min, sourceBounds.max),
      materialKey,
      mesh: descriptor.mesh,
      pipelineKey,
      renderOrder,
      sequence,
    });
  }

  #validateMesh(mesh: MeshData): void {
    if (
      !Object.isFrozen(mesh) ||
      !Number.isSafeInteger(mesh.vertexCount) ||
      mesh.vertexCount <= 0 ||
      !Number.isSafeInteger(mesh.indexCount) ||
      mesh.indexCount <= 0
    ) {
      throw this.#error('mesh must be a validated immutable MeshData value.', 'INVALID_ARGUMENT');
    }
  }

  #nonemptyKey(name: string, value: string): string {
    const result = value.trim();
    if (result.length === 0) throw this.#error(`${name} must not be empty.`, 'INVALID_ARGUMENT');
    return result;
  }

  #assertEntity(entity: EntityHandle): void {
    if (!this.#scene.hasEntity(entity)) {
      throw this.#error('Entity does not belong to the active Scene.', 'INVALID_ARGUMENT');
    }
  }

  #purgeStale(): void {
    let changed = false;
    for (const entity of this.#components.keys()) {
      if (!this.#scene.hasEntity(entity)) {
        this.#components.delete(entity);
        changed = true;
      }
    }
    if (changed) this.#revision += 1;
  }

  #assertActive(): void {
    if (this.#disposed) throw this.#error('Mesh Renderer Store is disposed.', 'ALREADY_DISPOSED');
  }

  #error(
    message: string,
    code: 'ALREADY_DISPOSED' | 'INVALID_ARGUMENT' | 'INVALID_STATE',
  ): KyxosEngineError {
    return new KyxosEngineError(message, { code, module: 'visibility', recoverable: false });
  }
}
