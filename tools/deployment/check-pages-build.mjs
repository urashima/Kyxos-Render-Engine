import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outputDirectory = path.resolve(root, process.env['PAGES_OUTPUT_DIR'] ?? 'pages-dist');

async function assertExists(filePath) {
  try {
    await access(filePath);
  } catch {
    throw new Error(`GitHub Pages artifact is missing ${path.relative(root, filePath)}.`);
  }
}

function assetReferences(html) {
  return [...html.matchAll(/(?:href|src)="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((reference) => reference !== undefined && reference.includes('/assets/'));
}

async function assertTarget(manifest, target) {
  const targetDirectory = path.join(outputDirectory, target);
  const indexPath = path.join(targetDirectory, 'index.html');
  await assertExists(indexPath);
  const index = await readFile(indexPath, 'utf8');
  if (index.includes('/src/main.ts')) {
    throw new Error(`${target}/index.html still references Vite development source.`);
  }

  const expectedPrefix = `${manifest.basePath}/${target}/`.replace(/^\/+/, '/');
  const references = assetReferences(index);
  if (references.length === 0) throw new Error(`${target}/index.html has no built assets.`);
  for (const reference of references) {
    if (!reference.startsWith(expectedPrefix)) {
      throw new Error(`${target}/index.html escaped its isolated base path: ${reference}`);
    }
    const relativeAsset = reference.slice(expectedPrefix.length);
    await assertExists(path.join(targetDirectory, relativeAsset));
  }
}

async function main() {
  await assertExists(path.join(outputDirectory, '.nojekyll'));
  await assertExists(path.join(outputDirectory, '404.html'));
  const manifest = JSON.parse(
    await readFile(path.join(outputDirectory, 'playground-manifest.json'), 'utf8'),
  );
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.phases)) {
    throw new Error('GitHub Pages manifest has an unsupported schema.');
  }
  const phases = manifest.phases.map((entry) => entry.phase);
  if (!phases.includes(manifest.latestPhase)) {
    throw new Error('Latest accepted phase is absent from the historical Pages routes.');
  }
  for (let index = 0; index < phases.length; index += 1) {
    if (phases[index] !== index) {
      throw new Error(`Pages history must stay contiguous from Phase 0: ${phases.join(',')}`);
    }
  }

  await Promise.all([
    ...phases.map((phase) => assertTarget(manifest, `phase-${String(phase)}`)),
    assertTarget(manifest, 'latest'),
  ]);
  const rootIndex = await readFile(path.join(outputDirectory, 'index.html'), 'utf8');
  if (!rootIndex.includes('./latest/')) {
    throw new Error('Pages root does not redirect to the latest accepted Playground.');
  }
  process.stdout.write(
    `GitHub Pages artifact PASS: phases ${phases.join(', ')}; latest Phase ${String(manifest.latestPhase)}.\n`,
  );
}

await main();
