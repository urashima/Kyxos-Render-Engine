import { describe, expect, it } from 'vitest';

import {
  createMaterialFeatureKey,
  createMaterialTextureBinding,
  createMaterialTextureReference,
  createUvTransform,
  materialTextureBindingKey,
  materialTextureSemanticInfo,
} from '../src/index.js';

describe('material texture semantics', () => {
  it('freezes the glTF-aligned transfer and channel roles', () => {
    expect(materialTextureSemanticInfo('base-color')).toMatchObject({
      channels: 'rgba',
      transferFunction: 'srgb',
    });
    expect(materialTextureSemanticInfo('emissive')).toMatchObject({
      channels: 'rgb',
      transferFunction: 'srgb',
    });
    expect(materialTextureSemanticInfo('metallic-roughness')).toMatchObject({
      channels: 'g-b',
      transferFunction: 'linear',
    });
    expect(materialTextureSemanticInfo('normal').transferFunction).toBe('linear');
    expect(materialTextureSemanticInfo('occlusion').channels).toBe('r');
  });

  it('normalizes immutable texture references and UV transforms', () => {
    const texture = createMaterialTextureReference({
      id: '  texture/base-color  ',
      transferFunction: 'srgb',
    });
    const binding = createMaterialTextureBinding({
      offset: [0.25, -0.5],
      rotation: Math.PI / 4,
      scale: [2, 3],
      texCoord: 1,
      texture,
    });
    expect(binding).toEqual({
      texture: { id: 'texture/base-color', transferFunction: 'srgb' },
      transform: { offset: [0.25, -0.5], rotation: Math.PI / 4, scale: [2, 3], texCoord: 1 },
    });
    expect(Object.isFrozen(binding)).toBe(true);
    expect(Object.isFrozen(binding.transform.offset)).toBe(true);
    expect(materialTextureBindingKey(binding)).toBe(materialTextureBindingKey(binding));
  });

  it('rejects invalid references and transforms', () => {
    expect(() => createMaterialTextureReference({ id: ' ', transferFunction: 'linear' })).toThrow(
      'must not be empty',
    );
    expect(() => createUvTransform({ texCoord: -1 })).toThrow('nonnegative safe integer');
    expect(() => createUvTransform({ offset: [Number.NaN, 0] })).toThrow('two finite values');
    expect(() => createUvTransform({ rotation: Number.POSITIVE_INFINITY })).toThrow(
      'must be finite',
    );
  });
});

describe('material feature keys', () => {
  it('is deterministic across insertion order and escapes separators', () => {
    const first = createMaterialFeatureKey('pbr metallic', {
      normal: true,
      alpha: 'mask|custom',
      transmission: false,
    });
    const second = createMaterialFeatureKey('pbr metallic', {
      transmission: false,
      alpha: 'mask|custom',
      normal: true,
    });
    expect(first).toBe(second);
    expect(first).toBe('pbr%20metallic|alpha=mask%7Ccustom|normal=1|transmission=0');
  });

  it('rejects empty model, feature names, and string values', () => {
    expect(() => createMaterialFeatureKey(' ', {})).toThrow('must not be empty');
    expect(() => createMaterialFeatureKey('pbr', { ' ': true })).toThrow('must not be empty');
    expect(() => createMaterialFeatureKey('pbr', { alpha: ' ' })).toThrow('must not be empty');
  });
});
