import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveAcceptedPhases } from '../deployment/accepted-phases.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sourceCommit = '7e4abe7a625769cc830ee8db8d419fea8243c3ad';
const sourceCiRun = 29917288982;
const sourceCiJob = 88914018637;
const sourceArtifact = 8528484011;
const sourceArtifactDigest =
  'sha256:3de59e97312bf7f9432e04c0ac81f9a0a18f5ee12b33fcc8156b21cb1b22a250';
const evidencePackCommit = 'bc3faa5ffac5d04837ba04f2382cc43bc5819d38';
const evidencePackCiRun = 29918823067;
const evidencePackCiJob = 88918945110;
const evidencePackArtifact = 8529093758;
const evidencePackArtifactDigest =
  'sha256:bd676c29b736395d8eba8a6c471ef720d57b5cb8d6f4f483975244ef0e9be3a6';
const visualSourceCommit = '4f0e812cf0382777d407edf27f5eae0e8b095e8e';
const visualSourceRun = 29916911020;
const visualSourceArtifact = 8528332559;
const fullPageHash = '71c6dac046d44b8bc979a4063ad348ced19692e82c2599c250d4513b44e33151';
const galleryHash = '91885ac007899f5845193847b4637a836f56f8633e79cca8f8bef76e77a19967';
const requiredTextFiles = [
  '.github/workflows/ci.yml',
  '.github/workflows/deploy-pages.yml',
  '.github/workflows/freeze-deployed-phase.yml',
  'benchmarks/phase-03/static-to-sleep.json',
  'benchmarks/phase-03/summary.json',
  'docs/acceptance/phase-03/OWNER_ACCEPTANCE.md',
  'docs/acceptance/phase-03/PHASE_03_ACCEPTANCE.md',
  'docs/acceptance/phase-03/TECHNICAL_QA.md',
  'package.json',
  'PHASE_ACCEPTANCE_PLAN.md',
  'test-results/phase-03/automated-summary.json',
  'test-results/phase-03/bundle-metrics.json',
  'test-results/phase-03/dependency-graph.json',
  'test-results/phase-03/lifecycle-metrics.json',
  'test-results/phase-03/owner-acceptance.json',
  'test-results/phase-03/render-metrics.json',
  'test-results/phase-03/technical-qa.json',
  'tests/e2e/online-pages.spec.ts',
  'visual-baselines/phase-03/metadata.json',
  'WORK_STATUS.md',
  'docs/execution/WORK_LOG.md',
];
const imageDirectory = path.join(root, 'visual-baselines/phase-03');
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

const automated = await readJson('test-results/phase-03/automated-summary.json');
if (
  automated?.phase !== '03' ||
  automated?.localStatus !== 'PASS' ||
  automated?.remoteCiStatus !== 'PASS' ||
  automated?.sourceCheckpoint !== sourceCommit ||
  automated?.remoteCi?.runId !== sourceCiRun ||
  automated?.remoteCi?.jobId !== sourceCiJob ||
  automated?.remoteCi?.sourceCommit !== sourceCommit ||
  automated?.remoteCi?.conclusion !== 'success' ||
  automated?.remoteCi?.artifactId !== sourceArtifact ||
  automated?.remoteCi?.artifactDigest !== sourceArtifactDigest ||
  automated?.evidencePackCi?.runId !== evidencePackCiRun ||
  automated?.evidencePackCi?.jobId !== evidencePackCiJob ||
  automated?.evidencePackCi?.sourceCommit !== evidencePackCommit ||
  automated?.evidencePackCi?.conclusion !== 'success' ||
  automated?.evidencePackCi?.artifactId !== evidencePackArtifact ||
  automated?.evidencePackCi?.artifactDigest !== evidencePackArtifactDigest ||
  automated?.visualSource?.runId !== visualSourceRun ||
  automated?.visualSource?.sourceCommit !== visualSourceCommit ||
  automated?.visualSource?.artifactId !== visualSourceArtifact ||
  automated?.deploymentGate?.status !== 'PENDING' ||
  !automated?.deploymentGate?.requiredRoutes?.includes('/phase-3/') ||
  !automated?.deploymentGate?.requiredRoutes?.includes('/latest/') ||
  !Array.isArray(automated?.requiredFailures) ||
  automated.requiredFailures.length !== 0 ||
  automated?.gates?.length !== 13 ||
  automated.gates.some((gate) => gate.status !== 'PASS')
) {
  failures.push('automated summary: source/evidence CI, gates, or deployment state is invalid');
}

const dependencies = await readJson('test-results/phase-03/dependency-graph.json');
if (
  dependencies?.status !== 'PASS' ||
  dependencies?.deliberateFixtureRejected !== true ||
  dependencies?.cycles?.length !== 0 ||
  dependencies?.violations?.length !== 0 ||
  JSON.stringify(dependencies?.edges?.['@kyxos/render-material-core']) !==
    JSON.stringify(['@kyxos/render-core']) ||
  JSON.stringify(dependencies?.edges?.['@kyxos/render-material-pbr']) !==
    JSON.stringify(['@kyxos/render-core', '@kyxos/render-material-core']) ||
  JSON.stringify(dependencies?.edges?.['@kyxos/render-environment']) !==
    JSON.stringify(['@kyxos/render-core']) ||
  dependencies?.edges?.['@kyxos/render-renderer']?.includes('@kyxos/render-backend-webgpu') ||
  !dependencies?.edges?.['@kyxos/render-sdk']?.includes('@kyxos/render-backend-webgpu')
) {
  failures.push('dependency evidence: graph, Phase 3 boundaries, or negative fixture is invalid');
}

const bundle = await readJson('test-results/phase-03/bundle-metrics.json');
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
if (
  bundle?.budgets?.phase2RouteJavascript?.rawBytes !== 131072 ||
  bundle?.metrics?.phase2RouteJavascript?.rawBytes !== 130474 ||
  bundle?.metrics?.phase3RouteJavascript?.rawBytes !== 180095 ||
  bundle?.metrics?.phase3RouteJavascript?.gzipBytes !== 53209
) {
  failures.push('bundle evidence: frozen Phase 2 or independent Phase 3 route measurement changed');
}

const render = await readJson('test-results/phase-03/render-metrics.json');
const cpu = render?.performance?.cpuFrameTimeMs;
const dirtyToSleep = render?.performance?.dirtyToSleepMs;
if (
  render?.status !== 'PASS' ||
  render?.route !== '/acceptance/phase-03' ||
  render?.environment?.backend !== 'webgpu' ||
  render?.environment?.identity !== 'fixed-studio' ||
  render?.environment?.specularMipLevels !== 6 ||
  render?.shaderCompilation !== 'pass' ||
  render?.publicSdkOnly !== true ||
  render?.gallery?.drawCalls !== 20 ||
  render?.gallery?.triangles !== 10560 ||
  render?.gallery?.visibleCount !== 20 ||
  render?.gallery?.materialCount !== 20 ||
  JSON.stringify(render?.gallery?.metallicSteps) !== JSON.stringify([0, 0.25, 0.5, 0.75, 1]) ||
  JSON.stringify(render?.gallery?.roughnessSteps) !== JSON.stringify([0.05, 0.25, 0.5, 0.75, 1]) ||
  render?.gallery?.contractTests?.length !== 8 ||
  render?.controls?.ao !== 'off' ||
  render?.controls?.normalY !== 'Y-down' ||
  render?.controls?.rotationDegrees !== 90 ||
  render?.controls?.exposure !== 1 ||
  render?.controls?.toneMapping !== 'clamp' ||
  render?.resources?.activeCount !== 88 ||
  render?.resources?.activeEstimatedBytes !== 2743112 ||
  render?.resources?.gpuMeshCount !== 1 ||
  render?.resources?.objectBindingCount !== 20 ||
  render?.resources?.pipelineCount !== 12 ||
  render?.resources?.stableAfterControls !== true ||
  cpu?.sampleCount !== 10 ||
  cpu?.p95Ms >= cpu?.budgetMs ||
  dirtyToSleep?.sampleCount !== 10 ||
  dirtyToSleep?.p95Ms >= dirtyToSleep?.budgetMs ||
  render?.performance?.gpuFrameTimeMs?.status !== 'NOT_AVAILABLE'
) {
  failures.push(
    'render evidence: Gallery, controls, resources, timing, or GPU declaration is invalid',
  );
}

const lifecycle = await readJson('test-results/phase-03/lifecycle-metrics.json');
if (
  lifecycle?.status !== 'PASS' ||
  lifecycle?.devicePixelRatio !== 2 ||
  lifecycle?.resourceBaseline !== 88 ||
  lifecycle?.resourcesAfterDeviceLoss !== 0 ||
  lifecycle?.resourcesAfterRecovery !== 88 ||
  lifecycle?.resourcesAfterDispose !== 0 ||
  lifecycle?.resourcesAfterRecreate !== 88 ||
  lifecycle?.resourcesAfterFinalDispose !== 0 ||
  lifecycle?.estimatedBytesReady !== 8988312 ||
  lifecycle?.estimatedBytesAfterDeviceLoss !== 0 ||
  lifecycle?.estimatedBytesAfterRecovery !== 8988312 ||
  lifecycle?.estimatedBytesAfterDispose !== 0 ||
  lifecycle?.estimatedBytesAfterRecreate !== 8988312 ||
  lifecycle?.estimatedBytesAfterFinalDispose !== 0
) {
  failures.push('lifecycle evidence: DPR, loss, disposal, recovery, or recreation is invalid');
}

const benchmark = await readJson('benchmarks/phase-03/summary.json');
const staticMeasurement = await readJson('benchmarks/phase-03/static-to-sleep.json');
const benchmarkCpu = benchmark?.metrics?.cpuFrameTimeMs;
const benchmarkSleep = benchmark?.metrics?.staticToSleep;
if (
  benchmark?.status !== 'PASS_WITH_DECLARED_UNAVAILABLE_GPU_TIMING' ||
  benchmark?.previousAcceptedTagComparison?.tag !== 'phase-02-accepted' ||
  benchmark?.previousAcceptedTagComparison?.cpuFrameTimeP95?.status !==
    'PASS_WITHIN_PHASE_03_BUDGET' ||
  benchmark?.previousAcceptedTagComparison?.staticToSleepP95?.status !==
    'PASS_WITHIN_PHASE_03_BUDGET' ||
  benchmarkCpu?.status !== 'PASS' ||
  benchmarkCpu?.sampleCount !== 10 ||
  benchmarkCpu?.p95Ms >= benchmarkCpu?.budgetMs ||
  benchmarkSleep?.status !== 'PASS' ||
  benchmarkSleep?.sampleCount !== 10 ||
  benchmarkSleep?.p95Ms >= benchmarkSleep?.budgetMs ||
  benchmark?.metrics?.activeResourceCountAfterDeviceLoss?.value !== 0 ||
  benchmark?.metrics?.activeResourceCountAfterDispose?.value !== 0 ||
  benchmark?.metrics?.assetLoadTimeMs?.status !== 'NOT_APPLICABLE'
) {
  failures.push('benchmark evidence: comparison, timing, resources, or declarations failed');
}
for (const metric of ['budgetMs', 'maxMs', 'medianMs', 'minMs', 'p95Ms', 'sampleCount']) {
  if (staticMeasurement?.[metric] !== benchmarkSleep?.[metric]) {
    failures.push(`benchmark evidence: static-to-sleep ${metric} records disagree`);
  }
  if (staticMeasurement?.cpuFrameTimeMs?.[metric] !== benchmarkCpu?.[metric]) {
    failures.push(`benchmark evidence: CPU frame ${metric} records disagree`);
  }
}

const technicalQa = await readJson('test-results/phase-03/technical-qa.json');
if (
  technicalQa?.status !== 'PASS' ||
  technicalQa?.acceptanceState !== 'Technical QA Passed' ||
  technicalQa?.sourceCommit !== sourceCommit ||
  technicalQa?.ci?.runId !== sourceCiRun ||
  technicalQa?.ci?.jobId !== sourceCiJob ||
  technicalQa?.ci?.conclusion !== 'success' ||
  technicalQa?.ci?.artifactId !== sourceArtifact ||
  technicalQa?.ci?.artifactDigest !== sourceArtifactDigest ||
  technicalQa?.evidencePackCi?.runId !== evidencePackCiRun ||
  technicalQa?.evidencePackCi?.jobId !== evidencePackCiJob ||
  technicalQa?.evidencePackCi?.sourceCommit !== evidencePackCommit ||
  technicalQa?.evidencePackCi?.conclusion !== 'success' ||
  technicalQa?.evidencePackCi?.artifactId !== evidencePackArtifact ||
  technicalQa?.evidencePackCi?.artifactDigest !== evidencePackArtifactDigest ||
  Object.values(technicalQa?.checks ?? {}).some((status) => status !== 'PASS') ||
  Object.keys(technicalQa?.checks ?? {}).length !== 15 ||
  technicalQa?.deploymentGate?.status !== 'PENDING' ||
  technicalQa?.blockingDefects?.length !== 0 ||
  technicalQa?.remainingGates?.length !== 5
) {
  failures.push(
    'technical QA evidence: source, checks, evidence CI, deployment, or defects are invalid',
  );
}

const owner = await readJson('test-results/phase-03/owner-acceptance.json');
if (
  owner?.status !== 'PASS' ||
  owner?.acceptanceState !== 'Owner Acceptance Passed — Deployment Pending' ||
  owner?.reviewedCheckpoint !== sourceCommit ||
  owner?.ci?.runId !== sourceCiRun ||
  owner?.ci?.conclusion !== 'success' ||
  owner?.ci?.artifactId !== sourceArtifact ||
  owner?.ci?.artifactDigest !== sourceArtifactDigest ||
  owner?.finalOwnerEvidenceCi?.runId !== evidencePackCiRun ||
  owner?.finalOwnerEvidenceCi?.jobId !== evidencePackCiJob ||
  owner?.finalOwnerEvidenceCi?.sourceCommit !== evidencePackCommit ||
  owner?.finalOwnerEvidenceCi?.conclusion !== 'success' ||
  owner?.finalOwnerEvidenceCi?.artifactId !== evidencePackArtifact ||
  owner?.finalOwnerEvidenceCi?.artifactDigest !== evidencePackArtifactDigest ||
  owner?.finalOwnerEvidenceCi?.browserTests !== 21 ||
  owner?.subjectiveReview?.status !== 'PASS' ||
  owner?.subjectiveReview?.defects?.length !== 0 ||
  Object.values(owner?.phaseOperations ?? {}).some((status) => status !== 'PASS') ||
  Object.keys(owner?.phaseOperations ?? {}).length !== 10 ||
  Object.values(owner?.generalChecklist ?? {}).some((status) => status !== 'PASS') ||
  owner?.deploymentGate?.status !== 'PENDING' ||
  !owner?.deploymentGate?.requiredRoutes?.includes('/latest/') ||
  !owner?.deploymentGate?.requiredRoutes?.includes('/phase-3/') ||
  owner?.blockingDefects?.length !== 0 ||
  owner?.remainingGates?.length !== 5
) {
  failures.push(
    'owner evidence: checklist, review, evidence CI, deployment, or defects are invalid',
  );
}

const visual = await readJson('visual-baselines/phase-03/metadata.json');
const reference = await verifyImage('reference', visual?.files?.reference);
const current = await verifyImage('current', visual?.files?.current);
const difference = await verifyImage('difference', visual?.files?.difference);
const galleryReference = await verifyImage('gallery reference', visual?.files?.galleryReference);
const galleryCurrent = await verifyImage('gallery current', visual?.files?.galleryCurrent);
const galleryDifference = await verifyImage('gallery difference', visual?.files?.galleryDifference);
if (
  visual?.comparison?.status !== 'PASS' ||
  visual?.comparison?.maximumDiffPixels !== 0 ||
  visual?.comparison?.fullPageActualDiffPixels !== 0 ||
  visual?.comparison?.galleryActualDiffPixels !== 0 ||
  reference?.sha256 !== current?.sha256 ||
  reference?.sha256 !== fullPageHash ||
  galleryReference?.sha256 !== galleryCurrent?.sha256 ||
  galleryReference?.sha256 !== galleryHash ||
  difference?.sha256 !== 'b827a79649ce47a076446e32c94ae295fdb448337a6a93b6e357dbb566a1ad83' ||
  galleryDifference?.sha256 !==
    '3d149adc6f818307fe8e1127d5f9d3b1ef4d8061163536aa2459799b94328a83' ||
  visual?.canonicalProvenance?.sourceRunId !== visualSourceRun ||
  visual?.canonicalProvenance?.sourceCommit !== visualSourceCommit ||
  visual?.canonicalProvenance?.sourceArtifactId !== visualSourceArtifact ||
  visual?.canonicalProvenance?.verificationRunId !== sourceCiRun ||
  visual?.canonicalProvenance?.verificationCommit !== sourceCommit ||
  visual?.canonicalProvenance?.verificationArtifactId !== sourceArtifact ||
  visual?.canonicalProvenance?.attemptsByteIdentical !== true ||
  visual?.canonicalProvenance?.fullPageAttemptHashes?.length !== 2 ||
  visual.canonicalProvenance.fullPageAttemptHashes.some((hash) => hash !== fullPageHash) ||
  visual?.canonicalProvenance?.galleryAttemptHashes?.length !== 2 ||
  visual.canonicalProvenance.galleryAttemptHashes.some((hash) => hash !== galleryHash) ||
  visual?.canonicalProvenance?.evidencePackCi?.runId !== evidencePackCiRun ||
  visual?.canonicalProvenance?.evidencePackCi?.jobId !== evidencePackCiJob ||
  visual?.canonicalProvenance?.evidencePackCi?.sourceCommit !== evidencePackCommit ||
  visual?.canonicalProvenance?.evidencePackCi?.conclusion !== 'success' ||
  visual?.canonicalProvenance?.evidencePackCi?.artifactId !== evidencePackArtifact ||
  visual?.canonicalProvenance?.evidencePackCi?.artifactDigest !== evidencePackArtifactDigest ||
  visual?.canonicalProvenance?.evidencePackCi?.fullPageHash !== fullPageHash ||
  visual?.canonicalProvenance?.evidencePackCi?.galleryHash !== galleryHash ||
  visual?.subjectiveReview?.status !== 'PASS' ||
  visual?.subjectiveReview?.defects?.length !== 0
) {
  failures.push(
    'visual evidence: zero-diff baselines, repeatability, provenance, or review is invalid',
  );
}

try {
  const acceptance = await readFile(
    path.join(root, 'docs/acceptance/phase-03/PHASE_03_ACCEPTANCE.md'),
    'utf8',
  );
  for (const heading of [
    '## Automated results',
    '## Architecture evidence',
    '## Numerical rendering evidence',
    '## Visual evidence',
    '## Performance and resource evidence',
    '## Owner checklist status',
    '## Known limitations',
    '## Continuous deployment gate',
    '## Acceptance conclusion',
  ]) {
    if (!acceptance.includes(heading)) failures.push(`acceptance document: missing ${heading}`);
  }
  for (const fragment of [
    'Owner Acceptance Passed — Deployment Pending',
    `GitHub Actions Run \`${sourceCiRun}\``,
    `Evidence-pack Run \`${evidencePackCiRun}\``,
    'Phase 3 is not Accepted while this status remains pending.',
    '21 / 21',
    '0 differing pixels',
  ]) {
    if (!acceptance.includes(fragment)) failures.push(`acceptance document: missing ${fragment}`);
  }
} catch (error) {
  failures.push(`acceptance document: ${String(error)}`);
}

try {
  const plan = await readFile(path.join(root, 'PHASE_ACCEPTANCE_PLAN.md'), 'utf8');
  for (const fragment of [
    '## 8. Phase 3：基础 PBR 与 IBL',
    'Metallic 0–1 梯度。',
    'HDRI 旋转。',
    'AO 主要影响间接光。',
    '材质球达到产品可用画质。',
    '## 24. Continuous Deployment Gate（持续部署门禁）',
    'Any failed workflow automatically blocks Phase acceptance.',
  ]) {
    if (!plan.includes(fragment)) failures.push(`global acceptance plan: missing ${fragment}`);
  }
} catch (error) {
  failures.push(`global acceptance plan: ${String(error)}`);
}

try {
  const [ci, deploy, freeze, online, packageJson] = await Promise.all([
    readFile(path.join(root, '.github/workflows/ci.yml'), 'utf8'),
    readFile(path.join(root, '.github/workflows/deploy-pages.yml'), 'utf8'),
    readFile(path.join(root, '.github/workflows/freeze-deployed-phase.yml'), 'utf8'),
    readFile(path.join(root, 'tests/e2e/online-pages.spec.ts'), 'utf8'),
    readFile(path.join(root, 'package.json'), 'utf8'),
  ]);
  for (const fragment of ['test-results/phase-03/runtime/', 'pnpm verify']) {
    if (!ci.includes(fragment)) failures.push(`CI workflow: missing ${fragment}`);
  }
  for (const fragment of [
    'pages: write',
    'actions/deploy-pages@v5',
    'Verify public interactions',
    'playwright.pages.config.ts',
  ]) {
    if (!deploy.includes(fragment)) failures.push(`Pages workflow: missing ${fragment}`);
  }
  for (const fragment of [
    'Deploy accepted Playgrounds',
    'contents: write',
    'git tag --annotate',
    'preserving its original target',
  ]) {
    if (!freeze.includes(fragment)) failures.push(`post-deployment freeze: missing ${fragment}`);
  }
  for (const fragment of [
    'if (phase === 3)',
    "changeRange('metallic', '0.85')",
    "changeRange('roughness', '0.2')",
    "changeRange('exposure', '1')",
    "changeRange('rotation', '90')",
    "['normal', 'normal-direction', 'Y-down']",
    "['ao', 'ao-state', 'off']",
    "['tone-map', 'tone-map-mode', 'clamp']",
    '[data-action="lose"]',
    '[data-action="recover"]',
    '[data-action="dispose"]',
    '[data-action="recreate"]',
  ]) {
    if (!online.includes(fragment)) failures.push(`online Phase 3 acceptance: missing ${fragment}`);
  }
  if (!packageJson.includes('check:acceptance:phase-03')) {
    failures.push('package scripts: Phase 3 acceptance schema is not part of verify');
  }
  if (deploy.includes('pull_request_target') || freeze.includes('pull_request_target')) {
    failures.push('deployment workflows: pull_request_target is forbidden');
  }
} catch (error) {
  failures.push(`workflow or online acceptance: ${String(error)}`);
}

try {
  const accepted = await resolveAcceptedPhases(root);
  if (accepted.latest !== 3 || JSON.stringify(accepted.phases) !== JSON.stringify([0, 1, 2, 3])) {
    failures.push(
      'deployment candidate: owner evidence does not yield contiguous Phase 0–3 routes',
    );
  }
} catch (error) {
  failures.push(`deployment candidate: ${String(error)}`);
}

if (failures.length > 0) {
  process.stderr.write(`${JSON.stringify({ failures, status: 'FAIL' }, null, 2)}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `${JSON.stringify({ evidenceFiles: requiredTextFiles.length + 6, phase: '03', status: 'PASS', deployment: 'PENDING' }, null, 2)}\n`,
  );
}
