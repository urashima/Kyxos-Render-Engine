import { createMaterialTextureReference } from '@kyxos/render-material-core';
import { describe, expect, it, vi } from 'vitest';

import { PbrTextureLibrary, PbrTextureSource } from '../src/index.js';

describe('PbrTextureLibrary', () => {
  it('owns immutable RGBA8 copies and resolves the declared transfer function', () => {
    const pixels = new Uint8Array([255, 128, 64, 255]);
    const source = new PbrTextureSource({
      height: 1,
      id: 'base-color',
      pixels,
      sampler: { addressModeU: 'clamp-to-edge', magFilter: 'nearest' },
      transferFunction: 'srgb',
      width: 1,
    });
    pixels.fill(0);
    expect([...source.copyPixels()]).toEqual([255, 128, 64, 255]);
    expect(source.sampler).toMatchObject({
      addressModeU: 'clamp-to-edge',
      addressModeV: 'repeat',
      magFilter: 'nearest',
      minFilter: 'linear',
    });

    const library = new PbrTextureLibrary();
    const changed = vi.fn();
    library.on('changed', changed);
    expect(library.set(source)).toBeNull();
    expect(
      library.resolve(
        createMaterialTextureReference({ id: 'base-color', transferFunction: 'srgb' }),
      ),
    ).toBe(source);
    expect(library.diagnostics()).toEqual({
      revision: 1,
      textureCount: 1,
      textureIds: ['base-color'],
    });
    expect(changed).toHaveBeenCalledWith({ id: 'base-color', kind: 'set', revision: 1 });

    expect(() =>
      library.resolve(
        createMaterialTextureReference({ id: 'base-color', transferFunction: 'linear' }),
      ),
    ).toThrow('material requires linear');
    library.dispose();
    expect(source.copyPixels()).toEqual(new Uint8Array([255, 128, 64, 255]));
  });

  it('tracks replacement/removal without taking source ownership and rejects malformed data', () => {
    expect(
      () =>
        new PbrTextureSource({
          height: 2,
          id: 'bad',
          pixels: new Uint8Array(4),
          transferFunction: 'linear',
          width: 2,
        }),
    ).toThrow('exactly 16 RGBA8 bytes');

    const first = new PbrTextureSource({
      height: 1,
      id: 'map',
      pixels: new Uint8Array([0, 255, 255, 255]),
      transferFunction: 'linear',
      width: 1,
    });
    const replacement = new PbrTextureSource({
      height: 1,
      id: 'map',
      pixels: new Uint8Array([0, 128, 64, 255]),
      transferFunction: 'linear',
      width: 1,
    });
    const library = new PbrTextureLibrary();
    library.set(first);
    expect(library.set(replacement)).toBe(first);
    expect(library.delete('map')).toBe(replacement);
    expect(library.diagnostics()).toMatchObject({ revision: 3, textureCount: 0 });
    library.dispose();
    expect(() => library.has('map')).toThrow('disposed');
    expect([...replacement.copyPixels()]).toEqual([0, 128, 64, 255]);
  });
});
