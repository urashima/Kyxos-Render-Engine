import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const requiredTextFiles = [
  'docs/acceptance/phase-00/PHASE_00_ACCEPTANCE.md',
  'test-results/phase-00/automated-summary.json',
  'test-results/phase-00/bundle-metrics.json',
  'test-results/phase-00/dependency-graph.json',
  'benchmarks/phase-00/static-to-sleep.json',
  'benchmarks/phase-00/summary.json',
  'visual-baselines/phase-00/metadata.json',
];
const imageDirectory = path.join(root, 'visual-baselines/phase-00');
const failures = [];

async function readJson(relativePath) {
  try {
    return JSON.parse(await readFile(path.join(root, relativePath), 'utf8'));
  } catch (error) {
    failures.push(`${relativePath}: ${String(error)}`);
    return undefined;
  }
}

function imageInfo(buffer) {
  const pngSignature = '89504e470d0a1a0a';
  if (buffer.subarray(0, 8).toString('hex') !== pngSignature || buffer.length < 24) {
    throw new Error('not a valid PNG header');
  }
  return {
    height: buffer.readUInt32BE(20),
    sha256: createHash('sha256').update(buffer).digest('hex'),
    width: buffer.readUInt32BE(16),
  };
}

for (const relativePath of requiredTextFiles) {
  try {
    const details = await stat(path.join(root, relativePath));
    if (details.size === 0) failures.push(`${relativePath}: empty file`);
  } catch {
    failures.push(`${relativePath}: missing required evidence`);
  }
}

const summary = await readJson('test-results/phase-00/automated-summary.json');
if (summary?.phase !== '00' || summary?.localStatus !== 'PASS') {
  failures.push('automated summary: Phase 00 localStatus must be PASS');
}
if (summary?.remoteCiStatus !== 'PENDING_PULL_REQUEST') {
  failures.push('automated summary: remote CI must remain explicitly pending before P0-11');
}
if (!Array.isArray(summary?.requiredFailures) || summary.requiredFailures.length !== 0) {
  failures.push('automated summary: requiredFailures must be empty');
}

const dependencies = await readJson('test-results/phase-00/dependency-graph.json');
if (
  dependencies?.status !== 'PASS' ||
  dependencies?.deliberateFixtureRejected !== true ||
  dependencies?.cycles?.length !== 0 ||
  dependencies?.violations?.length !== 0
) {
  failures.push('dependency evidence: graph or deliberate negative fixture failed');
}

const bundle = await readJson('test-results/phase-00/bundle-metrics.json');
if (
  bundle?.status !== 'PASS' ||
  bundle?.metrics?.total?.rawBytes > bundle?.budgets?.total?.rawBytes ||
  bundle?.metrics?.total?.gzipBytes > bundle?.budgets?.total?.gzipBytes
) {
  failures.push('bundle evidence: measured output exceeds its budget');
}

const benchmark = await readJson('benchmarks/phase-00/summary.json');
const staticMeasurement = await readJson('benchmarks/phase-00/static-to-sleep.json');
const staticToSleep = benchmark?.metrics?.staticToSleep;
if (
  staticToSleep?.status !== 'PASS' ||
  staticToSleep?.sampleCount !== 10 ||
  staticToSleep?.p95Ms >= staticToSleep?.budgetMs
) {
  failures.push('performance evidence: static-to-sleep budget failed');
}
for (const metric of ['budgetMs', 'maxMs', 'medianMs', 'minMs', 'p95Ms', 'sampleCount']) {
  if (staticMeasurement?.[metric] !== staticToSleep?.[metric]) {
    failures.push(`performance evidence: static-to-sleep ${metric} records disagree`);
  }
}
if (
  benchmark?.metrics?.activeResourceCountAfterDispose?.value !== 0 ||
  benchmark?.metrics?.disposeResourceDelta?.activeResources !== 0 ||
  benchmark?.metrics?.disposeResourceDelta?.activeEstimatedBytes !== 0
) {
  failures.push('performance evidence: disposal did not return to the resource baseline');
}

const visual = await readJson('visual-baselines/phase-00/metadata.json');
const imageNames = ['reference', 'current', 'difference'];
const dimensions = new Set();
for (const imageName of imageNames) {
  const expected = visual?.files?.[imageName];
  try {
    const imagePath = path.join(imageDirectory, expected?.path ?? `${imageName}.png`);
    const buffer = await readFile(imagePath);
    const actual = imageInfo(buffer);
    dimensions.add(`${actual.width}x${actual.height}`);
    if (
      actual.sha256 !== expected?.sha256 ||
      actual.width !== expected?.width ||
      actual.height !== expected?.height ||
      buffer.length !== expected?.bytes
    ) {
      failures.push(`visual evidence: ${imageName} metadata does not match the PNG`);
    }
  } catch (error) {
    failures.push(`visual evidence: ${imageName}: ${String(error)}`);
  }
}
if (dimensions.size !== 1) failures.push('visual evidence: image dimensions differ');
if (
  visual?.comparison?.status !== 'PASS' ||
  visual?.comparison?.actualDiffPixels !== 0 ||
  visual?.comparison?.maximumDiffPixels !== 0 ||
  visual?.files?.reference?.sha256 !== visual?.files?.current?.sha256
) {
  failures.push('visual evidence: zero-difference baseline is not proven');
}
const migration = visual?.referenceMigration;
for (const [label, expected] of [
  ['sandbox reference', migration?.oldReference],
  ['environment difference', migration?.environmentDifference],
]) {
  try {
    const buffer = await readFile(path.join(imageDirectory, expected?.path ?? 'missing.png'));
    const actual = imageInfo(buffer);
    if (
      actual.sha256 !== expected?.sha256 ||
      actual.width !== expected?.width ||
      actual.height !== expected?.height ||
      buffer.length !== expected?.bytes
    ) {
      failures.push(`visual evidence: ${label} metadata does not match the PNG`);
    }
  } catch (error) {
    failures.push(`visual evidence: ${label}: ${String(error)}`);
  }
}
if (
  migration?.oldProfile !== 'sandbox-chromium-149' ||
  migration?.newProfile !== 'canonical' ||
  migration?.playwrightDifferentPixels !== 2983 ||
  migration?.absoluteDifferentPixels !== 20028 ||
  migration?.oldReference?.sha256 === visual?.files?.reference?.sha256
) {
  failures.push('visual evidence: canonical reference migration is incomplete');
}
if (
  visual?.canonicalProvenance?.attemptsByteIdentical !== true ||
  visual?.canonicalProvenance?.attemptHashes?.length !== 2 ||
  visual.canonicalProvenance.attemptHashes.some((hash) => hash !== visual?.files?.reference?.sha256)
) {
  failures.push('visual evidence: canonical CI attempts are not byte-identical');
}

const acceptancePath = path.join(root, 'docs/acceptance/phase-00/PHASE_00_ACCEPTANCE.md');
try {
  const acceptance = await readFile(acceptancePath, 'utf8');
  for (const heading of [
    '## Automated results',
    '## Dependency evidence',
    '## Visual evidence',
    '## Performance and resource evidence',
    '## Owner checklist status',
    '## Known limitations',
  ]) {
    if (!acceptance.includes(heading)) failures.push(`acceptance document: missing ${heading}`);
  }
  if (!acceptance.includes('Remote GitHub Actions is pending')) {
    failures.push('acceptance document: remote CI limitation is not declared');
  }
} catch (error) {
  failures.push(`acceptance document: ${String(error)}`);
}

if (failures.length > 0) {
  process.stderr.write(`${JSON.stringify({ failures, status: 'FAIL' }, null, 2)}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `${JSON.stringify({ evidenceFiles: requiredTextFiles.length + imageNames.length + 2, phase: '00', status: 'PASS' }, null, 2)}\n`,
  );
}
