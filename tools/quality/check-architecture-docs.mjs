import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const architectureFiles = [
  'docs/architecture/overview.md',
  'docs/architecture/dependency-rules.md',
];
const adrFiles = [
  'docs/adr/ADR-001-webgpu-first-webgl2-fallback.md',
  'docs/adr/ADR-002-coordinate-and-color-conventions.md',
  'docs/adr/ADR-003-render-graph.md',
  'docs/adr/ADR-004-public-sdk-boundary.md',
  'docs/adr/ADR-005-temporal-accumulation-and-sleep.md',
  'docs/adr/ADR-006-independent-deferred-traa-pipeline.md',
];
const requiredAdrSections = [
  '## Context',
  '## Decision',
  '## Consequences',
  '## Alternatives rejected',
];
const markdownLinkPattern = /\[[^\]]+\]\(([^)]+)\)/gu;
const failures = [];

async function validateLinks(filePath, source) {
  for (const [, target] of source.matchAll(markdownLinkPattern)) {
    if (/^(?:https?:|#)/u.test(target)) continue;
    const relativeTarget = target.split('#')[0];
    if (relativeTarget.length === 0) continue;
    const resolved = path.resolve(path.dirname(filePath), relativeTarget);
    try {
      await access(resolved);
    } catch {
      failures.push(`${path.relative(root, filePath)}: broken link ${target}`);
    }
  }
}

for (const relativePath of [...architectureFiles, ...adrFiles]) {
  const filePath = path.join(root, relativePath);
  let source;
  try {
    source = await readFile(filePath, 'utf8');
  } catch {
    failures.push(`${relativePath}: missing required document`);
    continue;
  }

  if (source.trim().length < 500) failures.push(`${relativePath}: document is incomplete`);
  await validateLinks(filePath, source);

  if (adrFiles.includes(relativePath)) {
    if (!source.includes('- **Status:** Accepted')) {
      failures.push(`${relativePath}: ADR status is not Accepted`);
    }
    for (const section of requiredAdrSections) {
      if (!source.includes(section)) failures.push(`${relativePath}: missing ${section}`);
    }
  }
}

if (failures.length > 0) {
  process.stderr.write(`${JSON.stringify({ failures, status: 'FAIL' }, null, 2)}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `${JSON.stringify({ adrCount: adrFiles.length, architectureDocumentCount: architectureFiles.length, status: 'PASS' }, null, 2)}\n`,
  );
}
