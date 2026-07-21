import { appendFile, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function parsePhaseDirectory(name) {
  const match = /^phase-(\d{2})$/.exec(name);
  return match === null ? undefined : Number(match[1]);
}

function assertContiguous(phases) {
  if (phases.length === 0 || phases[0] !== 0) {
    throw new Error('At least accepted Phase 0 is required for a Pages deployment.');
  }
  for (let index = 1; index < phases.length; index += 1) {
    if (phases[index] !== phases[index - 1] + 1) {
      throw new Error(`Accepted phases must be contiguous from Phase 0: ${phases.join(',')}`);
    }
  }
}

export async function resolveAcceptedPhases(repositoryRoot = root) {
  const resultsDirectory = path.join(repositoryRoot, 'test-results');
  const directories = await readdir(resultsDirectory, { withFileTypes: true });
  const candidates = directories
    .filter((entry) => entry.isDirectory())
    .map((entry) => parsePhaseDirectory(entry.name))
    .filter((phase) => phase !== undefined)
    .sort((left, right) => left - right);

  const accepted = [];
  for (const phase of candidates) {
    const padded = String(phase).padStart(2, '0');
    const ownerAcceptancePath = path.join(
      resultsDirectory,
      `phase-${padded}`,
      'owner-acceptance.json',
    );
    let record;
    try {
      record = JSON.parse(await readFile(ownerAcceptancePath, 'utf8'));
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue;
      throw error;
    }
    if (record.phase === padded && record.status === 'PASS') accepted.push(phase);
  }

  assertContiguous(accepted);
  return Object.freeze({
    latest: accepted.at(-1),
    phases: Object.freeze(accepted),
  });
}

async function runCli() {
  const accepted = await resolveAcceptedPhases();
  const output = {
    latest: String(accepted.latest),
    phases: accepted.phases.join(','),
  };

  if (process.argv.includes('--github-output')) {
    const githubOutput = process.env['GITHUB_OUTPUT'];
    if (githubOutput === undefined) {
      throw new Error('GITHUB_OUTPUT is required with --github-output.');
    }
    await appendFile(githubOutput, `phases=${output.phases}\nlatest=${output.latest}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(output)}\n`);
  }
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await runCli();
}
