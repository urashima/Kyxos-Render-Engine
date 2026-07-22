import { transformPointMat4 } from '@kyxos/render-math';
import { createTemporalJitterSample, temporalJitterToNdc } from '@kyxos/render-temporal';
import { describe, expect, it } from 'vitest';

import {
  PerspectiveCamera,
  TemporalCameraMatrixTracker,
  applyProjectionJitter,
} from '../src/index.js';

describe('Temporal Camera matrices', () => {
  it('applies the exact NDC translation without mutating the canonical projection', () => {
    const camera = new PerspectiveCamera({
      aspect: 2,
      far: 100,
      near: 0.1,
      position: [0, 0, 0],
      target: [0, 0, -1],
    });
    const projection = camera.projectionMatrix();
    const jitter = temporalJitterToNdc(createTemporalJitterSample(2), {
      height: 500,
      width: 1000,
    });
    const jittered = applyProjectionJitter(projection, jitter.ndcOffset);

    expect(jittered).not.toBe(projection);
    expect(projection[8]).toBe(0);
    expect(projection[9]).toBe(0);
    const projected = transformPointMat4(jittered, [0, 0, -1]);
    expect(projected[0]).toBeCloseTo(jitter.ndcOffset[0], 15);
    expect(projected[1]).toBeCloseTo(jitter.ndcOffset[1], 15);
    expect(applyProjectionJitter(projection, [0, 0])).toBe(projection);
  });

  it('retains the previous jittered matrix across Camera motion in one history generation', () => {
    const camera = new PerspectiveCamera();
    const tracker = new TemporalCameraMatrixTracker({ camera });
    const first = tracker.update({
      historyGeneration: 1,
      jitter: createTemporalJitterSample(1),
      viewport: { height: 720, width: 1280 },
    });
    expect(first).toMatchObject({
      cameraRevision: 0,
      historyReset: true,
      historyResetReason: 'first-frame',
      previousCameraRevision: 0,
    });
    expect(first.previousViewProjection).toBe(first.currentViewProjection);

    camera.setPose({ position: [1, 0, 5], target: [0, 0, 0] });
    const second = tracker.update({
      historyGeneration: 1,
      jitter: createTemporalJitterSample(2),
      viewport: { height: 720, width: 1280 },
    });
    expect(second).toMatchObject({
      cameraRevision: 1,
      historyReset: false,
      historyResetReason: null,
      previousCameraRevision: 0,
    });
    expect(second.previousViewProjection).toBe(first.currentViewProjection);
    expect(second.previousJitterNdcOffset).toEqual(first.jitter.ndcOffset);
    expect(second.currentViewProjection).not.toEqual(first.currentViewProjection);
  });

  it('fails closed for generation, projection, viewport, and explicit resets', () => {
    const camera = new PerspectiveCamera();
    const tracker = new TemporalCameraMatrixTracker({ camera });
    const update = (historyGeneration: number, width = 800) =>
      tracker.update({ historyGeneration, viewport: { height: 600, width } });

    update(1);
    expect(update(2)).toMatchObject({
      historyReset: true,
      historyResetReason: 'history-generation',
    });
    camera.setAspect(2);
    expect(update(2)).toMatchObject({ historyReset: true, historyResetReason: 'projection' });
    expect(update(2, 801)).toMatchObject({ historyReset: true, historyResetReason: 'viewport' });
    tracker.reset();
    expect(update(2, 801)).toMatchObject({
      historyReset: true,
      historyResetReason: 'first-frame',
    });
  });

  it('owns no Camera and rejects invalid or post-disposal updates', () => {
    const camera = new PerspectiveCamera();
    const tracker = new TemporalCameraMatrixTracker({ camera });
    expect(() =>
      tracker.update({ historyGeneration: -1, viewport: { height: 1, width: 1 } }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    expect(() =>
      tracker.update({ historyGeneration: 0, viewport: { height: 0, width: 1 } }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    tracker.dispose();
    tracker.dispose();
    expect(camera.disposed).toBe(false);
    expect(() =>
      tracker.update({ historyGeneration: 0, viewport: { height: 1, width: 1 } }),
    ).toThrowError(expect.objectContaining({ code: 'ALREADY_DISPOSED' }));
    camera.dispose();
  });
});
