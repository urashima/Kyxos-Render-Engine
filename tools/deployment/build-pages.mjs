import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { resolveAcceptedPhases } from './accepted-phases.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const playgroundDirectory = path.join(root, 'apps/playground');
const playgroundDist = path.join(playgroundDirectory, 'dist');
const outputDirectory = path.resolve(root, process.env['PAGES_OUTPUT_DIR'] ?? 'pages-dist');

function normalizeBasePath(value) {
  if (value === '' || value === '/') return '';
  const withLeadingSlash = value.startsWith('/') ? value : `/${value}`;
  return withLeadingSlash.replace(/\/+$/, '');
}

function packageManagerExecutable() {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
}

function runPlaygroundBuild(environment) {
  const result = spawnSync(
    packageManagerExecutable(),
    ['--filter', '@kyxos/render-playground', 'build'],
    {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, ...environment },
      stdio: 'inherit',
    },
  );
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Playground build exited with status ${String(result.status)}.`);
  }
}

async function supportedPhases() {
  const entries = await readdir(path.join(playgroundDirectory, 'src/acceptance'), {
    withFileTypes: true,
  });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => /^phase-(\d{2})$/.exec(entry.name))
    .filter((match) => match !== null)
    .map((match) => Number(match[1]))
    .sort((left, right) => left - right);
}

function rootRedirect(latestPath) {
  const escaped = JSON.stringify(latestPath);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="refresh" content="0; url=${latestPath}" />
    <title>Kyxos Render Engine — Playground</title>
    <script>window.location.replace(${escaped});</script>
  </head>
  <body><a href="${latestPath}">Open the latest accepted Playground</a></body>
</html>
`;
}

async function buildTarget({ basePath, commitSha, phase, target }) {
  const targetBase = `${basePath}/${target}/`.replace(/^\/+/, '/');
  runPlaygroundBuild({
    PLAYGROUND_BASE_PATH: targetBase,
    VITE_COMMIT_SHA: commitSha,
    VITE_DEPLOYED_PHASE: String(phase),
    VITE_LATEST_ACCEPTED_PHASE: String(phase),
  });
  await cp(playgroundDist, path.join(outputDirectory, target), {
    recursive: true,
  });
}

async function main() {
  const accepted = await resolveAcceptedPhases(root);
  const includeAllSupported = process.argv.includes('--all-supported');
  const phases = includeAllSupported ? await supportedPhases() : [...accepted.phases];
  const latest = accepted.latest;
  if (latest === undefined || !phases.includes(latest)) {
    throw new Error('The latest accepted phase must be included in the Pages build.');
  }

  const repositoryName = (process.env['GITHUB_REPOSITORY'] ?? 'urashima/Kyxos-Render-Engine')
    .split('/')
    .at(-1);
  if (repositoryName === undefined || repositoryName === '') {
    throw new Error('Unable to determine the GitHub repository name.');
  }
  const basePath = normalizeBasePath(process.env['PAGES_BASE_PATH'] ?? `/${repositoryName}`);
  const commitSha = process.env['PAGES_COMMIT_SHA'] ?? process.env['GITHUB_SHA'] ?? 'local-build';

  await rm(outputDirectory, { force: true, recursive: true });
  await mkdir(outputDirectory, { recursive: true });

  for (const phase of phases) {
    await buildTarget({ basePath, commitSha, phase, target: `phase-${phase}` });
  }
  await buildTarget({ basePath, commitSha, phase: latest, target: 'latest' });

  const latestPath = `${basePath}/latest/`.replace(/^\/+/, '/');
  const manifest = {
    schemaVersion: 1,
    basePath,
    commitSha,
    latestPhase: latest,
    phases: phases.map((phase) => ({ path: `/phase-${phase}/`, phase })),
  };
  await Promise.all([
    writeFile(path.join(outputDirectory, '.nojekyll'), ''),
    writeFile(path.join(outputDirectory, '404.html'), rootRedirect(latestPath)),
    writeFile(path.join(outputDirectory, 'index.html'), rootRedirect('./latest/')),
    writeFile(
      path.join(outputDirectory, 'playground-manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
    ),
  ]);

  const index = await readFile(path.join(outputDirectory, 'latest/index.html'), 'utf8');
  if (!index.includes(`${basePath}/latest/assets/`)) {
    throw new Error('Latest Playground was not built with its isolated Pages base path.');
  }
  process.stdout.write(
    `Built GitHub Pages Playground for phases ${phases.join(', ')}; latest is Phase ${latest}.\n`,
  );
}

await main();
