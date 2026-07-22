import { describe, expect, it, vi } from 'vitest';

import {
  createMaterialTextureBinding,
  createMaterialTextureReference,
} from '@kyxos/render-material-core';

import { PbrMaterial, createPbrMaterialFeatureKey } from '../src/index.js';

function texture(id: string, transferFunction: 'linear' | 'srgb') {
  return createMaterialTextureReference({ id, transferFunction });
}

describe('PbrMaterial', () => {
  it('exposes deterministic Renderer variant keys without constructing a material', () => {
    expect(
      createPbrMaterialFeatureKey({
        alphaMode: 'mask',
        doubleSided: true,
        normalMap: false,
      }),
    ).toBe('pbr-metallic-roughness|alpha=mask|double-sided=1|normal-map=0');
  });

  it('provides immutable glTF metallic-roughness defaults', () => {
    const material = new PbrMaterial();
    const state = material.snapshot();
    expect(state).toMatchObject({
      alphaCutoff: 0.5,
      alphaMode: 'opaque',
      baseColorFactor: [1, 1, 1, 1],
      doubleSided: false,
      emissiveFactor: [0, 0, 0],
      emissiveStrength: 1,
      metallicFactor: 1,
      name: 'PBR Material',
      normalScale: 1,
      occlusionStrength: 1,
      revision: 0,
      roughnessFactor: 1,
    });
    expect(state.textures).toEqual({
      'base-color': null,
      emissive: null,
      'metallic-roughness': null,
      normal: null,
      occlusion: null,
    });
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.textures)).toBe(true);
  });

  it('normalizes factors while keeping numeric updates out of pipeline and binding keys', () => {
    const material = new PbrMaterial({ name: '  Copper  ' });
    const before = material.snapshot();
    const after = material.update({
      baseColorFactor: [1, 0.766, 0.336, 1],
      emissiveFactor: [0.1, 0.2, 0.3],
      emissiveStrength: 4,
      metallicFactor: 1,
      normalScale: 0.75,
      occlusionStrength: 0.4,
      roughnessFactor: 0.22,
    });
    expect(after.name).toBe('Copper');
    expect(after.revision).toBe(1);
    expect(after.featureKey).toBe(before.featureKey);
    expect(after.bindingKey).toBe(before.bindingKey);
  });

  it('changes variants only for render-state and normal-map features', () => {
    const material = new PbrMaterial();
    const initial = material.snapshot().featureKey;
    const baseMapped = material.update({
      textures: {
        'base-color': createMaterialTextureBinding({
          texture: texture('base', 'srgb'),
        }),
      },
    });
    expect(baseMapped.featureKey).toBe(initial);

    const normalMapped = material.update({
      textures: {
        normal: createMaterialTextureBinding({ texture: texture('normal', 'linear') }),
      },
    });
    expect(normalMapped.featureKey).not.toBe(initial);

    const masked = material.update({ alphaMode: 'mask', doubleSided: true });
    expect(masked.featureKey).toContain('alpha=mask');
    expect(masked.featureKey).toContain('double-sided=1');
    expect(masked.featureKey).toContain('normal-map=1');
  });

  it('tracks texture identity and UV changes in a deterministic binding key', () => {
    const material = new PbrMaterial({
      textures: {
        occlusion: createMaterialTextureBinding({
          texCoord: 1,
          texture: texture('packed-data', 'linear'),
        }),
      },
    });
    const first = material.snapshot();
    const same = material.update({
      textures: {
        occlusion: createMaterialTextureBinding({
          texCoord: 1,
          texture: texture('packed-data', 'linear'),
        }),
      },
    });
    expect(same.revision).toBe(0);
    expect(same.bindingKey).toBe(first.bindingKey);

    const transformed = material.update({
      textures: {
        occlusion: createMaterialTextureBinding({
          offset: [0.25, 0],
          texCoord: 1,
          texture: texture('packed-data', 'linear'),
        }),
      },
    });
    expect(transformed.revision).toBe(1);
    expect(transformed.bindingKey).not.toBe(first.bindingKey);
  });

  it('emits one precise event for a real update and none for a no-op', () => {
    const material = new PbrMaterial();
    const listener = vi.fn();
    material.on('changed', listener);

    material.update({ roughnessFactor: 1 });
    expect(listener).not.toHaveBeenCalled();

    const current = material.update({ name: 'Matte', roughnessFactor: 0.8 });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({
      changedFields: ['name', 'roughnessFactor'],
      revision: 1,
      snapshot: current,
    });
  });

  it('validates factors, alpha modes, booleans, and texture transfer functions', () => {
    expect(() => new PbrMaterial({ metallicFactor: -0.1 })).toThrow('from 0 through 1');
    expect(() => new PbrMaterial({ roughnessFactor: Number.NaN })).toThrow('from 0 through 1');
    expect(() => new PbrMaterial({ emissiveStrength: -1 })).toThrow('must not be negative');
    expect(() => new PbrMaterial({ normalScale: Number.POSITIVE_INFINITY })).toThrow('finite');
    expect(() => new PbrMaterial({ alphaMode: 'invalid' as 'opaque' })).toThrow('alphaMode');
    expect(
      () =>
        new PbrMaterial({
          textures: {
            'base-color': createMaterialTextureBinding({
              texture: texture('wrong-base', 'linear'),
            }),
          },
        }),
    ).toThrow('base-color texture must use the srgb transfer function');
    expect(
      () =>
        new PbrMaterial({
          textures: {
            normal: createMaterialTextureBinding({ texture: texture('wrong-normal', 'srgb') }),
          },
        }),
    ).toThrow('normal texture must use the linear transfer function');
  });

  it('supports explicit texture removal and rejects use after disposal', () => {
    const material = new PbrMaterial({
      textures: {
        emissive: createMaterialTextureBinding({ texture: texture('emissive', 'srgb') }),
      },
    });
    expect(material.update({ textures: { emissive: null } }).textures.emissive).toBeNull();
    material.dispose();
    material.dispose();
    expect(material.disposed).toBe(true);
    expect(() => material.snapshot()).toThrow('disposed');
    expect(() => material.update({ roughnessFactor: 0.5 })).toThrow('disposed');
    expect(() => material.on('changed', () => undefined)).toThrow('disposed');
  });
});
