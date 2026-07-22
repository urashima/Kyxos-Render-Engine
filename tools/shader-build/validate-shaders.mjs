import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const shaderRoot = path.join(root, 'shaders');
const generatedMirrors = new Map([
  [
    'webgpu/phase-01-basic.wgsl',
    {
      exportName: 'PHASE_01_BASIC_WGSL',
      path: 'packages/renderer/src/generated/phase-01-basic.wgsl.ts',
    },
  ],
  [
    'webgpu/phase-02-scene.wgsl',
    {
      exportName: 'PHASE_02_SCENE_WGSL',
      path: 'packages/renderer/src/generated/phase-02-scene.wgsl.ts',
    },
  ],
  [
    'webgpu/phase-03-brdf-reference.wgsl',
    {
      exportName: 'PHASE_03_BRDF_REFERENCE_WGSL',
      path: 'packages/material-pbr/src/generated/phase-03-brdf-reference.wgsl.ts',
    },
  ],
  [
    'webgpu/phase-03-ibl-reference.wgsl',
    {
      exportName: 'PHASE_03_IBL_REFERENCE_WGSL',
      path: 'packages/material-pbr/src/generated/phase-03-ibl-reference.wgsl.ts',
    },
  ],
  [
    'webgpu/phase-03-pbr-direct.wgsl',
    {
      exportName: 'PHASE_03_PBR_DIRECT_WGSL',
      path: 'packages/renderer/src/generated/phase-03-pbr-direct.wgsl.ts',
    },
  ],
  [
    'webgpu/phase-03-pbr-ibl.wgsl',
    {
      exportName: 'PHASE_03_PBR_IBL_WGSL',
      path: 'packages/renderer/src/generated/phase-03-pbr-ibl.wgsl.ts',
    },
  ],
  [
    'webgpu/phase-03-pbr-tonemapped.wgsl',
    {
      exportName: 'PHASE_03_PBR_TONEMAPPED_WGSL',
      path: 'packages/renderer/src/generated/phase-03-pbr-tonemapped.wgsl.ts',
    },
  ],
  [
    'webgpu/phase-04-camera-reprojection-reference.wgsl',
    {
      exportName: 'PHASE_04_CAMERA_REPROJECTION_REFERENCE_WGSL',
      path: 'packages/camera/src/generated/phase-04-camera-reprojection-reference.wgsl.ts',
    },
  ],
  [
    'webgpu/phase-04-taa-reference.wgsl',
    {
      exportName: 'PHASE_04_TAA_REFERENCE_WGSL',
      path: 'packages/temporal/src/generated/phase-04-taa-reference.wgsl.ts',
    },
  ],
]);

async function collectShaders(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }

  const result = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await collectShaders(entryPath)));
    else if (entry.isFile() && /\.(?:frag|glsl|vert|wgsl)$/u.test(entry.name))
      result.push(entryPath);
  }
  return result.sort();
}

function assertBalanced(source, relativePath, opening, closing) {
  let depth = 0;
  for (const character of source) {
    if (character === opening) depth += 1;
    if (character === closing) depth -= 1;
    if (depth < 0) throw new Error(`${relativePath}: unexpected "${closing}".`);
  }
  if (depth !== 0) throw new Error(`${relativePath}: unbalanced "${opening}${closing}".`);
}

async function validateGeneratedMirror(relativePath, source) {
  const mirror = generatedMirrors.get(relativePath);
  if (mirror === undefined) {
    throw new Error(`${relativePath}: no generated runtime mirror is registered.`);
  }
  const generatedPath = path.join(root, mirror.path);
  const generated = await readFile(generatedPath, 'utf8');
  if (!/^[A-Z][A-Z0-9_]*$/u.test(mirror.exportName)) {
    throw new Error(`${mirror.path}: generated Shader export name is invalid.`);
  }
  const match = new RegExp(
    'export const ' + mirror.exportName + ' = `([\\s\\S]*)`;\\s*$',
    'u',
  ).exec(generated);
  if (match === null) {
    throw new Error(`${mirror.path}: generated Shader export could not be parsed.`);
  }
  if (match[1] !== source) {
    throw new Error(`${relativePath}: runtime mirror ${mirror.path} is stale.`);
  }
}

async function validateWgsl(shaderPath) {
  const relativePath = path.relative(shaderRoot, shaderPath).split(path.sep).join('/');
  const source = await readFile(shaderPath, 'utf8');
  if (source.trim().length === 0) throw new Error(`${relativePath}: Shader source is empty.`);
  if (!/@vertex\s+fn\s+[A-Za-z_]\w*/u.test(source)) {
    throw new Error(`${relativePath}: no WGSL vertex entry point was found.`);
  }
  if (!/@fragment\s+fn\s+[A-Za-z_]\w*/u.test(source)) {
    throw new Error(`${relativePath}: no WGSL fragment entry point was found.`);
  }
  assertBalanced(source, relativePath, '{', '}');
  assertBalanced(source, relativePath, '(', ')');
  await validateGeneratedMirror(relativePath, source);
  return relativePath;
}

try {
  const shaders = await collectShaders(shaderRoot);
  if (shaders.length === 0) {
    process.stdout.write(
      `${JSON.stringify({ capability: 'not-present-in-phase-00', shaderCount: 0, status: 'NOT_APPLICABLE' }, null, 2)}\n`,
    );
  } else {
    const unsupported = shaders.filter((shaderPath) => path.extname(shaderPath) !== '.wgsl');
    if (unsupported.length > 0) {
      throw new Error(
        `No validator is registered for: ${unsupported.map((item) => path.relative(root, item)).join(', ')}.`,
      );
    }
    const validated = [];
    for (const shaderPath of shaders) validated.push(await validateWgsl(shaderPath));
    process.stdout.write(
      `${JSON.stringify(
        {
          browserCompilerGate:
            'tests/e2e/phase-01.spec.ts plus phase-03-* and phase-04-* specs (BRDF/IBL/TAA/Camera reprojection compute + direct/indirect/tone-mapped PBR render + HDR cube/LUT sampling)',
          shaderCount: validated.length,
          shaders: validated,
          staticValidation: 'entry-points-balanced-syntax-exact-runtime-mirror',
          status: 'PASS',
        },
        null,
        2,
      )}\n`,
    );
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
