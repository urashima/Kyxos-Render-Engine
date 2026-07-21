import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sourceCommit = '390b1ecc3bfb1e94c5155470b6abec7b1fc4202c';
const sourceCiRun = 29854505862;
const sourceCiJob = 88715390559;
const sourceArtifact = 8504813925;
const sourceArtifactDigest =
  'sha256:0a14fcd7ed9699318f76db264c03fceb3f16def0dbee0792c104071c8be51f33';
const requiredTextFiles = [
  '.github/workflows/deploy-pages.yml',
  '.github/workflows/freeze-deployed-phase.yml',
  'benchmarks/phase-02/static-to-sleep.json',
  'benchmarks/phase-02/summary.json',
  'docs/acceptance/phase-02/OWNER_ACCEPTANCE.md',
  'docs/acceptance/phase-02/PHASE_02_ACCEPTANCE.md',
  'docs/acceptance/phase-02/TECHNICAL_QA.md',
  'PHASE_ACCEPTANCE_PLAN.md',
  'test-results/phase-02/automated-summary.json',
  'test-results/phase-02/bundle-metrics.json',
  'test-results/phase-02/dependency-graph.json',
  'test-results/phase-02/lifecycle-metrics.json',
  'test-results/phase-02/owner-acceptance.json',
  'test-results/phase-02/render-metrics.json',
  'test-results/phase-02/technical-qa.json',
  'tests/e2e/online-pages.spec.ts',
  'visual-baselines/phase-02/metadata.json',
];
const imageDirectory = path.join(root, 'visual-baselines/phase-02');
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

const automated = await readJson('test-results/phase-02/automated-summary.json');
if (
  automated?.phase !== '02' ||
  automated?.localStatus !== 'PASS' ||
  automated?.remoteCiStatus !== 'PASS' ||
  automated?.sourceCheckpoint !== sourceCommit ||
  automated?.remoteCi?.runId !== sourceCiRun ||
  automated?.remoteCi?.jobId !== sourceCiJob ||
  automated?.remoteCi?.sourceCommit !== sourceCommit ||
  automated?.remoteCi?.conclusion !== 'success' ||
  automated?.remoteCi?.artifactId !== sourceArtifact ||
  automated?.remoteCi?.artifactDigest !== sourceArtifactDigest ||
  automated?.visualSource?.runId !== 29852642508 ||
  automated?.visualSource?.artifactId !== 8504096148 ||
  automated?.deploymentGate?.status !== 'PENDING' ||
  !automated?.deploymentGate?.requiredRoutes?.includes('/phase-2/') ||
  !Array.isArray(automated?.requiredFailures) ||
  automated.requiredFailures.length !== 0 ||
  automated?.gates?.some((gate) => gate.status !== 'PASS')
) {
  failures.push('automated summary: source CI, gates, deployment state, or failures are invalid');
}

const dependencies = await readJson('test-results/phase-02/dependency-graph.json');
if (
  dependencies?.status !== 'PASS' ||
  dependencies?.deliberateFixtureRejected !== true ||
  dependencies?.cycles?.length !== 0 ||
  dependencies?.violations?.length !== 0 ||
  dependencies?.edges?.['@kyxos/render-math']?.length !== 0 ||
  JSON.stringify(dependencies?.edges?.['@kyxos/render-geometry']) !==
    JSON.stringify(['@kyxos/render-math']) ||
  dependencies?.edges?.['@kyxos/render-scene']?.includes('@kyxos/render-renderer') ||
  dependencies?.edges?.['@kyxos/render-visibility']?.includes('@kyxos/render-backend-webgpu') ||
  dependencies?.edges?.['@kyxos/render-renderer']?.includes('@kyxos/render-backend-webgpu') ||
  !dependencies?.edges?.['@kyxos/render-sdk']?.includes('@kyxos/render-backend-webgpu')
) {
  failures.push('dependency evidence: graph, Phase 2 boundaries, or negative fixture is invalid');
}

const bundle = await readJson('test-results/phase-02/bundle-metrics.json');
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

const render = await readJson('test-results/phase-02/render-metrics.json');
const cpu = render?.performance?.cpuFrameTimeMs;
const dirtyToSleep = render?.performance?.dirtyToSleepMs;
if (
  render?.environment?.backend !== 'webgpu' ||
  render?.shaderCompilation !== 'pass' ||
  render?.geometry?.contract !== 'Plane · Cube · Sphere · Custom' ||
  render?.geometry?.customMesh !== 'custom-tetrahedron' ||
  render?.scene?.entityCount !== 10 ||
  render?.scene?.hierarchy !== 'Root → Child' ||
  render?.submission?.drawCalls !== 6 ||
  render?.submission?.triangles !== 690 ||
  render?.submission?.submittedVertices !== 2070 ||
  render?.submission?.visibleCount !== 6 ||
  render?.submission?.opaqueCount !== 4 ||
  render?.submission?.transparentCount !== 2 ||
  render?.submission?.transparentOrder !== 'Glass Far → Glass Near' ||
  render?.culling?.frustumCulledCount !== 1 ||
  render?.culling?.layerCulledCount !== 1 ||
  render?.resources?.activeCount !== 25 ||
  render?.resources?.activeEstimatedBufferBytes !== 6948 ||
  render?.resources?.activeEstimatedTextureBytes !== 2271360 ||
  render?.resources?.gpuMeshCount !== 4 ||
  render?.resources?.objectBindingCount !== 6 ||
  render?.resources?.pipelineCount !== 2 ||
  render?.resources?.materialCount !== 4 ||
  cpu?.sampleCount !== 10 ||
  cpu?.p95Ms >= cpu?.budgetMs ||
  dirtyToSleep?.sampleCount !== 10 ||
  dirtyToSleep?.p95Ms >= dirtyToSleep?.budgetMs ||
  render?.performance?.gpuFrameTimeMs?.capabilityAvailable !== true ||
  render?.performance?.gpuFrameTimeMs?.status !== 'NOT_AVAILABLE'
) {
  failures.push('render evidence: Scene, queues, resources, timing, or GPU declaration is invalid');
}

const lifecycle = await readJson('test-results/phase-02/lifecycle-metrics.json');
if (
  lifecycle?.status !== 'PASS' ||
  lifecycle?.devicePixelRatio !== 2 ||
  lifecycle?.estimatedBytesReady !== 7658788 ||
  lifecycle?.estimatedBytesAfterDeviceLoss !== 0 ||
  lifecycle?.estimatedBytesAfterRecovery !== 7658788 ||
  lifecycle?.estimatedBytesAfterDispose !== 0 ||
  lifecycle?.estimatedBytesAfterRecreate !== 7658788 ||
  lifecycle?.estimatedBytesAfterFinalDispose !== 0 ||
  lifecycle?.resourceBaseline !== 25 ||
  lifecycle?.resourcesAfterDeviceLoss !== 0 ||
  lifecycle?.resourcesAfterDispose !== 0 ||
  lifecycle?.resourcesAfterFinalDispose !== 0 ||
  lifecycle?.resourcesAfterRecovery !== 25 ||
  lifecycle?.resourcesAfterRecreate !== 25
) {
  failures.push('lifecycle evidence: DPR, loss, disposal, recovery, or recreation is invalid');
}

const benchmark = await readJson('benchmarks/phase-02/summary.json');
const staticMeasurement = await readJson('benchmarks/phase-02/static-to-sleep.json');
const benchmarkCpu = benchmark?.metrics?.cpuFrameTimeMs;
const benchmarkSleep = benchmark?.metrics?.staticToSleep;
if (
  benchmark?.status !== 'PASS_WITH_DECLARED_UNAVAILABLE_GPU_TIMING' ||
  benchmark?.previousAcceptedTagComparison?.tag !== 'phase-01-accepted' ||
  benchmark?.previousAcceptedTagComparison?.cpuFrameTimeP95?.status !==
    'PASS_WITHIN_PHASE_02_BUDGET' ||
  benchmark?.previousAcceptedTagComparison?.staticToSleepP95?.status !==
    'PASS_WITHIN_PHASE_02_BUDGET' ||
  benchmarkCpu?.status !== 'PASS' ||
  benchmarkCpu?.sampleCount !== 10 ||
  benchmarkCpu?.p95Ms >= benchmarkCpu?.budgetMs ||
  benchmarkSleep?.status !== 'PASS' ||
  benchmarkSleep?.sampleCount !== 10 ||
  benchmarkSleep?.p95Ms >= benchmarkSleep?.budgetMs ||
  benchmark?.metrics?.activeResourceCountAfterDeviceLoss?.value !== 0 ||
  benchmark?.metrics?.activeResourceCountAfterDispose?.value !== 0
) {
  failures.push('benchmark evidence: comparison, timing, or resource budgets failed');
}
for (const metric of ['budgetMs', 'maxMs', 'medianMs', 'minMs', 'p95Ms', 'sampleCount']) {
  if (staticMeasurement?.[metric] !== benchmarkSleep?.[metric]) {
    failures.push(`benchmark evidence: static-to-sleep ${metric} records disagree`);
  }
  if (staticMeasurement?.cpuFrameTimeMs?.[metric] !== benchmarkCpu?.[metric]) {
    failures.push(`benchmark evidence: CPU frame ${metric} records disagree`);
  }
}

const technicalQa = await readJson('test-results/phase-02/technical-qa.json');
if (
  technicalQa?.status !== 'PASS' ||
  technicalQa?.acceptanceState !== 'Technical QA Passed' ||
  technicalQa?.sourceCommit !== sourceCommit ||
  technicalQa?.ci?.runId !== sourceCiRun ||
  technicalQa?.ci?.conclusion !== 'success' ||
  technicalQa?.ci?.artifactId !== sourceArtifact ||
  technicalQa?.ci?.artifactDigest !== sourceArtifactDigest ||
  Object.values(technicalQa?.checks ?? {}).some((status) => status !== 'PASS') ||
  technicalQa?.deploymentGate?.status !== 'PENDING' ||
  technicalQa?.blockingDefects?.length !== 0 ||
  technicalQa?.remainingGates?.length < 5
) {
  failures.push('technical QA evidence: source, checks, deployment state, or defects are invalid');
}

const owner = await readJson('test-results/phase-02/owner-acceptance.json');
if (
  owner?.status !== 'PASS' ||
  owner?.acceptanceState !== 'Owner Acceptance Passed — Deployment Pending' ||
  owner?.reviewedCheckpoint !== sourceCommit ||
  owner?.ci?.runId !== sourceCiRun ||
  owner?.ci?.conclusion !== 'success' ||
  owner?.ci?.artifactId !== sourceArtifact ||
  owner?.ci?.artifactDigest !== sourceArtifactDigest ||
  owner?.subjectiveReview?.status !== 'PASS' ||
  Object.values(owner?.phaseOperations ?? {}).some((status) => status !== 'PASS') ||
  Object.values(owner?.generalChecklist ?? {}).some((status) => status !== 'PASS') ||
  owner?.deploymentGate?.status !== 'PENDING' ||
  !owner?.deploymentGate?.requiredRoutes?.includes('/latest/') ||
  !owner?.deploymentGate?.requiredRoutes?.includes('/phase-2/') ||
  owner?.blockingDefects?.length !== 0 ||
  owner?.remainingGates?.length < 5
) {
  failures.push('owner evidence: checklist, review, deployment state, or defects are invalid');
}

const visual = await readJson('visual-baselines/phase-02/metadata.json');
const reference = await verifyImage('reference', visual?.files?.reference);
const current = await verifyImage('current', visual?.files?.current);
const difference = await verifyImage('difference', visual?.files?.difference);
const scene = await verifyImage('scene', visual?.files?.scene);
if (
  visual?.comparison?.status !== 'PASS' ||
  visual?.comparison?.actualDiffPixels !== 0 ||
  visual?.comparison?.maximumDiffPixels !== 0 ||
  reference?.sha256 !== current?.sha256 ||
  reference?.sha256 !== '54ab5abb306a6cfd1acbe5488f9fd724a45a1bc960bf08a5515f20070dc14142' ||
  scene?.sha256 !== '75a126186da2136835c2c6adb13f877a2a379b8ea0182a77ce7341fc971f1f1e' ||
  difference?.sha256 !== '1dd628fff034aac6672d32d1958492077667ab3d47f23f1596a0d270684619e8' ||
  visual?.canonicalProvenance?.sourceRunId !== 29852642508 ||
  visual?.canonicalProvenance?.priorVerificationRunId !== 29853253312 ||
  visual?.canonicalProvenance?.priorVerificationArtifactId !== 8504322478 ||
  visual?.canonicalProvenance?.verificationRunId !== sourceCiRun ||
  visual?.canonicalProvenance?.verificationArtifactId !== sourceArtifact ||
  visual?.canonicalProvenance?.attemptsByteIdentical !== true ||
  visual?.canonicalProvenance?.attemptHashes?.length !== 3 ||
  visual.canonicalProvenance.attemptHashes.some((hash) => hash !== reference?.sha256) ||
  visual?.canonicalProvenance?.sceneAttemptHashes?.length !== 3 ||
  visual.canonicalProvenance.sceneAttemptHashes.some((hash) => hash !== scene?.sha256) ||
  visual?.subjectiveReview?.status !== 'PASS'
) {
  failures.push('visual evidence: zero-diff baseline, repeatability, or direct review is invalid');
}

try {
  const acceptance = await readFile(
    path.join(root, 'docs/acceptance/phase-02/PHASE_02_ACCEPTANCE.md'),
    'utf8',
  );
  for (const heading of [
    '## Automated results',
    '## Architecture evidence',
    '## Visual evidence',
    '## Performance and resource evidence',
    '## Owner checklist status',
    '## Known limitations',
    '## Continuous deployment gate',
    '## Acceptance conclusion',
  ]) {
    if (!acceptance.includes(heading)) failures.push(`acceptance document: missing ${heading}`);
  }
  if (!acceptance.includes('Owner Acceptance Passed — Deployment Pending')) {
    failures.push('acceptance document: deployment-pending owner state is not declared');
  }
  if (!acceptance.includes(`GitHub Actions Run \`${sourceCiRun}\``)) {
    failures.push('acceptance document: inspected successful CI is not declared');
  }
  if (!acceptance.includes('Phase 2 is not Accepted while this status remains pending.')) {
    failures.push('acceptance document: public deployment must explicitly block Phase acceptance');
  }
} catch (error) {
  failures.push(`acceptance document: ${String(error)}`);
}

try {
  const plan = await readFile(path.join(root, 'PHASE_ACCEPTANCE_PLAN.md'), 'utf8');
  const gateHeading = '## 24. Continuous Deployment Gate（持续部署门禁）';
  if (plan.split(gateHeading).length - 1 !== 1) {
    failures.push('global acceptance plan: Continuous Deployment Gate must appear exactly once');
  }
  for (const fragment of [
    '/latest/      -> Latest stable Playground',
    '/phase-14/',
    'Any failed workflow automatically blocks Phase acceptance.',
    'GitHub Pages deployment failure.',
  ]) {
    if (!plan.includes(fragment)) failures.push(`global acceptance plan: missing ${fragment}`);
  }
  if (
    !plan
      .trimEnd()
      .endsWith(
        'This guarantees continuous integration, continuous delivery, transparent progress tracking, rapid regression testing, and a permanent online showcase of the Kyxos Render Engine development process.',
      )
  ) {
    failures.push('global acceptance plan: deployment gate is not the final document section');
  }
} catch (error) {
  failures.push(`global acceptance plan: ${String(error)}`);
}

try {
  const deploy = await readFile(path.join(root, '.github/workflows/deploy-pages.yml'), 'utf8');
  for (const fragment of [
    'pages: write',
    'id-token: write',
    'actions/configure-pages@v6',
    'actions/upload-pages-artifact@v5',
    'actions/deploy-pages@v5',
    'pnpm build:pages',
    'pnpm check:pages',
    'Verify public interactions',
    'playwright.pages.config.ts',
  ]) {
    if (!deploy.includes(fragment)) failures.push(`Pages workflow: missing ${fragment}`);
  }
  const freeze = await readFile(
    path.join(root, '.github/workflows/freeze-deployed-phase.yml'),
    'utf8',
  );
  for (const fragment of [
    'Deploy accepted Playgrounds',
    'contents: write',
    'git tag --annotate',
    'preserving its original target',
  ]) {
    if (!freeze.includes(fragment)) failures.push(`post-deployment freeze: missing ${fragment}`);
  }
  if (deploy.includes('pull_request_target') || freeze.includes('pull_request_target')) {
    failures.push('deployment workflows: pull_request_target is forbidden');
  }
} catch (error) {
  failures.push(`deployment workflows: ${String(error)}`);
}

try {
  const online = await readFile(path.join(root, 'tests/e2e/online-pages.spec.ts'), 'utf8');
  for (const fragment of [
    '[data-action="cycle-geometry"]',
    '[data-action="move-hierarchy"]',
    '[data-action="swap-transparent"]',
    '[data-action="rotate-parent"]',
    '[data-action="frame"]',
    '[data-action="toggle-culling"]',
    '[data-action="toggle-layers"]',
    'page.mouse.down()',
    'page.mouse.wheel(0, -160)',
  ]) {
    if (!online.includes(fragment)) failures.push(`online acceptance: missing ${fragment}`);
  }
} catch (error) {
  failures.push(`online acceptance: ${String(error)}`);
}

if (failures.length > 0) {
  process.stderr.write(`${JSON.stringify({ failures, status: 'FAIL' }, null, 2)}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `${JSON.stringify({ evidenceFiles: requiredTextFiles.length + 4, phase: '02', status: 'PASS', deployment: 'PENDING' }, null, 2)}\n`,
  );
}
