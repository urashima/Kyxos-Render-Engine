import { describe, expect, it, vi } from 'vitest';

import { KyxosEngineError } from '@kyxos/render-core';

import { ALL_LIGHT_LAYERS, LightRegistry } from '../src/index.js';

describe('LightRegistry', () => {
  it('creates immutable normalized Directional and Spot snapshots', () => {
    const registry = new LightRegistry();
    const directional = registry.createDirectionalLight({
      color: [2, 1, 0.5],
      direction: [0, -4, 0],
      intensity: 3,
      name: '  Key Light  ',
      shadowMode: 'shadow-map',
    });
    const spot = registry.createSpotLight({
      direction: [0, 0, -2],
      innerConeRadians: 0.2,
      outerConeRadians: 0.5,
      position: [1, 2, 3],
      range: 12,
    });

    expect(registry.snapshot(directional)).toMatchObject({
      color: [2, 1, 0.5],
      direction: [0, -1, 0],
      enabled: true,
      intensity: 3,
      kind: 'directional',
      layerMask: ALL_LIGHT_LAYERS,
      name: 'Key Light',
      order: 0,
      shadowMode: 'shadow-map',
      version: 1,
    });
    expect(registry.snapshot(spot)).toMatchObject({
      direction: [0, 0, -1],
      innerConeRadians: 0.2,
      kind: 'spot',
      order: 1,
      outerConeRadians: 0.5,
      position: [1, 2, 3],
      range: 12,
      version: 1,
    });
    expect(Object.isFrozen(registry.snapshot(directional))).toBe(true);
    expect(Object.isFrozen(registry.snapshot(directional).color)).toBe(true);
    expect(Object.isFrozen(registry.snapshots())).toBe(true);
  });

  it('preserves deterministic order while filtering enabled lights, kinds, and layers', () => {
    const registry = new LightRegistry();
    const first = registry.createDirectionalLight({ layerMask: 0b0001, name: 'First' });
    registry.createSpotLight({ enabled: false, layerMask: 0b0010, name: 'Hidden Spot' });
    const third = registry.createDirectionalLight({ layerMask: 0b0011, name: 'Third' });

    expect(registry.snapshots().map(({ name }) => name)).toEqual(['First', 'Hidden Spot', 'Third']);
    expect(
      registry.snapshots({ enabledOnly: true, kinds: ['directional'], layerMask: 0b0001 }).map(({ handle }) => handle),
    ).toEqual([first, third]);
    expect(registry.snapshots({ layerMask: 0b0100 })).toEqual([]);
  });

  it('increments registry and light versions only for effective mutations', () => {
    const registry = new LightRegistry();
    const listener = vi.fn();
    registry.on('changed', listener);
    const handle = registry.createDirectionalLight({ intensity: 2 });
    const created = registry.snapshot(handle);

    expect(registry.updateDirectionalLight(handle, { intensity: 2 })).toBe(created);
    expect(registry.revision).toBe(1);

    const updated = registry.updateDirectionalLight(handle, {
      direction: [2, -2, 0],
      intensity: 4,
      layerMask: 7,
    });
    expect(updated.version).toBe(2);
    expect(updated.direction[0]).toBeCloseTo(Math.SQRT1_2);
    expect(updated.direction[1]).toBeCloseTo(-Math.SQRT1_2);
    expect(registry.revision).toBe(2);
    expect(listener).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ kind: 'updated', lightVersion: 2, revision: 2 }),
    );
  });

  it('rejects invalid portable descriptors before storing a light', () => {
    const registry = new LightRegistry();

    for (const create of [
      () => registry.createDirectionalLight({ direction: [0, 0, 0] }),
      () => registry.createDirectionalLight({ intensity: -1 }),
      () => registry.createDirectionalLight({ layerMask: 2 ** 32 }),
      () => registry.createSpotLight({ range: 0 }),
      () => registry.createSpotLight({ innerConeRadians: 0.8, outerConeRadians: 0.4 }),
      () => registry.createSpotLight({ outerConeRadians: Math.PI }),
    ]) {
      expect(create).toThrow(KyxosEngineError);
    }
    expect(registry.lightCount).toBe(0);
    expect(registry.revision).toBe(0);
  });

  it('enforces registry ownership, light kind, removal, clearing, and disposal', () => {
    const registry = new LightRegistry();
    const other = new LightRegistry();
    const directional = registry.createDirectionalLight();
    const spot = registry.createSpotLight();

    expect(() => registry.updateSpotLight(directional, {})).toThrow('Spot Light patch');
    expect(() => other.snapshot(directional)).toThrow('different LightRegistry');
    expect(registry.removeLight(directional)).toBe(true);
    expect(registry.removeLight(directional)).toBe(false);
    expect(() => registry.snapshot(directional)).toThrow('no longer exists');
    expect(registry.clear()).toBe(1);
    expect(registry.diagnostics()).toEqual({
      directionalCount: 0,
      enabledCount: 0,
      lightCount: 0,
      revision: 4,
      spotCount: 0,
    });

    registry.dispose();
    registry.dispose();
    expect(registry.disposed).toBe(true);
    expect(() => registry.snapshots()).toThrow('LightRegistry is disposed');
    expect(other.removeLight(spot)).toBe(false);
  });
});
