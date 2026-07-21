import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const requiredTextFiles = [
  'docs/acceptance/phase-01/PHASE_01_ACCEPTANCE.md',
  'docs/acceptance/phase-01/OWNER_ACCEPTANCE.md',
  'docs/acceptance/phase-01/TECHNICAL_QA.md',
  'test-results/phase-01/automated-summary.json',
  'test-results/phase-01/bundle-metrics.json',
  'test-results/phase-01/dependency-graph.json',
  'test-results/phase-01/lifecycle-metrics.json',
  'test-results/phase-01/owner-acceptance.json',
  'test-results/phase-01/render-metrics.json',
  'test-results/phase-01/technical-qa.json',
  'benchmarks/phase-01/static-to-sleep.json',
  'benchmarks/phase-01/summary.json',
  'visual-baselines/phase-01/metadata.json',
];
const imageDirectory = path.join(root, 'visual-baselines/phase-01');
const sourceCommit = '02373b17c1ed4b334b6b6279208364f38ecc54e7';
const sourceCiRun = 29840589848;
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
  if (buffer.length < 24 || buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new Error('not a valid PNG header');
  }
  return {
    bytes: buffer.length,
    height: buffer.readUInt32BE(20),
    sha256: createHash('sha256').update(buffer).digest('hex'),
    width: buffer.readUInt32BE(16),
  };
}

async function verifyImage(label, expected) {
  try {
    const buffer = await readFile(path.join(imageDirectory, expected?.path ?? 'missing.png'));
    const actual = imageInfo(buffer);
    if (
      actual.bytes !== expected?.bytes ||
      actual.height !== expected?.height ||
      actual.sha256 !== expected?.sha256 ||
      actual.width !== expected?.width
    ) {
      failures.push(`visual evidence: ${label} metadata does not match the PNG`);
    }
    return actual;
  } catch (error) {
    failures.push(`visual evidence: ${label}: ${String(error)}`);
    return undefined;
  }
}

for (const relativePath of requiredTextFiles) {
  try {
    const details = await stat(path.join(root, relativePath));
    if (details.size === 0) failures.push(`${relativePath}: empty file`);
  } catch {
    failures.push(`${relativePath}: missing required evidence`);
  }
}

const automated = await readJson('test-results/phase-01/automated-summary.json');
if (
  automated?.phase !== '01' ||
  automated?.localStatus !== 'PASS' ||
  automated?.remoteCiStatus !== 'PASS' ||
  automated?.sourceCheckpoint !== sourceCommit ||
  automated?.remoteCi?.runId !== sourceCiRun ||
  automated?.remoteCi?.sourceCommit !== sourceCommit ||
  automated?.remoteCi?.conclusion !== 'success' ||
  automated?.remoteCi?.artifactId !== 8499252492 ||
  !Array.isArray(automated?.requiredFailures) ||
  automated.requiredFailures.length !== 0
) {
  failures.push('automated summary: source CI, phase, or required-failure state is invalid');
}

const dependencies = await readJson('test-results/phase-01/dependency-graph.json');
if (
  dependencies?.status !== 'PASS' ||
  dependencies?.deliberateFixtureRejected !== true ||
  dependencies?.cycles?.length !== 0 ||
  dependencies?.violations?.length !== 0 ||
  !dependencies?.edges?.['@kyxos/render-sdk']?.includes('@kyxos/render-backend-webgpu') ||
  dependencies?.edges?.['@kyxos/render-renderer']?.includes('@kyxos/render-backend-webgpu')
) {
  failures.push('dependency evidence: graph, concrete SDK edge, or negative fixture is invalid');
}

const technicalQa = await readJson('test-results/phase-01/technical-qa.json');
if (
  technicalQa?.status !== 'PASS' ||
  technicalQa?.acceptanceState !== 'Technical QA Passed' ||
  technicalQa?.sourceCommit !== sourceCommit ||
  technicalQa?.ci?.runId !== sourceCiRun ||
  technicalQa?.ci?.conclusion !== 'success' ||
  Object.values(technicalQa?.checks ?? {}).some((status) => status !== 'PASS') ||
  technicalQa?.blockers?.length !== 0
) {
  failures.push('technical QA evidence: source, checks, CI, or blocker state is invalid');
}

const owner = await readJson('test-results/phase-01/owner-acceptance.json');
if (
  owner?.status !== 'PASS' ||
  owner?.acceptanceState !== 'Owner Acceptance Passed' ||
  owner?.reviewedCheckpoint !== sourceCommit ||
  owner?.ci?.runId !== sourceCiRun ||
  owner?.ci?.conclusion !== 'success' ||
  owner?.subjectiveReview?.status !== 'PASS' ||
  Object.values(owner?.phaseOperations ?? {}).some((status) => status !== 'PASS') ||
  Object.values(owner?.generalChecklist ?? {}).some((status) => status !== 'PASS') ||
  owner?.blockers?.length !== 0
) {
  failures.push('owner acceptance evidence: checklist, visual review, CI, or blockers are invalid');
}

const bundle = await readJson('test-results/phase-01/bundle-metrics.json');
if (bundle?.status !== 'PASS') failures.push('bundle evidence: status must be PASS');
for (const [category, measurements] of Object.entries(bundle?.metrics ?? {})) {
  const budget = bundle?.budgets?.[category];
  if (
    budget === undefined ||
    measurements.rawBytes > budget.rawBytes ||
    measurements.gzipBytes > budget.gzipBytes
  ) {
    failures.push(`bundle evidence: ${category} exceeds or lacks its budget`);
  }
}

const render = await readJson('test-results/phase-01/render-metrics.json');
const cpu = render?.performance?.cpuFrameTimeMs;
const dirtyToSleep = render?.performance?.cpuDirtyToSleepMs;
if (
  render?.environment?.backend !== 'webgpu' ||
  render?.shaderCompilation !== 'pass' ||
  render?.geometry?.triangle?.drawCalls !== 1 ||
  render?.geometry?.triangle?.triangles !== 1 ||
  render?.geometry?.sphere?.drawCalls !== 1 ||
  render?.geometry?.sphere?.triangles !== 1024 ||
  render?.geometry?.sphere?.submittedVertices !== 3072 ||
  render?.resources?.activeCount !== 6 ||
  render?.resources?.activeEstimatedBufferBytes !== 26448 ||
  render?.resources?.pipelineCount !== 1 ||
  cpu?.sampleCount !== 10 ||
  cpu?.p95Ms >= cpu?.budgetMs ||
  dirtyToSleep?.sampleCount !== 10 ||
  dirtyToSleep?.p95Ms >= dirtyToSleep?.budgetMs ||
  render?.performance?.gpuFrameTimeMs?.capabilityAvailable !== true ||
  render?.performance?.gpuFrameTimeMs?.status !== 'NOT_AVAILABLE'
) {
  failures.push('render evidence: geometry, resources, timing, or declared GPU state is invalid');
}

const lifecycle = await readJson('test-results/phase-01/lifecycle-metrics.json');
if (
  lifecycle?.status !== 'PASS' ||
  lifecycle?.devicePixelRatio !== 2 ||
  lifecycle?.resourceBaseline !== 6 ||
  lifecycle?.resourcesAfterDeviceLoss !== 0 ||
  lifecycle?.resourcesAfterDispose !== 0 ||
  lifecycle?.resourcesAfterFinalDispose !== 0 ||
  lifecycle?.resourcesAfterRecreate !== 6
) {
  failures.push('lifecycle evidence: DPR, loss, disposal, or recreation baseline is invalid');
}

const benchmark = await readJson('benchmarks/phase-01/summary.json');
const staticMeasurement = await readJson('benchmarks/phase-01/static-to-sleep.json');
const benchmarkStatic = benchmark?.metrics?.staticToSleep;
const benchmarkCpu = benchmark?.metrics?.cpuFrameTimeMs;
if (
  benchmark?.status !== 'PASS_WITH_DECLARED_UNAVAILABLE_GPU_TIMING' ||
  benchmark?.previousAcceptedTagComparison?.tag !== 'phase-00-accepted' ||
  benchmark?.previousAcceptedTagComparison?.staticToSleepP95?.status !== 'PASS' ||
  benchmarkStatic?.status !== 'PASS' ||
  benchmarkStatic?.sampleCount !== 10 ||
  benchmarkStatic?.p95Ms >= benchmarkStatic?.budgetMs ||
  benchmarkCpu?.status !== 'PASS' ||
  benchmarkCpu?.sampleCount !== 10 ||
  benchmarkCpu?.p95Ms >= benchmarkCpu?.budgetMs ||
  benchmark?.metrics?.activeResourceCountAfterDeviceLoss?.value !== 0 ||
  benchmark?.metrics?.activeResourceCountAfterDispose?.value !== 0 ||
  benchmark?.metrics?.disposeResourceDelta?.activeResources !== 0
) {
  failures.push('benchmark evidence: comparison, timing, or resource budgets failed');
}
for (const metric of ['budgetMs', 'maxMs', 'medianMs', 'minMs', 'p95Ms', 'sampleCount']) {
  if (staticMeasurement?.[metric] !== benchmarkStatic?.[metric]) {
    failures.push(`benchmark evidence: static-to-sleep ${metric} records disagree`);
  }
  if (staticMeasurement?.cpuFrameTimeMs?.[metric] !== benchmarkCpu?.[metric]) {
    failures.push(`benchmark evidence: CPU frame ${metric} records disagree`);
  }
}

const visual = await readJson('visual-baselines/phase-01/metadata.json');
const reference = await verifyImage('reference', visual?.files?.reference);
const current = await verifyImage('current', visual?.files?.current);
await verifyImage('difference', visual?.files?.difference);
await verifyImage('triangle', visual?.files?.triangle);
await verifyImage('sphere', visual?.files?.sphere);
await verifyImage('rejected aspect capture', visual?.rejectedEvidence?.image);
await verifyImage('aspect-fix Difference', visual?.rejectedEvidence?.difference);
if (
  visual?.comparison?.status !== 'PASS' ||
  visual?.comparison?.actualDiffPixels !== 0 ||
  visual?.comparison?.maximumDiffPixels !== 0 ||
  reference?.sha256 !== current?.sha256 ||
  visual?.canonicalProvenance?.attemptsByteIdentical !== true ||
  visual?.canonicalProvenance?.attemptHashes?.length !== 3 ||
  visual.canonicalProvenance.attemptHashes.some((hash) => hash !== reference?.sha256) ||
  visual?.rejectedEvidence?.absoluteDifferentPixelsAfterFix !== 208525 ||
  visual?.rejectedEvidence?.image?.sha256 === reference?.sha256
) {
  failures.push('visual evidence: zero-diff baseline, repeatability, or rejected fix is invalid');
}

try {
  const acceptance = await readFile(
    path.join(root, 'docs/acceptance/phase-01/PHASE_01_ACCEPTANCE.md'),
    'utf8',
  );
  for (const heading of [
    '## Automated results',
    '## Architecture evidence',
    '## Visual evidence',
    '## Performance and resource evidence',
    '## Owner checklist status',
    '## Known limitations',
    '## Acceptance conclusion',
  ]) {
    if (!acceptance.includes(heading)) failures.push(`acceptance document: missing ${heading}`);
  }
  if (!acceptance.includes('Owner Acceptance Passed — Autonomous Evidence Review')) {
    failures.push('acceptance document: autonomous owner evidence review is not declared');
  }
  if (!acceptance.includes(`GitHub Actions Run \`${sourceCiRun}\``)) {
    failures.push('acceptance document: inspected successful CI is not declared');
  }
} catch (error) {
  failures.push(`acceptance document: ${String(error)}`);
}

if (failures.length > 0) {
  process.stderr.write(`${JSON.stringify({ failures, status: 'FAIL' }, null, 2)}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `${JSON.stringify({ evidenceFiles: requiredTextFiles.length + 7, phase: '01', status: 'PASS' }, null, 2)}\n`,
  );
}
