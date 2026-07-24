import { readFile, writeFile } from 'node:fs/promises';

const path = 'packages/renderer/test/dynamic-taa-resolve-pass.test.ts';
let source = await readFile(path, 'utf8');
source = source.replace(
  `packs the two matrices, viewport, History state, responsive mask, and frozen options`,
  `packs temporal matrices, jitter, History state, and complete TRAA options`,
);
source = source.replace(
  `      options: {
        baseHistoryWeight: 0.72,
        depthAbsoluteThreshold: 0.002,
        depthRelativeThreshold: 0.03,
        normalRejectionCosine: 0.78,
        responsiveHistoryReduction: 0.64,
      },`,
  `      currentJitterNdcOffset: [0.01, -0.02],
      options: {
        baseHistoryWeight: 0.72,
        depthAbsoluteThreshold: 0.002,
        depthRelativeThreshold: 0.03,
        edgeDepthDifference: 0.004,
        flickerReduction: 0.6,
        maxVelocityLength: 96,
        minimumCurrentWeight: 0.05,
        normalRejectionCosine: 0.78,
        responsiveHistoryReduction: 0.64,
        subpixelCorrection: 0.7,
        varianceClipGamma: 1.25,
      },
      previousJitterNdcOffset: [-0.03, 0.04],`,
);
source = source.replace(
  `    expect(DYNAMIC_TAA_RESOLVE_UNIFORM_LAYOUT).toEqual({
      byteLength: 176,
      currentInverseViewProjectionOffset: 0,
      options0Offset: 144,
      options1Offset: 160,
      previousViewProjectionOffset: 64,
      viewportHistoryResponsiveOffset: 128,
    });
    expect(packed.byteLength).toBe(176);
    expect(Array.from(packed.slice(0, 16))).toEqual(currentInverseViewProjection);
    expect(Array.from(packed.slice(16, 32))).toEqual(previousViewProjection);
    expect(Array.from(packed.slice(32, 36))).toEqual([5, 3, 0, 0.25]);
    expect(Array.from(packed.slice(36, 41))).toEqual([
      Math.fround(0.72),
      Math.fround(0.002),
      Math.fround(0.03),
      Math.fround(0.78),
      Math.fround(0.64),
    ]);
    expect(Array.from(packed.slice(41))).toEqual([0, 0, 0]);`,
  `    expect(DYNAMIC_TAA_RESOLVE_UNIFORM_LAYOUT).toEqual({
      byteLength: 336,
      currentInverseViewProjectionOffset: 0,
      previousViewProjectionOffset: 64,
      currentViewProjectionOffset: 128,
      previousInverseViewProjectionOffset: 192,
      viewportHistoryResponsiveOffset: 256,
      jitterOffsetsOffset: 272,
      options0Offset: 288,
      options1Offset: 304,
      options2Offset: 320,
    });
    expect(packed.byteLength).toBe(336);
    expect(Array.from(packed.slice(0, 16))).toEqual(currentInverseViewProjection);
    expect(Array.from(packed.slice(16, 32))).toEqual(previousViewProjection);
    expect(Array.from(packed.slice(64, 68))).toEqual([5, 3, 0, 0.25]);
    expect(Array.from(packed.slice(68, 72))).toEqual([
      Math.fround(0.01),
      Math.fround(-0.02),
      Math.fround(-0.03),
      Math.fround(0.04),
    ]);
    expect(Array.from(packed.slice(72, 83))).toEqual([
      Math.fround(0.72),
      Math.fround(0.002),
      Math.fround(0.03),
      Math.fround(0.78),
      Math.fround(0.64),
      Math.fround(0.004),
      96,
      Math.fround(0.05),
      Math.fround(1.25),
      Math.fround(0.7),
      Math.fround(0.6),
    ]);
    expect(Array.from(packed.slice(83))).toEqual([0]);`,
);
source = source.replace(
  `          { binding: 2, resource: { texture: first.writeDepthTexture } },
          { binding: 3, resource: { texture: first.writeNormalTexture } },
          { binding: 4, resource: { texture: first.readColorTexture } },
          { binding: 5, resource: { texture: first.readDepthTexture } },
          { binding: 6, resource: { texture: first.readNormalTexture } },
          { binding: 7, resource: { sampler: first.sampler } },`,
  `          { binding: 2, resource: { texture: first.writeDepthTexture } },
          { binding: 3, resource: { texture: first.writeNormalTexture } },
          { binding: 4, resource: { texture: first.currentVelocityTexture } },
          { binding: 5, resource: { texture: first.readColorTexture } },
          { binding: 6, resource: { texture: first.readDepthTexture } },
          { binding: 7, resource: { texture: first.readNormalTexture } },
          { binding: 8, resource: { sampler: first.sampler } },`,
);
source = source.replace(
  `      activeCount: 12,
      byKind: {
        'bind-group': { activeCount: 1 },
        buffer: { activeCount: 1, activeEstimatedBytes: 176 },
        pipeline: { activeCount: 1 },
        sampler: { activeCount: 1 },
        'shader-module': { activeCount: 1 },
        texture: { activeCount: 7, activeEstimatedBytes: 1152 },
      },`,
  `      activeCount: 13,
      byKind: {
        'bind-group': { activeCount: 1 },
        buffer: { activeCount: 1, activeEstimatedBytes: 336 },
        pipeline: { activeCount: 1 },
        sampler: { activeCount: 1 },
        'shader-module': { activeCount: 1 },
        texture: { activeCount: 8, activeEstimatedBytes: 1248 },
      },`,
);
await writeFile(path, source, 'utf8');
