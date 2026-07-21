import { HandleAllocator, KyxosEngineError, TypedEventEmitter } from '@kyxos/render-core';
import {
  composeTrsMat4,
  createAabb,
  identityMat4,
  mergeAabbs,
  multiplyMat4,
  transformAabb,
} from '@kyxos/render-math';

import { createLocalTransform, localTransformsEqual } from './transform.js';

import type { Disposable, EventListener, Handle, Unsubscribe } from '@kyxos/render-core';
import type { Aabb, Mat4 } from '@kyxos/render-math';
import type { LocalTransform, LocalTransformOptions } from './transform.js';

export type EntityHandle = Handle<'entity'>;

export type SceneChangeKind =
  | 'bounds'
  | 'entity-created'
  | 'entity-destroyed'
  | 'hierarchy'
  | 'layer-mask'
  | 'name'
  | 'scene-cleared'
  | 'transform'
  | 'visibility';

export interface SceneChangeEvent {
  readonly affectedEntityCount: number;
  readonly entity: EntityHandle | null;
  readonly kind: SceneChangeKind;
  readonly revision: number;
}

export interface SceneEvents {
  readonly changed: SceneChangeEvent;
}

export interface CreateEntityOptions {
  readonly layerMask?: number;
  readonly localBounds?: Aabb | null;
  readonly name?: string;
  readonly parent?: EntityHandle | null;
  readonly transform?: LocalTransformOptions;
  readonly visible?: boolean;
}

export interface SceneBoundsOptions {
  readonly layerMask?: number;
  readonly visibleOnly?: boolean;
}

export interface SceneDiagnostics {
  readonly dirtyTransformCount: number;
  readonly entityCount: number;
  readonly revision: number;
  readonly rootCount: number;
  readonly worldTransformUpdateCount: number;
}

interface EntityRecord {
  readonly children: Set<EntityHandle>;
  readonly handle: EntityHandle;
  layerMask: number;
  localBounds: Aabb | null;
  localMatrix: Mat4;
  localMatrixDirty: boolean;
  localTransform: LocalTransform;
  name: string;
  parent: EntityHandle | null;
  visible: boolean;
  worldBounds: Aabb | null;
  worldMatrix: Mat4;
  worldMatrixDirty: boolean;
}

const ALL_LAYERS = 0xffff_ffff;

export class Scene implements Disposable {
  readonly #allocator = new HandleAllocator('entity');
  readonly #events = new TypedEventEmitter<SceneEvents>();
  readonly #ownedHandles = new WeakSet<object>();
  readonly #records = new Map<EntityHandle, EntityRecord>();
  #disposed = false;
  #revision = 0;
  #worldTransformUpdateCount = 0;

  get disposed(): boolean {
    return this.#disposed;
  }

  get entityCount(): number {
    return this.#records.size;
  }

  get revision(): number {
    return this.#revision;
  }

  on<EventName extends keyof SceneEvents>(
    eventName: EventName,
    listener: EventListener<SceneEvents[EventName]>,
  ): Unsubscribe {
    this.#assertActive();
    return this.#events.on(eventName, listener);
  }

  createEntity(options: CreateEntityOptions = {}): EntityHandle {
    this.#assertActive();
    const parentRecord =
      options.parent === undefined || options.parent === null
        ? null
        : this.#requireRecord(options.parent);
    const handle = this.#allocator.create();
    const name = this.#validateName(options.name ?? `Entity ${handle.id}`);
    const localTransform = createLocalTransform(options.transform);
    const localBounds = this.#copyBounds(options.localBounds ?? null);
    const layerMask = this.#validateLayerMask(options.layerMask ?? ALL_LAYERS);
    const record: EntityRecord = {
      children: new Set(),
      handle,
      layerMask,
      localBounds,
      localMatrix: composeTrsMat4(
        localTransform.translation,
        localTransform.rotation,
        localTransform.scale,
      ),
      localMatrixDirty: false,
      localTransform,
      name,
      parent: parentRecord?.handle ?? null,
      visible: options.visible ?? true,
      worldBounds: null,
      worldMatrix: identityMat4(),
      worldMatrixDirty: true,
    };
    this.#ownedHandles.add(handle);
    this.#records.set(handle, record);
    parentRecord?.children.add(handle);
    this.#emitChange('entity-created', handle, 1);
    return handle;
  }

  hasEntity(entity: EntityHandle): boolean {
    return this.#records.has(entity);
  }

  nameOf(entity: EntityHandle): string {
    return this.#requireRecord(entity).name;
  }

  setName(entity: EntityHandle, name: string): void {
    const record = this.#requireRecord(entity);
    const validated = this.#validateName(name);
    if (record.name === validated) return;
    record.name = validated;
    this.#emitChange('name', entity, 1);
  }

  parentOf(entity: EntityHandle): EntityHandle | null {
    return this.#requireRecord(entity).parent;
  }

  childrenOf(entity: EntityHandle): readonly EntityHandle[] {
    return Object.freeze([...this.#requireRecord(entity).children]);
  }

  roots(): readonly EntityHandle[] {
    this.#assertActive();
    return Object.freeze(
      [...this.#records.values()]
        .filter(({ parent }) => parent === null)
        .map(({ handle }) => handle),
    );
  }

  setParent(entity: EntityHandle, parent: EntityHandle | null): void {
    const record = this.#requireRecord(entity);
    const parentRecord = parent === null ? null : this.#requireRecord(parent);
    if (record.parent === parent) return;
    let ancestor = parentRecord;
    while (ancestor !== null) {
      if (ancestor.handle === entity) {
        throw this.#error(
          'Cannot parent an entity to itself or one of its descendants.',
          'INVALID_ARGUMENT',
        );
      }
      ancestor = ancestor.parent === null ? null : this.#requireRecord(ancestor.parent);
    }
    if (record.parent !== null) this.#requireRecord(record.parent).children.delete(entity);
    record.parent = parent;
    parentRecord?.children.add(entity);
    const affected = this.#markWorldDirty(record);
    this.#emitChange('hierarchy', entity, affected);
  }

  localTransformOf(entity: EntityHandle): LocalTransform {
    return this.#requireRecord(entity).localTransform;
  }

  setLocalTransform(entity: EntityHandle, transform: LocalTransformOptions): void {
    const record = this.#requireRecord(entity);
    const next = createLocalTransform({
      rotation: transform.rotation ?? record.localTransform.rotation,
      scale: transform.scale ?? record.localTransform.scale,
      translation: transform.translation ?? record.localTransform.translation,
    });
    if (localTransformsEqual(record.localTransform, next)) return;
    record.localTransform = next;
    record.localMatrixDirty = true;
    const affected = this.#markWorldDirty(record);
    this.#emitChange('transform', entity, affected);
  }

  worldMatrixOf(entity: EntityHandle): Mat4 {
    const record = this.#requireRecord(entity);
    this.#ensureWorldMatrix(record);
    return record.worldMatrix;
  }

  updateWorldTransforms(): number {
    this.#assertActive();
    const before = this.#worldTransformUpdateCount;
    for (const record of this.#records.values()) this.#ensureWorldMatrix(record);
    return this.#worldTransformUpdateCount - before;
  }

  visibleOf(entity: EntityHandle): boolean {
    return this.#requireRecord(entity).visible;
  }

  setVisible(entity: EntityHandle, visible: boolean): void {
    const record = this.#requireRecord(entity);
    if (record.visible === visible) return;
    record.visible = visible;
    this.#emitChange('visibility', entity, this.#subtreeSize(record));
  }

  isWorldVisible(entity: EntityHandle): boolean {
    let record: EntityRecord | null = this.#requireRecord(entity);
    while (record !== null) {
      if (!record.visible) return false;
      record = record.parent === null ? null : this.#requireRecord(record.parent);
    }
    return true;
  }

  layerMaskOf(entity: EntityHandle): number {
    return this.#requireRecord(entity).layerMask;
  }

  setLayerMask(entity: EntityHandle, layerMask: number): void {
    const record = this.#requireRecord(entity);
    const validated = this.#validateLayerMask(layerMask);
    if (record.layerMask === validated) return;
    record.layerMask = validated;
    this.#emitChange('layer-mask', entity, 1);
  }

  localBoundsOf(entity: EntityHandle): Aabb | null {
    return this.#requireRecord(entity).localBounds;
  }

  setLocalBounds(entity: EntityHandle, bounds: Aabb | null): void {
    const record = this.#requireRecord(entity);
    record.localBounds = this.#copyBounds(bounds);
    record.worldBounds = null;
    this.#emitChange('bounds', entity, 1);
  }

  worldBoundsOf(entity: EntityHandle): Aabb | null {
    const record = this.#requireRecord(entity);
    if (record.localBounds === null) return null;
    this.#ensureWorldMatrix(record);
    record.worldBounds ??= transformAabb(record.localBounds, record.worldMatrix);
    return record.worldBounds;
  }

  calculateWorldBounds(options: SceneBoundsOptions = {}): Aabb | null {
    this.#assertActive();
    const visibleOnly = options.visibleOnly ?? true;
    const layerMask = this.#validateLayerMask(options.layerMask ?? ALL_LAYERS);
    let result: Aabb | null = null;
    for (const record of this.#records.values()) {
      if ((record.layerMask & layerMask) === 0) continue;
      if (visibleOnly && !this.isWorldVisible(record.handle)) continue;
      const bounds = this.worldBoundsOf(record.handle);
      if (bounds !== null) result = result === null ? bounds : mergeAabbs(result, bounds);
    }
    return result;
  }

  diagnostics(): SceneDiagnostics {
    this.#assertActive();
    let dirtyTransformCount = 0;
    let rootCount = 0;
    for (const record of this.#records.values()) {
      if (record.worldMatrixDirty) dirtyTransformCount += 1;
      if (record.parent === null) rootCount += 1;
    }
    return Object.freeze({
      dirtyTransformCount,
      entityCount: this.#records.size,
      revision: this.#revision,
      rootCount,
      worldTransformUpdateCount: this.#worldTransformUpdateCount,
    });
  }

  destroyEntity(entity: EntityHandle): number {
    this.#assertActive();
    if (!this.#ownedHandles.has(entity)) {
      throw this.#error('Entity belongs to a different Scene.', 'INVALID_ARGUMENT');
    }
    const root = this.#records.get(entity);
    if (root === undefined) return 0;
    if (root.parent !== null) this.#requireRecord(root.parent).children.delete(entity);
    const records = this.#collectSubtree(root);
    for (let index = records.length - 1; index >= 0; index -= 1) {
      this.#records.delete((records[index] as EntityRecord).handle);
    }
    this.#emitChange('entity-destroyed', entity, records.length);
    return records.length;
  }

  clear(): number {
    this.#assertActive();
    const count = this.#records.size;
    if (count === 0) return 0;
    this.#records.clear();
    this.#emitChange('scene-cleared', null, count);
    return count;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#records.clear();
    this.#events.dispose();
  }

  #assertActive(): void {
    if (this.#disposed) throw this.#error('Scene is disposed.', 'ALREADY_DISPOSED');
  }

  #requireRecord(entity: EntityHandle): EntityRecord {
    this.#assertActive();
    if (!this.#ownedHandles.has(entity)) {
      throw this.#error('Entity belongs to a different Scene.', 'INVALID_ARGUMENT');
    }
    const record = this.#records.get(entity);
    if (record === undefined) throw this.#error('Entity no longer exists.', 'INVALID_STATE');
    return record;
  }

  #copyBounds(bounds: Aabb | null): Aabb | null {
    return bounds === null ? null : createAabb(bounds.min, bounds.max);
  }

  #validateName(name: string): string {
    const result = name.trim();
    if (result.length === 0) {
      throw this.#error('Entity name must not be empty.', 'INVALID_ARGUMENT');
    }
    return result;
  }

  #validateLayerMask(layerMask: number): number {
    if (!Number.isInteger(layerMask) || layerMask < 0 || layerMask > ALL_LAYERS) {
      throw this.#error('Layer mask must be an unsigned 32-bit integer.', 'INVALID_ARGUMENT');
    }
    return layerMask >>> 0;
  }

  #markWorldDirty(root: EntityRecord): number {
    const stack = [root];
    let affected = 0;
    while (stack.length > 0) {
      const record = stack.pop() as EntityRecord;
      record.worldMatrixDirty = true;
      record.worldBounds = null;
      affected += 1;
      for (const child of record.children) stack.push(this.#requireRecord(child));
    }
    return affected;
  }

  #ensureWorldMatrix(target: EntityRecord): void {
    if (!target.worldMatrixDirty) return;
    const chain: EntityRecord[] = [];
    let current: EntityRecord | null = target;
    while (current !== null && current.worldMatrixDirty) {
      chain.push(current);
      current = current.parent === null ? null : this.#requireRecord(current.parent);
    }
    for (let index = chain.length - 1; index >= 0; index -= 1) {
      const record = chain[index] as EntityRecord;
      if (record.localMatrixDirty) {
        record.localMatrix = composeTrsMat4(
          record.localTransform.translation,
          record.localTransform.rotation,
          record.localTransform.scale,
        );
        record.localMatrixDirty = false;
      }
      const parentWorld =
        record.parent === null ? null : this.#requireRecord(record.parent).worldMatrix;
      record.worldMatrix =
        parentWorld === null ? record.localMatrix : multiplyMat4(parentWorld, record.localMatrix);
      record.worldMatrixDirty = false;
      record.worldBounds = null;
      this.#worldTransformUpdateCount += 1;
    }
  }

  #collectSubtree(root: EntityRecord): EntityRecord[] {
    const result: EntityRecord[] = [];
    const stack = [root];
    while (stack.length > 0) {
      const record = stack.pop() as EntityRecord;
      result.push(record);
      for (const child of record.children) stack.push(this.#requireRecord(child));
    }
    return result;
  }

  #subtreeSize(root: EntityRecord): number {
    return this.#collectSubtree(root).length;
  }

  #emitChange(
    kind: SceneChangeKind,
    entity: EntityHandle | null,
    affectedEntityCount: number,
  ): void {
    this.#revision += 1;
    this.#events.emit(
      'changed',
      Object.freeze({ affectedEntityCount, entity, kind, revision: this.#revision }),
    );
  }

  #error(
    message: string,
    code: 'ALREADY_DISPOSED' | 'INVALID_ARGUMENT' | 'INVALID_STATE',
  ): KyxosEngineError {
    return new KyxosEngineError(message, { code, module: 'scene', recoverable: false });
  }
}
