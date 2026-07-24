import { readFile, writeFile } from 'node:fs/promises';

export async function edit(path, from, to) {
  const source = await readFile(path, 'utf8');
  if (!source.includes(from)) {
    throw new Error(`${path}: expected fragment not found\n--- expected ---\n${from}`);
  }
  await writeFile(path, source.replace(from, to), 'utf8');
}

export async function editAll(path, replacements) {
  let source = await readFile(path, 'utf8');
  for (const [from, to] of replacements) {
    if (!source.includes(from)) {
      throw new Error(`${path}: expected fragment not found\n--- expected ---\n${from}`);
    }
    source = source.replace(from, to);
  }
  await writeFile(path, source, 'utf8');
}

export async function append(path, marker, text) {
  const source = await readFile(path, 'utf8');
  if (source.includes(marker)) return;
  await writeFile(path, `${source.trimEnd()}\n\n${text.trim()}\n`, 'utf8');
}
