import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const failures = [];

const requiredDocuments = [
  'README.md',
  'DEVELOPMENT_PLAN.md',
  'PHASE_ACCEPTANCE_PLAN.md',
  'WORK_STATUS.md',
  'CONTRIBUTING.md',
  'docs/execution/WORK_LOG.md',
  'docs/execution/DECISIONS.md',
];

const allowedExecutionDocuments = new Set(['WORK_LOG.md', 'DECISIONS.md']);
const allowedTaskStatuses = new Set(['Planned', 'In Development', 'Blocked', 'Completed']);

async function exists(relativePath) {
  try {
    await access(path.join(root, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function read(relativePath) {
  try {
    return await readFile(path.join(root, relativePath), 'utf8');
  } catch {
    failures.push(`${relativePath}: missing required document`);
    return '';
  }
}

async function markdownFiles(relativeDirectory) {
  const directory = path.join(root, relativeDirectory);
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) result.push(...(await markdownFiles(relativePath)));
    else if (entry.isFile() && entry.name.endsWith('.md')) result.push(relativePath);
  }
  return result.sort();
}

function parseTaskLedger(relativePath, source, expectedPhase) {
  const tasks = [];
  for (const line of source.split('\n')) {
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length < 2) continue;
    const idMatch = /^P(\d+)-(\d{2})$/u.exec(cells[0] ?? '');
    if (idMatch === null) continue;
    const status = cells.at(-1) ?? '';
    if (!allowedTaskStatuses.has(status)) {
      failures.push(
        `${relativePath}: ${cells[0]} has unsupported status ${JSON.stringify(status)}`,
      );
      continue;
    }
    const phase = Number(idMatch[1]);
    const sequence = Number(idMatch[2]);
    if (phase !== expectedPhase) {
      failures.push(`${relativePath}: ${cells[0]} does not match Phase ${expectedPhase}`);
    }
    tasks.push({ id: cells[0], sequence, status });
  }

  if (tasks.length === 0) failures.push(`${relativePath}: no task rows found`);
  const identifiers = new Set();
  for (const task of tasks) {
    if (identifiers.has(task.id)) failures.push(`${relativePath}: duplicate task ${task.id}`);
    identifiers.add(task.id);
  }
  const sequences = tasks.map((task) => task.sequence).sort((a, b) => a - b);
  for (let index = 0; index < sequences.length; index += 1) {
    if (sequences[index] !== index + 1) {
      failures.push(`${relativePath}: task numbers must be contiguous from 01`);
      break;
    }
  }
  return tasks;
}

async function validateRelativeLinks(relativePath, source) {
  const pattern = /\[[^\]]+\]\(([^)]+)\)/gu;
  for (const [, rawTarget] of source.matchAll(pattern)) {
    if (/^(?:https?:|mailto:|#)/u.test(rawTarget)) continue;
    const target = rawTarget.split(/[?#]/u)[0];
    if (target.length === 0) continue;
    const resolved = path.resolve(path.dirname(path.join(root, relativePath)), target);
    try {
      await access(resolved);
    } catch {
      failures.push(`${relativePath}: broken link ${rawTarget}`);
    }
  }
}

for (const relativePath of requiredDocuments) await read(relativePath);

const readme = await read('README.md');
const contributing = await read('CONTRIBUTING.md');
const workStatus = await read('WORK_STATUS.md');
const workLog = await read('docs/execution/WORK_LOG.md');

const currentPhaseMatch = /\*\*Current Phase:\*\*\s*Phase\s+(\d+)/u.exec(workStatus);
const currentTaskMatch = /\*\*Current Task:\*\*\s*(P\d+-\d{2})/u.exec(workStatus);
const lastCompletedMatch = /\*\*Last Completed Task:\*\*\s*(P\d+-\d{2})/u.exec(workStatus);

if (currentPhaseMatch === null)
  failures.push('WORK_STATUS.md: Current Phase is missing or malformed');
if (currentTaskMatch === null)
  failures.push('WORK_STATUS.md: Current Task is missing or malformed');
if (lastCompletedMatch === null)
  failures.push('WORK_STATUS.md: Last Completed Task is missing or malformed');

const currentPhase = Number(currentPhaseMatch?.[1] ?? -1);
const ledgers = new Map();
for (let phase = 0; phase <= currentPhase; phase += 1) {
  const padded = String(phase).padStart(2, '0');
  const relativePath = `docs/execution/PHASE_${padded}_TASKS.md`;
  const source = await read(relativePath);
  ledgers.set(phase, { relativePath, source, tasks: parseTaskLedger(relativePath, source, phase) });
}

const acceptedPhases = new Set(
  [...workStatus.matchAll(/^\|\s*(\d{2})\s*\|\s*Phase Accepted\s*\|/gmu)].map((match) =>
    Number(match[1]),
  ),
);
for (const phase of acceptedPhases) {
  const ledger = ledgers.get(phase);
  if (ledger === undefined) {
    failures.push(`WORK_STATUS.md: accepted Phase ${phase} has no task ledger`);
    continue;
  }
  for (const task of ledger.tasks) {
    if (task.status !== 'Completed') {
      failures.push(`${ledger.relativePath}: accepted ${task.id} must be Completed`);
    }
  }
}

const currentLedger = ledgers.get(currentPhase);
if (currentLedger !== undefined && currentTaskMatch !== null) {
  const currentTask = currentLedger.tasks.find((task) => task.id === currentTaskMatch[1]);
  if (currentTask === undefined) {
    failures.push(
      `WORK_STATUS.md: Current Task ${currentTaskMatch[1]} is absent from ${currentLedger.relativePath}`,
    );
  } else if (!['In Development', 'Blocked'].includes(currentTask.status)) {
    failures.push(
      `${currentLedger.relativePath}: Current Task ${currentTask.id} must be In Development or Blocked`,
    );
  }
}
if (currentLedger !== undefined && lastCompletedMatch !== null) {
  const lastCompleted = currentLedger.tasks.find((task) => task.id === lastCompletedMatch[1]);
  if (lastCompleted === undefined) {
    failures.push(
      `WORK_STATUS.md: Last Completed Task ${lastCompletedMatch[1]} is absent from ${currentLedger.relativePath}`,
    );
  } else if (lastCompleted.status !== 'Completed') {
    failures.push(
      `${currentLedger.relativePath}: Last Completed Task ${lastCompleted.id} must be Completed`,
    );
  }
  if (!workLog.includes(lastCompletedMatch[1])) {
    failures.push(`docs/execution/WORK_LOG.md: missing ${lastCompletedMatch[1]} checkpoint`);
  }
}

const executionMarkdown = await markdownFiles('docs/execution');
for (const relativePath of executionMarkdown) {
  const filename = path.basename(relativePath);
  if (allowedExecutionDocuments.has(filename)) continue;
  if (/^PHASE_\d{2}_TASKS\.md$/u.test(filename)) continue;
  failures.push(`${relativePath}: execution documentation is not an allowed canonical file`);
}

const researchMarkdown = await markdownFiles('docs/research');
const researchCounts = new Map();
for (const relativePath of researchMarkdown) {
  const match = /^docs\/research\/phase-(\d{2})-[a-z0-9-]+\.md$/u.exec(relativePath);
  if (match === null) continue;
  const phase = Number(match[1]);
  researchCounts.set(phase, (researchCounts.get(phase) ?? 0) + 1);
}
for (const [phase, count] of researchCounts) {
  if (phase >= 4 && count > 1) {
    failures.push(
      `docs/research: Phase ${phase} has ${count} research documents; consolidate to one`,
    );
  }
}

const requiredReadmeLinks = [
  'DEVELOPMENT_PLAN.md',
  'PHASE_ACCEPTANCE_PLAN.md',
  'WORK_STATUS.md',
  'CONTRIBUTING.md',
  'docs/execution/WORK_LOG.md',
];
for (let phase = 0; phase <= currentPhase; phase += 1) {
  requiredReadmeLinks.push(`docs/execution/PHASE_${String(phase).padStart(2, '0')}_TASKS.md`);
}
for (const link of requiredReadmeLinks) {
  if (!readme.includes(link)) failures.push(`README.md: missing canonical index link to ${link}`);
}

for (const marker of [
  '## Documentation governance',
  '### Single source of truth',
  '### Minimal document set',
  '### Update rules',
]) {
  if (!contributing.includes(marker)) failures.push(`CONTRIBUTING.md: missing ${marker}`);
}

const linkSources = [
  ['README.md', readme],
  ['CONTRIBUTING.md', contributing],
  ...[...ledgers.values()].map((ledger) => [ledger.relativePath, ledger.source]),
];
for (const [relativePath, source] of linkSources) await validateRelativeLinks(relativePath, source);

if (await exists('docs/execution/BLOCKERS.md')) {
  failures.push(
    'docs/execution/BLOCKERS.md: blockers must live in WORK_STATUS.md and WORK_LOG.md only',
  );
}

if (failures.length > 0) {
  process.stderr.write(`${JSON.stringify({ failures, status: 'FAIL' }, null, 2)}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `${JSON.stringify({ currentPhase, executionDocumentCount: executionMarkdown.length, status: 'PASS', taskLedgerCount: ledgers.size }, null, 2)}\n`,
  );
}
