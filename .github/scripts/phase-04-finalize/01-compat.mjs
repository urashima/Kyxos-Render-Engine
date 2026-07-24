import { editAll } from './helpers.mjs';

await editAll('packages/renderer/src/dynamic-taa-resolve-pass.ts', [
  [
    `import type { Mat4 } from '@kyxos/render-math';`,
    `import { inverseMat4 } from '@kyxos/render-math';\nimport type { Mat4 } from '@kyxos/render-math';`,
  ],
  [`  readonly currentViewProjection: Mat4;`, `  readonly currentViewProjection?: Mat4;`],
  [
    `  readonly previousInverseViewProjection: Mat4;`,
    `  readonly previousInverseViewProjection?: Mat4;`,
  ],
  [
    `  copyMatrix(values, 32, input.currentViewProjection, 'Current View-Projection');`,
    `  copyMatrix(\n    values,\n    32,\n    input.currentViewProjection ?? inverseMat4(input.currentInverseViewProjection),\n    'Current View-Projection',\n  );`,
  ],
  [
    `  copyMatrix(values, 48, input.previousInverseViewProjection, 'Previous inverse View-Projection');`,
    `  copyMatrix(\n    values,\n    48,\n    input.previousInverseViewProjection ?? inverseMat4(input.previousViewProjection),\n    'Previous inverse View-Projection',\n  );`,
  ],
]);

await editAll('packages/renderer/src/temporal-pipeline-transaction.ts', [
  [`  readonly currentViewProjection: Mat4;`, `  readonly currentViewProjection?: Mat4;`],
  [
    `  readonly previousInverseViewProjection: Mat4;`,
    `  readonly previousInverseViewProjection?: Mat4;`,
  ],
  [
    `          currentViewProjection: input.currentViewProjection,`,
    `          ...(input.currentViewProjection === undefined\n            ? {}\n            : { currentViewProjection: input.currentViewProjection }),`,
  ],
  [
    `          previousInverseViewProjection: input.previousInverseViewProjection,`,
    `          ...(input.previousInverseViewProjection === undefined\n            ? {}\n            : { previousInverseViewProjection: input.previousInverseViewProjection }),`,
  ],
]);
