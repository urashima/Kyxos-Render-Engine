import { PbrMaterial } from '@kyxos/render-material-pbr';
import { describe, expect, it, vi } from 'vitest';

import { PbrMaterialLibrary } from '../src/index.js';

describe('PbrMaterialLibrary', () => {
  it('tracks keyed updates without taking ownership of registered materials', () => {
    const library = new PbrMaterialLibrary();
    const fallback = library.fallbackMaterial;
    const copper = new PbrMaterial({ name: 'Copper' });
    const replacement = new PbrMaterial({ name: 'Replacement' });
    const listener = vi.fn();
    library.on('changed', listener);

    expect(library.resolve('missing')).toBe(fallback);
    expect(library.set(' copper ', copper)).toBeNull();
    expect(library.resolve('copper')).toBe(copper);
    copper.update({ roughnessFactor: 0.3 });
    expect(library.set('copper', replacement)).toBe(copper);
    copper.update({ roughnessFactor: 0.4 });
    expect(library.delete('copper')).toBe(replacement);
    expect(library.keys()).toEqual([]);
    expect(listener.mock.calls.map(([event]) => event.kind)).toEqual([
      'material-set',
      'material-updated',
      'material-replaced',
      'material-removed',
    ]);

    library.dispose();
    expect(fallback.disposed).toBe(true);
    expect(copper.disposed).toBe(false);
    expect(replacement.disposed).toBe(false);
    expect(() => library.resolve('missing')).toThrow('disposed');
  });

  it('keeps a caller-owned fallback active after disposal', () => {
    const fallback = new PbrMaterial({ name: 'External Fallback' });
    const library = new PbrMaterialLibrary({ fallbackMaterial: fallback });
    expect(library.diagnostics()).toEqual({
      materialCount: 0,
      ownsFallbackMaterial: false,
      revision: 0,
    });
    library.dispose();
    expect(fallback.disposed).toBe(false);
    fallback.dispose();
  });
});
