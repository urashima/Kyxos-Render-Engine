import { KyxosEngineError, TypedEventEmitter } from '@kyxos/render-core';
import {
  createLinearRgb,
  createLinearRgba,
  createMaterialFeatureKey,
  createMaterialTextureBinding,
  materialTextureBindingKey,
  materialTextureSemanticInfo,
} from '@kyxos/render-material-core';

import type { Disposable, EventListener, Unsubscribe } from '@kyxos/render-core';
import type { MaterialTextureBinding, RgbColor, RgbaColor } from '@kyxos/render-material-core';

export const PBR_TEXTURE_SLOTS = [
  'base-color',
  'emissive',
  'metallic-roughness',
  'normal',
  'occlusion',
] as const;

export type PbrTextureSlot = (typeof PBR_TEXTURE_SLOTS)[number];
export type PbrAlphaMode = 'blend' | 'mask' | 'opaque';
export type PbrTextureBindings = Readonly<Record<PbrTextureSlot, MaterialTextureBinding | null>>;
export interface PbrMaterialFeatureDescriptor {
  readonly alphaMode: PbrAlphaMode;
  readonly doubleSided: boolean;
  readonly normalMap: boolean;
}
export type PbrMaterialChangeField =
  | 'alphaCutoff'
  | 'alphaMode'
  | 'baseColorFactor'
  | 'doubleSided'
  | 'emissiveFactor'
  | 'emissiveStrength'
  | 'metallicFactor'
  | 'name'
  | 'normalScale'
  | 'occlusionStrength'
  | 'roughnessFactor'
  | `texture:${PbrTextureSlot}`;

export interface PbrMaterialDescriptor {
  readonly alphaCutoff?: number;
  readonly alphaMode?: PbrAlphaMode;
  readonly baseColorFactor?: RgbaColor;
  readonly doubleSided?: boolean;
  readonly emissiveFactor?: RgbColor;
  readonly emissiveStrength?: number;
  readonly metallicFactor?: number;
  readonly name?: string;
  readonly normalScale?: number;
  readonly occlusionStrength?: number;
  readonly roughnessFactor?: number;
  readonly textures?: Partial<Record<PbrTextureSlot, MaterialTextureBinding | null>>;
}

export type PbrMaterialPatch = PbrMaterialDescriptor;

export interface PbrMaterialSnapshot {
  readonly alphaCutoff: number;
  readonly alphaMode: PbrAlphaMode;
  readonly baseColorFactor: RgbaColor;
  readonly bindingKey: string;
  readonly doubleSided: boolean;
  readonly emissiveFactor: RgbColor;
  readonly emissiveStrength: number;
  readonly featureKey: string;
  readonly metallicFactor: number;
  readonly name: string;
  readonly normalScale: number;
  readonly occlusionStrength: number;
  readonly revision: number;
  readonly roughnessFactor: number;
  readonly textures: PbrTextureBindings;
}

export interface PbrMaterialChangeEvent {
  readonly changedFields: readonly PbrMaterialChangeField[];
  readonly revision: number;
  readonly snapshot: PbrMaterialSnapshot;
}

export interface PbrMaterialEvents {
  readonly changed: PbrMaterialChangeEvent;
}

type State = Omit<PbrMaterialSnapshot, 'revision'>;

const DEFAULT_TEXTURES: PbrTextureBindings = Object.freeze({
  'base-color': null,
  emissive: null,
  'metallic-roughness': null,
  normal: null,
  occlusion: null,
});

function invalid(message: string): never {
  throw new KyxosEngineError(message, {
    code: 'INVALID_ARGUMENT',
    module: 'material',
    recoverable: false,
  });
}

function unitScalar(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    invalid(`${label} must be a finite value from 0 through 1.`);
  }
  return value;
}

function finiteScalar(value: number, label: string): number {
  if (!Number.isFinite(value)) invalid(`${label} must be finite.`);
  return value;
}

function nonnegativeScalar(value: number, label: string): number {
  finiteScalar(value, label);
  if (value < 0) invalid(`${label} must not be negative.`);
  return value;
}

function normalizeName(value: string): string {
  const result = value.trim();
  if (result.length === 0) invalid('PBR material name must not be empty.');
  return result;
}

function normalizeAlphaMode(value: PbrAlphaMode): PbrAlphaMode {
  if (value !== 'opaque' && value !== 'mask' && value !== 'blend') {
    invalid('PBR alphaMode must be "opaque", "mask", or "blend".');
  }
  return value;
}

function cloneBinding(
  slot: PbrTextureSlot,
  binding: MaterialTextureBinding,
): MaterialTextureBinding {
  const result = createMaterialTextureBinding({
    offset: binding.transform.offset,
    rotation: binding.transform.rotation,
    scale: binding.transform.scale,
    texCoord: binding.transform.texCoord,
    texture: binding.texture,
  });
  const expected = materialTextureSemanticInfo(slot).transferFunction;
  if (result.texture.transferFunction !== expected) {
    invalid(`${slot} texture must use the ${expected} transfer function.`);
  }
  return result;
}

function normalizeTextures(
  patch: PbrMaterialDescriptor['textures'],
  previous: PbrTextureBindings,
): PbrTextureBindings {
  if (patch === undefined) return previous;
  const next = { ...previous };
  for (const slot of PBR_TEXTURE_SLOTS) {
    if (!Object.hasOwn(patch, slot)) continue;
    const binding = patch[slot];
    if (binding === undefined) invalid(`${slot} texture update must be a binding or null.`);
    next[slot] = binding === null ? null : cloneBinding(slot, binding);
  }
  return Object.freeze(next);
}

function createBindingKey(textures: PbrTextureBindings): string {
  return JSON.stringify(
    PBR_TEXTURE_SLOTS.map((slot) => {
      const binding = textures[slot];
      return binding === null ? [slot, null] : [slot, materialTextureBindingKey(binding)];
    }),
  );
}

export function createPbrMaterialFeatureKey(descriptor: PbrMaterialFeatureDescriptor): string {
  const alphaMode = normalizeAlphaMode(descriptor.alphaMode);
  if (typeof descriptor.doubleSided !== 'boolean' || typeof descriptor.normalMap !== 'boolean') {
    invalid('PBR material feature flags must be boolean.');
  }
  return createMaterialFeatureKey('pbr-metallic-roughness', {
    alpha: alphaMode,
    'double-sided': descriptor.doubleSided,
    'normal-map': descriptor.normalMap,
  });
}

function normalizeState(descriptor: PbrMaterialDescriptor, previous?: State): State {
  const textures = normalizeTextures(descriptor.textures, previous?.textures ?? DEFAULT_TEXTURES);
  const alphaMode = normalizeAlphaMode(descriptor.alphaMode ?? previous?.alphaMode ?? 'opaque');
  const doubleSided = descriptor.doubleSided ?? previous?.doubleSided ?? false;
  if (typeof doubleSided !== 'boolean') invalid('PBR doubleSided must be boolean.');
  return Object.freeze({
    alphaCutoff: unitScalar(
      descriptor.alphaCutoff ?? previous?.alphaCutoff ?? 0.5,
      'PBR alphaCutoff',
    ),
    alphaMode,
    baseColorFactor: createLinearRgba(
      descriptor.baseColorFactor ?? previous?.baseColorFactor ?? [1, 1, 1, 1],
      'PBR baseColorFactor',
    ),
    bindingKey: createBindingKey(textures),
    doubleSided,
    emissiveFactor: createLinearRgb(
      descriptor.emissiveFactor ?? previous?.emissiveFactor ?? [0, 0, 0],
      'PBR emissiveFactor',
    ),
    emissiveStrength: nonnegativeScalar(
      descriptor.emissiveStrength ?? previous?.emissiveStrength ?? 1,
      'PBR emissiveStrength',
    ),
    featureKey: createPbrMaterialFeatureKey({
      alphaMode,
      doubleSided,
      normalMap: textures.normal !== null,
    }),
    metallicFactor: unitScalar(
      descriptor.metallicFactor ?? previous?.metallicFactor ?? 1,
      'PBR metallicFactor',
    ),
    name: normalizeName(descriptor.name ?? previous?.name ?? 'PBR Material'),
    normalScale: finiteScalar(
      descriptor.normalScale ?? previous?.normalScale ?? 1,
      'PBR normalScale',
    ),
    occlusionStrength: unitScalar(
      descriptor.occlusionStrength ?? previous?.occlusionStrength ?? 1,
      'PBR occlusionStrength',
    ),
    roughnessFactor: unitScalar(
      descriptor.roughnessFactor ?? previous?.roughnessFactor ?? 1,
      'PBR roughnessFactor',
    ),
    textures,
  });
}

function equalTuple(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function changedFields(previous: State, next: State): readonly PbrMaterialChangeField[] {
  const changed: PbrMaterialChangeField[] = [];
  if (previous.alphaCutoff !== next.alphaCutoff) changed.push('alphaCutoff');
  if (previous.alphaMode !== next.alphaMode) changed.push('alphaMode');
  if (!equalTuple(previous.baseColorFactor, next.baseColorFactor)) changed.push('baseColorFactor');
  if (previous.doubleSided !== next.doubleSided) changed.push('doubleSided');
  if (!equalTuple(previous.emissiveFactor, next.emissiveFactor)) changed.push('emissiveFactor');
  if (previous.emissiveStrength !== next.emissiveStrength) changed.push('emissiveStrength');
  if (previous.metallicFactor !== next.metallicFactor) changed.push('metallicFactor');
  if (previous.name !== next.name) changed.push('name');
  if (previous.normalScale !== next.normalScale) changed.push('normalScale');
  if (previous.occlusionStrength !== next.occlusionStrength) changed.push('occlusionStrength');
  if (previous.roughnessFactor !== next.roughnessFactor) changed.push('roughnessFactor');
  for (const slot of PBR_TEXTURE_SLOTS) {
    const left = previous.textures[slot];
    const right = next.textures[slot];
    const leftKey = left === null ? null : materialTextureBindingKey(left);
    const rightKey = right === null ? null : materialTextureBindingKey(right);
    if (leftKey !== rightKey) changed.push(`texture:${slot}`);
  }
  return Object.freeze(changed);
}

function snapshot(state: State, revision: number): PbrMaterialSnapshot {
  return Object.freeze({ ...state, revision });
}

export class PbrMaterial implements Disposable {
  readonly #events = new TypedEventEmitter<PbrMaterialEvents>();
  #disposed = false;
  #revision = 0;
  #state: State;

  constructor(descriptor: PbrMaterialDescriptor = {}) {
    this.#state = normalizeState(descriptor);
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  get revision(): number {
    return this.#revision;
  }

  on<EventName extends keyof PbrMaterialEvents>(
    eventName: EventName,
    listener: EventListener<PbrMaterialEvents[EventName]>,
  ): Unsubscribe {
    this.#assertActive();
    return this.#events.on(eventName, listener);
  }

  snapshot(): PbrMaterialSnapshot {
    this.#assertActive();
    return snapshot(this.#state, this.#revision);
  }

  update(patch: PbrMaterialPatch): PbrMaterialSnapshot {
    this.#assertActive();
    const next = normalizeState(patch, this.#state);
    const changed = changedFields(this.#state, next);
    if (changed.length === 0) return snapshot(this.#state, this.#revision);
    this.#state = next;
    this.#revision += 1;
    const current = snapshot(this.#state, this.#revision);
    this.#events.emit(
      'changed',
      Object.freeze({ changedFields: changed, revision: this.#revision, snapshot: current }),
    );
    return current;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#events.dispose();
  }

  #assertActive(): void {
    if (!this.#disposed) return;
    throw new KyxosEngineError('PBR material is disposed.', {
      code: 'ALREADY_DISPOSED',
      module: 'material',
      recoverable: false,
    });
  }
}
