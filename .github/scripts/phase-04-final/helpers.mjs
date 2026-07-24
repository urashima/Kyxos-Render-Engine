import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();

export async function read(relativePath) {
  return readFile(path.join(root, relativePath), 'utf8');
}

export async function write(relativePath, content) {
  await writeFile(path.join(root, relativePath), content, 'utf8');
}

export async function replaceExact(relativePath, from, to) {
  const source = await read(relativePath);
  if (!source.includes(from)) {
    throw new Error(`${relativePath}: expected source fragment was not found.\n--- expected ---\n${from}`);
  }
  await write(relativePath, source.replace(from, to));
}

export async function replaceRegex(relativePath, pattern, replacement) {
  const source = await read(relativePath);
  pattern.lastIndex = 0;
  if (!pattern.test(source)) {
    throw new Error(`${relativePath}: expected source pattern ${String(pattern)} was not found.`);
  }
  pattern.lastIndex = 0;
  await write(relativePath, source.replace(pattern, replacement));
}

export async function appendOnce(relativePath, marker, content) {
  const source = await read(relativePath);
  if (source.includes(marker)) return;
  await write(relativePath, `${source.trimEnd()}\n\n${content.trim()}\n`);
}

export async function writeGeneratedMirror(shaderPath, generatedPath, exportName) {
  const shader = await read(shaderPath);
  await write(generatedPath, `export const ${exportName} = \`${shader}\`;\n`);
}
