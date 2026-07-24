import { replaceExact } from './helpers.mjs';

await replaceExact(
  'packages/renderer/src/pbr-render-feature.ts',
  `        currentMotionViewProjectionMatrix:
          this.#dynamicTaaOutput?.acquireCurrentMotionViewProjectionMatrix?.(),
        output: this.#output,
        previousMotionViewProjectionMatrix:
          this.#dynamicTaaOutput?.acquirePreviousMotionViewProjectionMatrix?.(),
        previousWorldMatrix: this.#previousWorldMatrices.get(item.entity) ?? item.worldMatrix,`,
  `        ...(this.#dynamicTaaOutput?.acquireCurrentMotionViewProjectionMatrix === undefined
          ? {}
          : {
              currentMotionViewProjectionMatrix:
                this.#dynamicTaaOutput.acquireCurrentMotionViewProjectionMatrix(),
            }),
        output: this.#output,
        ...(this.#dynamicTaaOutput?.acquirePreviousMotionViewProjectionMatrix === undefined
          ? {}
          : {
              previousMotionViewProjectionMatrix:
                this.#dynamicTaaOutput.acquirePreviousMotionViewProjectionMatrix(),
            }),
        previousWorldMatrix: this.#previousWorldMatrices.get(item.entity) ?? item.worldMatrix,`,
);
