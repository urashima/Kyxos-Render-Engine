import { readFile, writeFile } from 'node:fs/promises';

function replaceOnce(source, search, replacement, label) {
  const index = source.indexOf(search);
  if (index < 0) throw new Error(`P4-08 amend anchor not found: ${label}`);
  if (source.indexOf(search, index + search.length) >= 0) {
    throw new Error(`P4-08 amend anchor is not unique: ${label}`);
  }
  return source.slice(0, index) + replacement + source.slice(index + search.length);
}

const path = 'packages/renderer/src/pbr-render-feature.ts';
let source = await readFile(path, 'utf8');
source = replaceOnce(
  source,
  "    if (resources.depthTexture === undefined) {\n      throw this.#error('PBR depth Texture is unavailable for a visible Surface.', 'INVALID_STATE');\n    }",
  "    const surfaceDepthTexture = resources.depthTexture;\n    if (this.#dynamicTaaOutput === undefined && surfaceDepthTexture === undefined) {\n      throw this.#error('PBR depth Texture is unavailable for a visible Surface.', 'INVALID_STATE');\n    }",
  'surface-only Depth requirement',
);
source = replaceOnce(
  source,
  '            depthAttachment: { texture: resources.depthTexture },',
  '            depthAttachment: { texture: surfaceDepthTexture as BackendTextureHandle },',
  'narrowed Surface Depth attachment',
);
await writeFile(path, source);

const docsPath = 'docs/research/phase-04-temporal-state-contract.md';
const docs = await readFile(docsPath, 'utf8');
if (docs.includes('## PBR temporal offscreen output')) {
  throw new Error('P4-08 documentation section already exists.');
}
const section = [
  '',
  '## PBR temporal offscreen output',
  '',
  'P4-08 adds an opt-in output mode to the existing forward PBR Render Feature. The default accepted',
  'Phase 3 Surface path retains its original tone-mapped sRGB Shader, one Color target, `depth24plus`',
  'Depth owner, Pipeline variants, and public behavior. Supplying `dynamicTaaOutput.acquireFrame` selects',
  'a separate Shader and Pipeline family that writes linear-HDR `rgba16float` Color at location 0,',
  'world-space Normal encoded from `[-1, 1]` into `[0, 1]` in `rgba16float` at location 1, and canonical',
  'WebGPU Depth into the caller-prepared `depth32float` write target.',
  '',
  'The Render Feature validates that the immutable frame extent exactly matches the physical Surface',
  'extent and records the non-empty temporal Owner ID. It acquires one frame per submission but never',
  'commits, cancels, resizes, swaps, or disposes caller-owned History resources. The caller order remains',
  '`prepare frame → PBR scene MRT → Dynamic TAA resolve → commit frame`. Resize therefore updates only',
  'the Surface/Camera contract in temporal mode; the next render fails closed until the caller has resized',
  'History to the same physical extent. Device Lost clears only cached Feature resources and diagnostic',
  'Owner identity; existing History recovery remains independently owned.',
  '',
  'Opaque and Mask materials write unit Alpha to Current Color; Blend preserves the material Alpha and',
  'uses the existing Color blend contract while the encoded Normal attachment remains unblended. Final',
  'Present, Output Transform, Static Accumulation, Motion Vectors for deforming geometry, Render Graph',
  'scheduling, the Phase 4 route, and acceptance remain subsequent checkpoints.',
  '',
].join('\n');
await writeFile(docsPath, docs.trimEnd() + '\n' + section);
