import { HandleAllocator, KyxosEngineError, TypedEventEmitter } from '@kyxos/render-core';
import { createVec3, normalizeVec3 } from '@kyxos/render-math';

import type { Disposable, EventListener, Handle, Unsubscribe } from '@kyxos/render-core';
import type { Vec3 } from '@kyxos/render-math';

export const ALL_LIGHT_LAYERS = 0xffff_ffff;
export const LIGHT_SHADOW_MODES = ['none', 'shadow-map'] as const;

export type LightHandle = Handle<'light'>;
export type LightKind = 'directional' | 'spot';
export type LightShadowMode = (typeof LIGHT_SHADOW_MODES)[number];
export type LightChangeKind = 'cleared' | 'created' | 'removed' | 'updated';

interface CommonLightOptions {
  readonly color?: Vec3;
  readonly enabled?: boolean;
  readonly intensity?: number;
  readonly layerMask?: number;
  readonly name?: string;
  readonly shadowMode?: LightShadowMode;
}

export interface CreateDirectionalLightOptions extends CommonLightOptions {
  readonly direction?: Vec3;
}

export interface CreateSpotLightOptions extends CommonLightOptions {
  readonly direction?: Vec3;
  readonly innerConeRadians?: number;
  readonly outerConeRadians?: number;
  readonly position?: Vec3;
  readonly range?: number;
}

export interface DirectionalLightPatch extends CommonLightOptions {
  readonly direction?: Vec3;
}

export interface SpotLightPatch extends CommonLightOptions {
  readonly direction?: Vec3;
  readonly innerConeRadians?: number;
  readonly outerConeRadians?: number;
  readonly position?: Vec3;
  readonly range?: number;
}

interface CommonLightSnapshot {
  readonly color: Vec3;
  readonly enabled: boolean;
  readonly handle: LightHandle;
  readonly intensity: number;
  readonly layerMask: number;
  readonly name: string;
  readonly order: number;
  readonly shadowMode: LightShadowMode;
  readonly version: number;
}

export interface DirectionalLightSnapshot extends CommonLightSnapshot {
  readonly direction: Vec3;
  readonly kind: 'directional';
}

export interface SpotLightSnapshot extends CommonLightSnapshot {
  readonly direction: Vec3;
  readonly innerConeRadians: number;
  readonly kind: 'spot';
  readonly outerConeRadians: number;
  readonly position: Vec3;
  readonly range: number;
}

export type LightSnapshot = DirectionalLightSnapshot | SpotLightSnapshot;

export interface LightSnapshotOptions {
  readonly enabledOnly?: boolean;
  readonly kinds?: readonly LightKind[];
  readonly layerMask?: number;
}

export interface LightChangeEvent {
  readonly affectedLightCount: number;
  readonly handle: LightHandle | null;
  readonly kind: LightChangeKind;
  readonly lightVersion: number | null;
  readonly revision: number;
}

export interface LightRegistryEvents {
  readonly changed: LightChangeEvent;
}

export interface LightRegistryDiagnostics {
  readonly directionalCount: number;
  readonly enabledCount: number;
  readonly lightCount: number;
  readonly revision: number;
  readonly spotCount: number;
}

interface LightRecord {
  snapshot: LightSnapshot;
}

const DEFAULT_COLOR = createVec3(1, 1, 1);
const DEFAULT_DIRECTION = createVec3(0, -1, 0);
const DEFAULT_POSITION = createVec3(0, 0, 0);

function invalid(message: string): never {
  throw new KyxosEngineError(message, {
    code: 'INVALID_ARGUMENT',
    module: 'lighting',
    recoverable: true,
  });
}

function disposed(): KyxosEngineError {
  return new KyxosEngineError('LightRegistry is disposed.', {
    code: 'ALREADY_DISPOSED',
    module: 'lighting',
    recoverable: false,
  });
}

function validateName(value: string, fallback: string): string {
  const result = value.trim();
  if (result.length === 0) invalid('Light name must not be empty.');
  return result || fallback;
}

function validateFinite(label: string, value: number): number {
  if (!Number.isFinite(value)) invalid(`${label} must be finite.`);
  return value;
}

function validateNonNegative(label: string, value: number): number {
  const result = validateFinite(label, value);
  if (result < 0) invalid(`${label} must be non-negative.`);
  return result;
}

function validatePositive(label: string, value: number): number {
  const result = validateFinite(label, value);
  if (result <= 0) invalid(`${label} must be greater than zero.`);
  return result;
}

function validateLayerMask(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > ALL_LIGHT_LAYERS) {
    invalid('Light layer mask must be an unsigned 32-bit integer.');
  }
  return value >>> 0;
}

function validateShadowMode(value: LightShadowMode): LightShadowMode {
  if (!(LIGHT_SHADOW_MODES as readonly string[]).includes(value)) {
    invalid(`Unsupported light shadow mode: ${String(value)}.`);
  }
  return value;
}

function validateVec3(label: string, value: Vec3): Vec3 {
  if (!Array.isArray(value) || value.length !== 3) invalid(`${label} must contain three values.`);
  return createVec3(
    validateFinite(`${label}.x`, value[0]),
    validateFinite(`${label}.y`, value[1]),
    validateFinite(`${label}.z`, value[2]),
  );
}

function validateColor(value: Vec3): Vec3 {
  const color = validateVec3('Light color', value);
  if (color.some((channel) => channel < 0)) invalid('Light color channels must be non-negative.');
  return color;
}

function validateDirection(value: Vec3): Vec3 {
  try {
    return normalizeVec3(validateVec3('Light direction', value));
  } catch (error) {
    if (error instanceof KyxosEngineError) throw error;
    invalid('Light direction must have non-zero length.');
  }
}

function validateCones(innerConeRadians: number, outerConeRadians: number) {
  const inner = validateNonNegative('Spot inner cone', innerConeRadians);
  const outer = validatePositive('Spot outer cone', outerConeRadians);
  if (outer > Math.PI / 2) invalid('Spot outer cone must not exceed PI / 2 radians.');
  if (inner > outer) invalid('Spot inner cone must not exceed the outer cone.');
  return { inner, outer };
}

function vec3Equal(left: Vec3, right: Vec3): boolean {
  return left[0] === right[0] && left[1] === right[1] && left[2] === right[2];
}

function snapshotsEqual(left: LightSnapshot, right: LightSnapshot): boolean {
  if (
    left.kind !== right.kind ||
    left.name !== right.name ||
    left.enabled !== right.enabled ||
    left.intensity !== right.intensity ||
    left.layerMask !== right.layerMask ||
    left.shadowMode !== right.shadowMode ||
    !vec3Equal(left.color, right.color) ||
    !vec3Equal(left.direction, right.direction)
  ) {
    return false;
  }
  if (left.kind === 'directional' || right.kind === 'directional') return true;
  return (
    left.range === right.range &&
    left.innerConeRadians === right.innerConeRadians &&
    left.outerConeRadians === right.outerConeRadians &&
    vec3Equal(left.position, right.position)
  );
}

function freezeDirectional(
  handle: LightHandle,
  order: number,
  version: number,
  options: CreateDirectionalLightOptions,
): DirectionalLightSnapshot {
  return Object.freeze({
    color: validateColor(options.color ?? DEFAULT_COLOR),
    direction: validateDirection(options.direction ?? DEFAULT_DIRECTION),
    enabled: options.enabled ?? true,
    handle,
    intensity: validateNonNegative('Light intensity', options.intensity ?? 1),
    kind: 'directional' as const,
    layerMask: validateLayerMask(options.layerMask ?? ALL_LIGHT_LAYERS),
    name: validateName(options.name ?? 'Directional Light', 'Directional Light'),
    order,
    shadowMode: validateShadowMode(options.shadowMode ?? 'none'),
    version,
  });
}

function freezeSpot(
  handle: LightHandle,
  order: number,
  version: number,
  options: CreateSpotLightOptions,
): SpotLightSnapshot {
  const cones = validateCones(options.innerConeRadians ?? Math.PI / 8, options.outerConeRadians ?? Math.PI / 4);
  return Object.freeze({
    color: validateColor(options.color ?? DEFAULT_COLOR),
    direction: validateDirection(options.direction ?? DEFAULT_DIRECTION),
    enabled: options.enabled ?? true,
    handle,
    innerConeRadians: cones.inner,
    intensity: validateNonNegative('Light intensity', options.intensity ?? 1),
    kind: 'spot' as const,
    layerMask: validateLayerMask(options.layerMask ?? ALL_LIGHT_LAYERS),
    name: validateName(options.name ?? 'Spot Light', 'Spot Light'),
    order,
    outerConeRadians: cones.outer,
    position: validateVec3('Spot position', options.position ?? DEFAULT_POSITION),
    range: validatePositive('Spot range', options.range ?? 10),
    shadowMode: validateShadowMode(options.shadowMode ?? 'none'),
    version,
  });
}

export class LightRegistry implements Disposable {
  readonly #allocator = new HandleAllocator('light');
  readonly #events = new TypedEventEmitter<LightRegistryEvents>();
  readonly #ownedHandles = new WeakSet<object>();
  readonly #records = new Map<LightHandle, LightRecord>();
  #disposed = false;
  #nextOrder = 0;
  #revision = 0;

  get disposed(): boolean {
    return this.#disposed;
  }

  get lightCount(): number {
    return this.#records.size;
  }

  get revision(): number {
    return this.#revision;
  }

  on<EventName extends keyof LightRegistryEvents>(
    eventName: EventName,
    listener: EventListener<LightRegistryEvents[EventName]>,
  ): Unsubscribe {
    this.#assertActive();
    return this.#events.on(eventName, listener);
  }

  createDirectionalLight(options: CreateDirectionalLightOptions = {}): LightHandle {
    this.#assertActive();
    const handle = this.#allocator.create();
    const snapshot = freezeDirectional(handle, this.#nextOrder, 1, options);
    this.#nextOrder += 1;
    this.#ownedHandles.add(handle);
    this.#records.set(handle, { snapshot });
    this.#emit('created', handle, snapshot.version, 1);
    return handle;
  }

  createSpotLight(options: CreateSpotLightOptions = {}): LightHandle {
    this.#assertActive();
    const handle = this.#allocator.create();
    const snapshot = freezeSpot(handle, this.#nextOrder, 1, options);
    this.#nextOrder += 1;
    this.#ownedHandles.add(handle);
    this.#records.set(handle, { snapshot });
    this.#emit('created', handle, snapshot.version, 1);
    return handle;
  }

  hasLight(handle: LightHandle): boolean {
    this.#assertActive();
    return this.#records.has(handle);
  }

  snapshot(handle: LightHandle): LightSnapshot {
    return this.#requireRecord(handle).snapshot;
  }

  snapshots(options: LightSnapshotOptions = {}): readonly LightSnapshot[] {
    this.#assertActive();
    const layerMask = validateLayerMask(options.layerMask ?? ALL_LIGHT_LAYERS);
    const enabledOnly = options.enabledOnly ?? false;
    const kinds = options.kinds === undefined ? null : new Set(options.kinds);
    if (kinds !== null && [...kinds].some((kind) => kind !== 'directional' && kind !== 'spot')) {
      invalid('Light snapshot kinds contain an unsupported value.');
    }
    return Object.freeze(
      [...this.#records.values()]
        .map(({ snapshot }) => snapshot)
        .filter((snapshot) => (snapshot.layerMask & layerMask) !== 0)
        .filter((snapshot) => !enabledOnly || snapshot.enabled)
        .filter((snapshot) => kinds === null || kinds.has(snapshot.kind))
        .sort((left, right) => left.order - right.order),
    );
  }

  updateDirectionalLight(handle: LightHandle, patch: DirectionalLightPatch): DirectionalLightSnapshot {
    const record = this.#requireRecord(handle);
    const current = record.snapshot;
    if (current.kind !== 'directional') invalid('Cannot apply a Directional Light patch to a Spot Light.');
    const next = freezeDirectional(handle, current.order, current.version + 1, {
      color: patch.color ?? current.color,
      direction: patch.direction ?? current.direction,
      enabled: patch.enabled ?? current.enabled,
      intensity: patch.intensity ?? current.intensity,
      layerMask: patch.layerMask ?? current.layerMask,
      name: patch.name ?? current.name,
      shadowMode: patch.shadowMode ?? current.shadowMode,
    });
    if (snapshotsEqual(current, next)) return current;
    record.snapshot = next;
    this.#emit('updated', handle, next.version, 1);
    return next;
  }

  updateSpotLight(handle: LightHandle, patch: SpotLightPatch): SpotLightSnapshot {
    const record = this.#requireRecord(handle);
    const current = record.snapshot;
    if (current.kind !== 'spot') invalid('Cannot apply a Spot Light patch to a Directional Light.');
    const next = freezeSpot(handle, current.order, current.version + 1, {
      color: patch.color ?? current.color,
      direction: patch.direction ?? current.direction,
      enabled: patch.enabled ?? current.enabled,
      innerConeRadians: patch.innerConeRadians ?? current.innerConeRadians,
      intensity: patch.intensity ?? current.intensity,
      layerMask: patch.layerMask ?? current.layerMask,
      name: patch.name ?? current.name,
      outerConeRadians: patch.outerConeRadians ?? current.outerConeRadians,
      position: patch.position ?? current.position,
      range: patch.range ?? current.range,
      shadowMode: patch.shadowMode ?? current.shadowMode,
    });
    if (snapshotsEqual(current, next)) return current;
    record.snapshot = next;
    this.#emit('updated', handle, next.version, 1);
    return next;
  }

  removeLight(handle: LightHandle): boolean {
    this.#assertActive();
    this.#assertOwned(handle);
    const record = this.#records.get(handle);
    if (record === undefined) return false;
    this.#records.delete(handle);
    this.#emit('removed', handle, record.snapshot.version, 1);
    return true;
  }

  clear(): number {
    this.#assertActive();
    const count = this.#records.size;
    if (count === 0) return 0;
    this.#records.clear();
    this.#emit('cleared', null, null, count);
    return count;
  }

  diagnostics(): LightRegistryDiagnostics {
    this.#assertActive();
    let directionalCount = 0;
    let enabledCount = 0;
    let spotCount = 0;
    for (const { snapshot } of this.#records.values()) {
      if (snapshot.kind === 'directional') directionalCount += 1;
      else spotCount += 1;
      if (snapshot.enabled) enabledCount += 1;
    }
    return Object.freeze({
      directionalCount,
      enabledCount,
      lightCount: this.#records.size,
      revision: this.#revision,
      spotCount,
    });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#records.clear();
    this.#events.dispose();
  }

  #assertActive(): void {
    if (this.#disposed) throw disposed();
  }

  #assertOwned(handle: LightHandle): void {
    if (!this.#ownedHandles.has(handle)) {
      throw new KyxosEngineError('Light belongs to a different LightRegistry.', {
        code: 'INVALID_ARGUMENT',
        module: 'lighting',
        recoverable: true,
      });
    }
  }

  #requireRecord(handle: LightHandle): LightRecord {
    this.#assertActive();
    this.#assertOwned(handle);
    const record = this.#records.get(handle);
    if (record === undefined) {
      throw new KyxosEngineError('Light no longer exists.', {
        code: 'INVALID_STATE',
        module: 'lighting',
        recoverable: true,
      });
    }
    return record;
  }

  #emit(
    kind: LightChangeKind,
    handle: LightHandle | null,
    lightVersion: number | null,
    affectedLightCount: number,
  ): void {
    this.#revision += 1;
    this.#events.emit(
      'changed',
      Object.freeze({
        affectedLightCount,
        handle,
        kind,
        lightVersion,
        revision: this.#revision,
      }),
    );
  }
}
