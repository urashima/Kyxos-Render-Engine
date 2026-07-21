import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const shaderRoot = path.join(root, 'shaders');

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
  return result;
}

const shaders = await collectShaders(shaderRoot);
if (shaders.length === 0) {
  process.stdout.write(
    `${JSON.stringify({ capability: 'not-present-in-phase-00', shaderCount: 0, status: 'NOT_APPLICABLE' }, null, 2)}\n`,
  );
} else {
  process.stderr.write(
    'Shader sources exist, but a compiler-backed validator has not been configured. Refusing a false PASS.\n',
  );
  process.exitCode = 1;
}
