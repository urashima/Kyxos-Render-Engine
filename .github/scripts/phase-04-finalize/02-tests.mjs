import { readFile, writeFile } from 'node:fs/promises';

async function transform(path, fn) {
  const source = await readFile(path, 'utf8');
  const result = fn(source);
  if (result === source) throw new Error(`${path}: transformation made no changes`);
  await writeFile(path, result, 'utf8');
}

await transform('packages/renderer/test/dynamic-taa-gpu-history.test.ts', (source) => {
  source = source.replace(
    `owns Current HDR plus resolved Color/Depth/Normal ping-pong sets`,
    `owns current HDR and Velocity plus resolved Color/Depth/Normal ping-pong sets`,
  );
  source = source.replace(`estimatedGpuBytes: 384`, `estimatedGpuBytes: 416`);
  source = source.replace(`toHaveBeenCalledTimes(7)`, `toHaveBeenCalledTimes(8)`);
  const oldCalls = `    expect(createTexture).toHaveBeenNthCalledWith(2, {
      format: 'rgba16float',
      label: 'taa-history-viewport-a-0-color',
      size: { height: 2, width: 4 },
      usage: ['render-attachment', 'sampled'],
    });
    expect(createTexture).toHaveBeenNthCalledWith(3, {
      format: 'depth32float',
      label: 'taa-history-viewport-a-0-depth',
      size: { height: 2, width: 4 },
      usage: ['render-attachment', 'sampled'],
    });
    expect(createTexture).toHaveBeenNthCalledWith(4, {
      format: 'rgba16float',
      label: 'taa-history-viewport-a-0-normal',
      size: { height: 2, width: 4 },
      usage: ['render-attachment', 'sampled'],
    });
    expect(createTexture).toHaveBeenNthCalledWith(5, {
      format: 'rgba16float',
      label: 'taa-history-viewport-a-1-color',
      size: { height: 2, width: 4 },
      usage: ['render-attachment', 'sampled'],
    });
    expect(createTexture).toHaveBeenNthCalledWith(6, {
      format: 'depth32float',
      label: 'taa-history-viewport-a-1-depth',
      size: { height: 2, width: 4 },
      usage: ['render-attachment', 'sampled'],
    });
    expect(createTexture).toHaveBeenNthCalledWith(7, {
      format: 'rgba16float',
      label: 'taa-history-viewport-a-1-normal',
      size: { height: 2, width: 4 },
      usage: ['render-attachment', 'sampled'],
    });`;
  const newCalls = `    expect(createTexture).toHaveBeenNthCalledWith(2, {
      format: 'rg16float',
      label: 'taa-history-viewport-a-current-velocity',
      size: { height: 2, width: 4 },
      usage: ['render-attachment', 'sampled'],
    });
    expect(createTexture).toHaveBeenNthCalledWith(3, {
      format: 'rgba16float',
      label: 'taa-history-viewport-a-0-color',
      size: { height: 2, width: 4 },
      usage: ['render-attachment', 'sampled'],
    });
    expect(createTexture).toHaveBeenNthCalledWith(4, {
      format: 'depth32float',
      label: 'taa-history-viewport-a-0-depth',
      size: { height: 2, width: 4 },
      usage: ['render-attachment', 'sampled'],
    });
    expect(createTexture).toHaveBeenNthCalledWith(5, {
      format: 'rgba16float',
      label: 'taa-history-viewport-a-0-normal',
      size: { height: 2, width: 4 },
      usage: ['render-attachment', 'sampled'],
    });
    expect(createTexture).toHaveBeenNthCalledWith(6, {
      format: 'rgba16float',
      label: 'taa-history-viewport-a-1-color',
      size: { height: 2, width: 4 },
      usage: ['render-attachment', 'sampled'],
    });
    expect(createTexture).toHaveBeenNthCalledWith(7, {
      format: 'depth32float',
      label: 'taa-history-viewport-a-1-depth',
      size: { height: 2, width: 4 },
      usage: ['render-attachment', 'sampled'],
    });
    expect(createTexture).toHaveBeenNthCalledWith(8, {
      format: 'rgba16float',
      label: 'taa-history-viewport-a-1-normal',
      size: { height: 2, width: 4 },
      usage: ['render-attachment', 'sampled'],
    });`;
  source = source.replace(oldCalls, newCalls);
  source = source.replace(
    `      activeCount: 8,
      activeEstimatedBytes: 384,
      byKind: {
        sampler: { activeCount: 1 },
        texture: { activeCount: 7, activeEstimatedBytes: 384 },
      },
      createdTotal: 8,`,
    `      activeCount: 9,
      activeEstimatedBytes: 416,
      byKind: {
        sampler: { activeCount: 1 },
        texture: { activeCount: 8, activeEstimatedBytes: 416 },
      },
      createdTotal: 9,`,
  );
  source = source.replace(
    `    expect(second.currentColorTexture).toBe(first.currentColorTexture);`,
    `    expect(second.currentColorTexture).toBe(first.currentColorTexture);
    expect(second.currentVelocityTexture).toBe(first.currentVelocityTexture);`,
  );
  source = source.replaceAll(`estimatedGpuBytes: 1536`, `estimatedGpuBytes: 1664`);
  source = source.replace(
    `      activeCount: 8,
      activeEstimatedBytes: 1536,
      createdTotal: 16,
      destroyedTotal: 8,`,
    `      activeCount: 9,
      activeEstimatedBytes: 1664,
      createdTotal: 18,
      destroyedTotal: 9,`,
  );
  source = source.replace(
    `    expect(after.currentColorTexture).not.toBe(before.currentColorTexture);`,
    `    expect(after.currentColorTexture).not.toBe(before.currentColorTexture);
    expect(after.currentVelocityTexture).not.toBe(before.currentVelocityTexture);`,
  );
  source = source.replace(
    `    expect(restored.currentColorTexture).not.toBe(before.currentColorTexture);`,
    `    expect(restored.currentColorTexture).not.toBe(before.currentColorTexture);
    expect(restored.currentVelocityTexture).not.toBe(before.currentVelocityTexture);`,
  );
  source = source.replace(
    `      activeCount: 8,
      createdTotal: 16,
      destroyedTotal: 8,`,
    `      activeCount: 9,
      createdTotal: 18,
      destroyedTotal: 9,`,
  );
  source = source.replace(
    `      activeCount: 8,
      createdTotal: 9,
      destroyedTotal: 1,`,
    `      activeCount: 9,
      createdTotal: 10,
      destroyedTotal: 1,`,
  );
  source = source.replace(
    `    expect(after.currentColorTexture).toBe(before.currentColorTexture);`,
    `    expect(after.currentColorTexture).toBe(before.currentColorTexture);
    expect(after.currentVelocityTexture).toBe(before.currentVelocityTexture);`,
  );
  source = source.replace(
    `      createdTotal: 9,
      destroyedTotal: 9,`,
    `      createdTotal: 10,
      destroyedTotal: 10,`,
  );
  return source;
});

await transform('packages/renderer/test/dynamic-taa-present-pass.test.ts', (source) =>
  source.replace(`getResourceStatistics().activeCount).toBe(8)`, `getResourceStatistics().activeCount).toBe(9)`),
);

await transform('packages/renderer/test/pbr-render-feature.test.ts', (source) => {
  source = source.replace(`stable 448-byte`, `stable 576-byte`);
  source = source.replace(`expect(packed).toHaveLength(112)`, `expect(packed).toHaveLength(144)`);
  source = source.replaceAll(`data.length === 112`, `data.length === 144`);
  source = source.replaceAll(`uniforms.length === 112`, `uniforms.length === 144`);
  source = source.replace(
    `expect(descriptor.fragment?.targets?.map(({ format }) => format)).toEqual([
        'rgba16float',
        'rgba16float',
      ]);`,
    `expect(descriptor.fragment?.targets?.map(({ format }) => format)).toEqual([
        'rgba16float',
        'rgba16float',
        'rg16float',
      ]);`,
  );
  source = source.replace(
    `          { clearColor: expect.any(Object), texture: frame.writeNormalTexture },`,
    `          { clearColor: expect.any(Object), texture: frame.writeNormalTexture },
          { clearColor: expect.any(Object), texture: frame.currentVelocityTexture },`,
  );
  return source;
});

await transform('packages/renderer/test/temporal-taa-settings.test.ts', (source) => {
  source = source.replace(
    `resolve: TEMPORAL_TAA_DEFAULT_OPTIONS,`,
    `resolve: {
        ...TEMPORAL_TAA_DEFAULT_OPTIONS,
        edgeDepthDifference: 0,
        flickerReduction: 0,
        maxVelocityLength: 128,
        minimumCurrentWeight: 0,
        subpixelCorrection: 0,
        varianceClipGamma: 0,
      },`,
  );
  source = source.replace(
    `        responsiveHistoryReduction: 0.75,
      },`,
    `        responsiveHistoryReduction: 0.75,
        edgeDepthDifference: 0,
        flickerReduction: 0,
        maxVelocityLength: 128,
        minimumCurrentWeight: 0,
        subpixelCorrection: 0,
        varianceClipGamma: 0,
      },`,
  );
  source = source.replace(
    `    expect(() => createTemporalTaaSettings({ responsiveMask: Number.NaN })).toThrow(`,
    `    expect(() => createTemporalTaaSettings({ maxVelocityLength: 0 })).toThrow(
      'maximum Velocity length',
    );
    expect(() => createTemporalTaaSettings({ varianceClipGamma: -0.01 })).toThrow(
      'variance clip gamma',
    );
    expect(() => createTemporalTaaSettings({ responsiveMask: Number.NaN })).toThrow(`,
  );
  return source;
});
