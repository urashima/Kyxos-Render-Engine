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
  '            depthAttachment: { texture: surfaceDepthTexture },',
  'narrowed Surface Depth attachment',
);
await writeFile(path, source);
