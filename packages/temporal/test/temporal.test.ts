import { describe, expect, it } from 'vitest';

import {
  TemporalConvergenceTracker,
  TemporalHistory,
  createTemporalHistorySignature,
  createTemporalJitterSample,
  createTemporalJitterSequence,
  temporalHistorySignaturesEqual,
  temporalJitterToNdc,
} from '../src/index.js';
import type { TemporalHistorySignatureDescriptor } from '../src/index.js';

function signature(
  overrides: Partial<TemporalHistorySignatureDescriptor> = {},
): TemporalHistorySignatureDescriptor {
  return {
    camera: 1,
    device: 1,
    environment: 1,
    geometry: 1,
    lighting: 1,
    materials: 1,
    postProcess: 1,
    scene: 1,
    viewport: 1,
    ...overrides,
  };
}

describe('temporal history contract', () => {
  it('creates immutable exact signatures and rejects invalid revisions', () => {
    const first = createTemporalHistorySignature(signature());
    const same = createTemporalHistorySignature(signature());
    const changed = createTemporalHistorySignature(signature({ camera: 2 }));

    expect(Object.isFrozen(first)).toBe(true);
    expect(temporalHistorySignaturesEqual(first, same)).toBe(true);
    expect(temporalHistorySignaturesEqual(first, changed)).toBe(false);
    expect(() => createTemporalHistorySignature(signature({ device: -1 }))).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    );
  });

  it('keeps dynamic and static owner histories isolated and rejects stale signatures', () => {
    const dynamic = new TemporalHistory({ kind: 'dynamic', ownerId: 'viewport-a' });
    const staticHistory = new TemporalHistory({ kind: 'static', ownerId: 'viewport-a' });

    expect(dynamic.recordSample(signature())).toMatchObject({
      generation: 0,
      sampleCount: 1,
      valid: true,
    });
    expect(dynamic.isReusable(signature())).toBe(true);
    expect(staticHistory.snapshot()).toMatchObject({ sampleCount: 0, valid: false });

    expect(dynamic.recordSample(signature({ materials: 2 }))).toMatchObject({
      generation: 1,
      lastInvalidation: 'signature-mismatch',
      sampleCount: 1,
      valid: true,
    });
    expect(dynamic.isReusable(signature())).toBe(false);
    expect(dynamic.isReusable(signature({ materials: 2 }))).toBe(true);
  });

  it('invalidates explicitly and disposes idempotently', () => {
    const history = new TemporalHistory({ kind: 'static', ownerId: 'capture' });
    history.recordSample(signature());

    expect(history.invalidate('camera')).toMatchObject({
      generation: 1,
      lastInvalidation: 'camera',
      sampleCount: 0,
      valid: false,
    });
    history.dispose();
    history.dispose();
    expect(history.snapshot()).toMatchObject({
      disposed: true,
      generation: 2,
      lastInvalidation: 'disposed',
    });
    expect(() => history.recordSample(signature())).toThrowError(
      expect.objectContaining({ code: 'ALREADY_DISPOSED' }),
    );
  });
});

describe('temporal convergence contract', () => {
  it('converges exactly at a fixed sample target and never increments past it', () => {
    const tracker = new TemporalConvergenceTracker({ targetSamples: 3 });

    expect(tracker.recordSample()).toMatchObject({ converged: false, sampleCount: 1 });
    expect(tracker.recordSample()).toMatchObject({ converged: false, sampleCount: 2 });
    expect(tracker.recordSample()).toMatchObject({
      converged: true,
      reason: 'sample-limit',
      sampleCount: 3,
    });
    expect(tracker.recordSample()).toMatchObject({ sampleCount: 3 });
    expect(tracker.reset()).toMatchObject({ converged: false, sampleCount: 0 });
  });

  it('requires consecutive stable errors after the minimum sample count', () => {
    const tracker = new TemporalConvergenceTracker({
      errorThreshold: 0.01,
      minimumSamples: 3,
      stableSamples: 2,
      targetSamples: 8,
    });

    tracker.recordSample(0.2);
    tracker.recordSample(0.005);
    expect(tracker.recordSample(0.02)).toMatchObject({
      consecutiveStableSamples: 0,
      converged: false,
      sampleCount: 3,
    });
    tracker.recordSample(0.01);
    expect(tracker.recordSample(0.001)).toMatchObject({
      converged: true,
      reason: 'error-threshold',
      sampleCount: 5,
    });
  });

  it('rejects unsafe sample and error policies', () => {
    expect(() => new TemporalConvergenceTracker({ targetSamples: 0 })).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    );
    expect(
      () => new TemporalConvergenceTracker({ errorThreshold: -1, targetSamples: 4 }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    const tracker = new TemporalConvergenceTracker({ targetSamples: 2 });
    expect(() => tracker.recordSample(Number.NaN)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    );
  });
});

describe('temporal Halton jitter contract', () => {
  it('produces the frozen deterministic base-2/base-3 prefix', () => {
    const samples = createTemporalJitterSequence(4);

    expect(samples.map(({ unitSample }) => unitSample)).toEqual([
      [0.5, 1 / 3],
      [0.25, 2 / 3],
      [0.75, 1 / 9],
      [0.125, 4 / 9],
    ]);
    expect(samples.map(({ rasterOffsetPixels }) => rasterOffsetPixels)).toEqual([
      [0, 1 / 3 - 0.5],
      [-0.25, 2 / 3 - 0.5],
      [0.25, 1 / 9 - 0.5],
      [-0.375, 4 / 9 - 0.5],
    ]);
    expect(Object.isFrozen(samples)).toBe(true);
    expect(samples.every(Object.isFrozen)).toBe(true);
  });

  it('converts right/down raster offsets into right/up canonical NDC', () => {
    const converted = temporalJitterToNdc(createTemporalJitterSample(2), {
      height: 500,
      width: 1000,
    });

    expect(converted.rasterOffsetPixels).toEqual([-0.25, 2 / 3 - 0.5]);
    expect(converted.ndcOffset[0]).toBeCloseTo(-0.0005, 15);
    expect(converted.ndcOffset[1]).toBeCloseTo(-1 / 1500, 15);
  });

  it('keeps all 256 supported samples inside the half-pixel cell and rejects invalid input', () => {
    const samples = createTemporalJitterSequence(256);
    expect(
      samples.every(({ rasterOffsetPixels: [x, y] }) =>
        [x, y].every((value) => value >= -0.5 && value < 0.5),
      ),
    ).toBe(true);
    expect(() => createTemporalJitterSample(0)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    );
    expect(() =>
      temporalJitterToNdc(createTemporalJitterSample(1), { height: 0, width: 1 }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  });
});
