import { editAll } from './helpers.mjs';

await editAll('packages/renderer/test/dynamic-taa-present-pass.test.ts', [
  [
    `    expect(backend.getResourceStatistics()).toMatchObject({
      activeCount: 13,
      byKind: {
        'bind-group': { activeCount: 1 },
        buffer: { activeCount: 1, activeEstimatedBytes: 16 },
        pipeline: { activeCount: 1 },
        sampler: { activeCount: 1 },
        'shader-module': { activeCount: 1 },
        surface: { activeCount: 1 },
        texture: { activeCount: 7, activeEstimatedBytes: 1152 },
      },
    });`,
    `    expect(backend.getResourceStatistics()).toMatchObject({
      activeCount: 14,
      byKind: {
        'bind-group': { activeCount: 1 },
        buffer: { activeCount: 1, activeEstimatedBytes: 16 },
        pipeline: { activeCount: 1 },
        sampler: { activeCount: 1 },
        'shader-module': { activeCount: 1 },
        surface: { activeCount: 1 },
        texture: { activeCount: 8, activeEstimatedBytes: 1248 },
      },
    });`,
  ],
]);

await editAll('packages/renderer/test/pbr-render-feature.test.ts', [
  [
    `        {
          clearColor: { a: 1, b: 1, g: 0.5, r: 0.5 },
          texture: frame.writeNormalTexture,
        },
      ],`,
    `        {
          clearColor: { a: 1, b: 1, g: 0.5, r: 0.5 },
          texture: frame.writeNormalTexture,
        },
        {
          clearColor: { a: 0, b: 0, g: 0, r: 0 },
          texture: frame.currentVelocityTexture,
        },
      ],`,
  ],
]);
