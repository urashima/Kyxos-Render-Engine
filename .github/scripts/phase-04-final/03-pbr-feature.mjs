import { replaceExact } from './helpers.mjs';

await replaceExact(
  'packages/renderer/src/pbr-render-feature.ts',
  `const TEMPORAL_NORMAL_FORMAT = 'rgba16float' as const;`,
  `const TEMPORAL_NORMAL_FORMAT = 'rgba16float' as const;
const TEMPORAL_VELOCITY_FORMAT = 'rg16float' as const;`,
);
await replaceExact(
  'packages/renderer/src/pbr-render-feature.ts',
  `const TEMPORAL_NORMAL_CLEAR_COLOR: BackendClearColor = Object.freeze({
  a: 1,
  b: 1,
  g: 0.5,
  r: 0.5,
});`,
  `const TEMPORAL_NORMAL_CLEAR_COLOR: BackendClearColor = Object.freeze({
  a: 1,
  b: 1,
  g: 0.5,
  r: 0.5,
});
const TEMPORAL_VELOCITY_CLEAR_COLOR: BackendClearColor = Object.freeze({
  a: 0,
  b: 0,
  g: 0,
  r: 0,
});`,
);
await replaceExact(
  'packages/renderer/src/pbr-render-feature.ts',
  `  /** Optional jittered View-Projection supplied by the temporal owner for this frame. */
  readonly acquireViewProjectionMatrix?: () => Mat4;`,
  `  /** Optional jittered View-Projection supplied by the temporal owner for this frame. */
  readonly acquireViewProjectionMatrix?: () => Mat4;
  /** Optional unjittered current View-Projection used for explicit object Velocity. */
  readonly acquireCurrentMotionViewProjectionMatrix?: () => Mat4;
  /** Optional unjittered previous View-Projection used for explicit object Velocity. */
  readonly acquirePreviousMotionViewProjectionMatrix?: () => Mat4;`,
);
await replaceExact(
  'packages/renderer/src/pbr-render-feature.ts',
  `  readonly #objectResources = new Map<EntityHandle, ObjectGpuResources>();`,
  `  readonly #objectResources = new Map<EntityHandle, ObjectGpuResources>();
  readonly #previousWorldMatrices = new Map<EntityHandle, Mat4>();`,
);
await replaceExact(
  'packages/renderer/src/pbr-render-feature.ts',
  `      if (
        options.dynamicTaaOutput.acquireViewProjectionMatrix !== undefined &&
        typeof options.dynamicTaaOutput.acquireViewProjectionMatrix !== 'function'
      ) {
        throw new KyxosEngineError('PBR Dynamic TAA View-Projection provider must be a function.', {
          code: 'INVALID_ARGUMENT',
          module: 'renderer',
          recoverable: false,
        });
      }`,
  `      for (const [label, provider] of [
        ['View-Projection', options.dynamicTaaOutput.acquireViewProjectionMatrix],
        [
          'current Motion View-Projection',
          options.dynamicTaaOutput.acquireCurrentMotionViewProjectionMatrix,
        ],
        [
          'previous Motion View-Projection',
          options.dynamicTaaOutput.acquirePreviousMotionViewProjectionMatrix,
        ],
      ] as const) {
        if (provider !== undefined && typeof provider !== 'function') {
          throw new KyxosEngineError(\`PBR Dynamic TAA ${'${label}'} provider must be a function.\`, {
            code: 'INVALID_ARGUMENT',
            module: 'renderer',
            recoverable: false,
          });
        }
      }`,
);
await replaceExact(
  'packages/renderer/src/pbr-render-feature.ts',
  `        { clearColor: TEMPORAL_NORMAL_CLEAR_COLOR, texture: frame.writeNormalTexture },
      ],`,
  `        { clearColor: TEMPORAL_NORMAL_CLEAR_COLOR, texture: frame.writeNormalTexture },
        { clearColor: TEMPORAL_VELOCITY_CLEAR_COLOR, texture: frame.currentVelocityTexture },
      ],`,
);
await replaceExact(
  'packages/renderer/src/pbr-render-feature.ts',
  `              { format: TEMPORAL_NORMAL_FORMAT },
            ]`,
  `              { format: TEMPORAL_NORMAL_FORMAT },
              { format: TEMPORAL_VELOCITY_FORMAT },
            ]`,
);
await replaceExact(
  'packages/renderer/src/pbr-render-feature.ts',
  `        output: this.#output,
        viewProjectionMatrix:
          this.#dynamicTaaOutput?.acquireViewProjectionMatrix?.() ??
          this.#camera.viewProjectionMatrix(),
        worldMatrix: item.worldMatrix,`,
  `        currentMotionViewProjectionMatrix:
          this.#dynamicTaaOutput?.acquireCurrentMotionViewProjectionMatrix?.(),
        output: this.#output,
        previousMotionViewProjectionMatrix:
          this.#dynamicTaaOutput?.acquirePreviousMotionViewProjectionMatrix?.(),
        previousWorldMatrix: this.#previousWorldMatrices.get(item.entity) ?? item.worldMatrix,
        viewProjectionMatrix:
          this.#dynamicTaaOutput?.acquireViewProjectionMatrix?.() ??
          this.#camera.viewProjectionMatrix(),
        worldMatrix: item.worldMatrix,`,
);
await replaceExact(
  'packages/renderer/src/pbr-render-feature.ts',
  `    try {
      return context.backend.executeFrame({ commandEncoder, renderPasses: [renderPass] });
    } catch (error) {`,
  `    try {
      const statistics = context.backend.executeFrame({ commandEncoder, renderPasses: [renderPass] });
      if (this.#dynamicTaaOutput !== undefined) {
        for (const item of [...queues.opaque, ...queues.transparent]) {
          this.#previousWorldMatrices.set(item.entity, item.worldMatrix);
        }
      }
      return statistics;
    } catch (error) {`,
);
await replaceExact(
  'packages/renderer/src/pbr-render-feature.ts',
  `    this.#objectResources.clear();
    this.#textureResources.clear();
    this.#lastFallbackDrawCount = 0;`,
  `    this.#objectResources.clear();
    this.#previousWorldMatrices.clear();
    this.#textureResources.clear();
    this.#lastFallbackDrawCount = 0;`,
);
await replaceExact(
  'packages/renderer/src/pbr-render-feature.ts',
  `    this.#meshResources.clear();
    this.#objectResources.clear();
    this.#textureResources.clear();`,
  `    this.#meshResources.clear();
    this.#objectResources.clear();
    this.#previousWorldMatrices.clear();
    this.#textureResources.clear();`,
);
await replaceExact(
  'packages/renderer/src/pbr-render-feature.ts',
  `      this.#objectResources.delete(entity);
    }`,
  `      this.#objectResources.delete(entity);
      this.#previousWorldMatrices.delete(entity);
    }`,
);
