import {
  ENVIRONMENT_CUBE_FACES,
  type EnvironmentCubeFaceData,
  EnvironmentSource,
} from '@kyxos/render-environment';
import { MockBackend } from '@kyxos/render-testing';
import { describe, expect, it, vi } from 'vitest';

import { EnvironmentGpuCache } from '../src/index.js';

function faces(size: number, value: number): EnvironmentCubeFaceData {
  return Object.fromEntries(
    ENVIRONMENT_CUBE_FACES.map((face, faceIndex) => [
      face,
      new Float32Array(size * size * 3).fill(value + faceIndex * 0.01),
    ]),
  ) as unknown as EnvironmentCubeFaceData;
}

function source(value = 0.1): EnvironmentSource {
  return new EnvironmentSource({
    brdfLut: {
      height: 1,
      pixels: new Float32Array([0.6, 0.15]),
      width: 1,
    },
    diffuseIrradiance: { faces: faces(1, value), size: 1 },
    id: 'courtyard',
    specularPrefilter: {
      levels: [{ faces: faces(2, value + 0.1) }, { faces: faces(1, value + 0.2) }],
      size: 2,
    },
    version: 'v1',
  });
}

describe('EnvironmentGpuCache', () => {
  it('deduplicates leases, uploads every mip, and releases only cache-owned Handles', async () => {
    const backend = new MockBackend();
    const writeTexture = vi.spyOn(backend, 'writeTexture');
    await backend.initialize();
    const cache = new EnvironmentGpuCache();
    cache.initialize(backend);
    const environment = source();

    const first = cache.acquire(environment);
    const second = cache.acquire(environment);
    expect(first.resources).toBe(second.resources);
    expect(first.resources).toMatchObject({
      brdfLutView: { dimension: '2d' },
      diffuseIrradianceView: {
        arrayLayerCount: 6,
        dimension: 'cube',
        mipLevelCount: 1,
      },
      identityKey: environment.identityKey,
      specularMipLevelCount: 2,
      specularPrefilterView: {
        arrayLayerCount: 6,
        dimension: 'cube',
        mipLevelCount: 2,
      },
    });
    expect(writeTexture).toHaveBeenCalledTimes(4);
    expect(writeTexture.mock.calls.map(([, , descriptor]) => descriptor.mipLevel ?? 0)).toEqual([
      0, 0, 1, 0,
    ]);
    expect(backend.getResourceStatistics()).toMatchObject({
      activeCount: 5,
      byKind: {
        sampler: { activeCount: 2 },
        texture: { activeCount: 3, activeEstimatedBytes: environment.estimatedGpuBytes },
      },
      createdTotal: 5,
    });
    expect(cache.diagnostics()).toEqual({
      activeLeaseCount: 2,
      cachedEnvironmentCount: 1,
      estimatedGpuBytes: environment.estimatedGpuBytes,
      generation: 1,
      gpuReadyEnvironmentCount: 1,
      identities: [environment.identityKey],
      state: 'ready',
    });

    first.dispose();
    expect(backend.getResourceStatistics().activeCount).toBe(5);
    second.dispose();
    second.dispose();
    expect(backend.getResourceStatistics().activeCount).toBe(0);
    expect(cache.diagnostics().cachedEnvironmentCount).toBe(0);
    expect(environment.diagnostics().id).toBe('courtyard');

    cache.dispose();
    backend.dispose();
  });

  it('preserves logical leases across Device Lost and atomically restores new Handles', async () => {
    const backend = new MockBackend();
    await backend.initialize();
    const cache = new EnvironmentGpuCache();
    cache.initialize(backend);
    const lease = cache.acquire(source());
    const previous = lease.resources;

    backend.simulateLoss({ message: 'environment test loss' });
    expect(cache.diagnostics()).toMatchObject({
      activeLeaseCount: 1,
      cachedEnvironmentCount: 1,
      generation: 1,
      gpuReadyEnvironmentCount: 0,
      state: 'detached',
    });
    expect(() => lease.resources).toThrow('until the Backend is restored');

    await backend.initialize();
    cache.initialize(backend);
    expect(cache.diagnostics()).toMatchObject({
      generation: 2,
      gpuReadyEnvironmentCount: 1,
      state: 'ready',
    });
    expect(lease.resources.identityKey).toBe(previous.identityKey);
    expect(lease.resources.diffuseIrradianceTexture).not.toBe(previous.diffuseIrradianceTexture);
    expect(backend.getResourceStatistics().activeCount).toBe(5);

    cache.dispose();
    expect(backend.getResourceStatistics().activeCount).toBe(0);
    expect(() => lease.resources).toThrow('disposed');
    lease.dispose();
    backend.dispose();
  });

  it('rolls back all partial GPU ownership when one mip upload fails', async () => {
    const backend = new MockBackend();
    await backend.initialize();
    const cache = new EnvironmentGpuCache();
    cache.initialize(backend);
    vi.spyOn(backend, 'writeTexture')
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw new Error('forced mip upload failure');
      });

    expect(() => cache.acquire(source())).toThrow('forced mip upload failure');
    expect(cache.diagnostics().cachedEnvironmentCount).toBe(0);
    expect(backend.getResourceStatistics()).toMatchObject({
      activeCount: 0,
      createdTotal: 4,
      destroyedTotal: 4,
    });

    cache.dispose();
    backend.dispose();
  });
});
