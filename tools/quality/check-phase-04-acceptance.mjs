import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveAcceptedPhases } from '../deployment/accepted-phases.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const failures = [];
const expectedSource = 'd11b1e4c18722d7aaf4e950b53085e9ac2d12e03';
const expectedRun = 29991223373;
const expectedArtifact = 8557205445;
const expectedDigest = 'sha256:9fbf6138349649d271f6fd2aa6e705e1fb1be34bd2e45f43fa3d8a22079922e1';

async function readJson(relativePath) {
  try {
    return JSON.parse(await readFile(path.join(root, relativePath), 'utf8'));
  } catch (error) {
    failures.push(`${relativePath}: ${String(error)}`);
    return undefined;
  }
}

async function readText(relativePath) {
  try {
    return await readFile(path.join(root, relativePath), 'utf8');
  } catch (error) {
    failures.push(`${relativePath}: ${String(error)}`);
    return '';
  }
}

function requireEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures.push(
      `${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}

function requirePass(record, label) {
  if (record?.status !== 'PASS') failures.push(`${label}: status must be PASS`);
}

function requireProvenance(record, label) {
  requireEqual(record?.runId, expectedRun, `${label}.runId`);
  requireEqual(record?.sourceCommit, expectedSource, `${label}.sourceCommit`);
  requireEqual(record?.conclusion, 'success', `${label}.conclusion`);
  requireEqual(record?.artifactId, expectedArtifact, `${label}.artifactId`);
  requireEqual(record?.artifactDigest, expectedDigest, `${label}.artifactDigest`);
}

async function requireFileMetadata(relativeDirectory, metadata) {
  for (const [label, expected] of Object.entries(metadata.files ?? {})) {
    const relativePath = path.join(relativeDirectory, expected.path);
    try {
      const bytes = await readFile(path.join(root, relativePath));
      const fileStat = await stat(path.join(root, relativePath));
      const hash = createHash('sha256').update(bytes).digest('hex');
      requireEqual(fileStat.size, expected.bytes, `${label}.bytes`);
      requireEqual(hash, expected.sha256, `${label}.sha256`);
      if (
        bytes.length < 24 ||
        bytes.toString('hex', 0, 8) !== '89504e470d0a1a0a' ||
        bytes.readUInt32BE(16) !== expected.width ||
        bytes.readUInt32BE(20) !== expected.height
      ) {
        failures.push(`${relativePath}: PNG dimensions or signature do not match metadata`);
      }
    } catch (error) {
      failures.push(`${relativePath}: ${String(error)}`);
    }
  }
}

const [
  automated,
  technical,
  owner,
  benchmark,
  bundle,
  dependencies,
  metadata,
  route,
  reprojection,
  temporalOutput,
  temporalPipeline,
  staticLifecycle,
  staticReference,
  staticRuntime,
  history,
  presentReference,
  presentSurface,
  resolveGpu,
  resolveReference,
] = await Promise.all([
  readJson('test-results/phase-04/automated-summary.json'),
  readJson('test-results/phase-04/technical-qa.json'),
  readJson('test-results/phase-04/owner-acceptance.json'),
  readJson('benchmarks/phase-04/performance.json'),
  readJson('test-results/phase-04/bundle-metrics.json'),
  readJson('test-results/phase-04/dependency-graph.json'),
  readJson('visual-baselines/phase-04/metadata.json'),
  readJson('test-results/phase-04/acceptance-route.json'),
  readJson('test-results/phase-04/camera-reprojection.json'),
  readJson('test-results/phase-04/pbr-temporal-output.json'),
  readJson('test-results/phase-04/pbr-temporal-pipeline.json'),
  readJson('test-results/phase-04/static-accumulation-lifecycle.json'),
  readJson('test-results/phase-04/static-accumulation-reference.json'),
  readJson('test-results/phase-04/static-accumulation-runtime.json'),
  readJson('test-results/phase-04/taa-history-gpu.json'),
  readJson('test-results/phase-04/taa-present-reference.json'),
  readJson('test-results/phase-04/taa-present-surface.json'),
  readJson('test-results/phase-04/taa-resolve-gpu.json'),
  readJson('test-results/phase-04/taa-resolve-reference.json'),
]);

for (const [record, label] of [
  [automated, 'automated summary'],
  [technical, 'technical QA'],
  [owner, 'owner acceptance'],
  [bundle, 'bundle metrics'],
  [dependencies, 'dependency graph'],
  [route, 'public route'],
  [reprojection, 'camera reprojection'],
  [temporalOutput, 'temporal PBR output'],
  [temporalPipeline, 'temporal pipeline'],
  [staticLifecycle, 'static lifecycle'],
  [staticReference, 'static reference'],
  [staticRuntime, 'static runtime'],
  [history, 'TAA history'],
  [presentReference, 'Present reference'],
  [presentSurface, 'Present Surface'],
  [resolveGpu, 'TAA Resolve GPU'],
  [resolveReference, 'TAA Resolve reference'],
]) {
  requirePass(record, label);
}
if (!String(benchmark?.status).startsWith('PASS')) {
  failures.push('performance benchmark: status must begin with PASS');
}

requireEqual(automated?.sourceCheckpoint, expectedSource, 'automated.sourceCheckpoint');
requireProvenance(automated?.remoteCi, 'automated.remoteCi');
requireEqual(technical?.sourceCommit, expectedSource, 'technical.sourceCommit');
requireEqual(technical?.ci?.runId, expectedRun, 'technical.ci.runId');
requireEqual(technical?.ci?.artifactId, expectedArtifact, 'technical.ci.artifactId');
requireEqual(technical?.ci?.artifactDigest, expectedDigest, 'technical.ci.artifactDigest');
requireEqual(owner?.reviewedCheckpoint, expectedSource, 'owner.reviewedCheckpoint');
requireEqual(owner?.acceptanceState, 'Owner Acceptance Passed — Deployment Pending', 'owner state');
requireEqual(owner?.deploymentGate?.status, 'PENDING', 'owner deployment gate');
requireEqual(technical?.deploymentGate?.status, 'PENDING', 'technical deployment gate');
requireEqual(automated?.deploymentGate?.status, 'PENDING', 'automated deployment gate');
requireEqual(owner?.blockingDefects, [], 'owner blocking defects');
requireEqual(technical?.blockingDefects, [], 'technical blocking defects');
requireEqual(automated?.requiredFailures, [], 'automated required failures');

const requiredGateIds = [
  'format',
  'lint',
  'typecheck',
  'unit',
  'boundaries',
  'shaders',
  'build',
  'bundle',
  'pages-build',
  'browser',
  'visual',
  'performance',
  'resources',
];
requireEqual(
  automated?.gates?.map(({ id }) => id),
  requiredGateIds,
  'automated gate order',
);
if (automated?.gates?.some(({ status }) => status !== 'PASS')) {
  failures.push('automated gates: every required gate must PASS');
}

requireEqual(dependencies?.cycles, [], 'dependency cycles');
requireEqual(dependencies?.violations, [], 'dependency violations');
requireEqual(dependencies?.deliberateFixtureRejected, true, 'dependency negative fixture');
requireEqual(
  bundle?.metrics?.phase4RouteJavascript,
  { gzipBytes: 63135, rawBytes: 238195 },
  'route JS',
);
requireEqual(
  bundle?.metrics?.phase4RouteTotal,
  { gzipBytes: 117005, rawBytes: 304927 },
  'route total',
);

requireEqual(route?.checkpoint, 'P4-12', 'route checkpoint');
requireEqual(route?.runtimeErrors, [], 'route runtime errors');
requireEqual(route?.beforeDispose?.backend, 'webgpu', 'route backend');
requireEqual(route?.beforeDispose?.mode, 'sleeping', 'route mode');
requireEqual(route?.beforeDispose?.samples, '16', 'route samples');
requireEqual(route?.beforeDispose?.initialResources, 73, 'route resource baseline');
requireEqual(
  route?.lifecycle,
  {
    resourcesAfterDeviceLoss: 0,
    resourcesAfterDispose: 0,
    resourcesAfterRecovery: 73,
    resourcesAfterRecreate: 73,
  },
  'route lifecycle',
);
requireEqual(route?.performance?.cpuFrameTimeMs?.p95Ms, 1.2, 'CPU p95');
requireEqual(route?.performance?.cpuFrameTimeMs?.budgetMs, 16.7, 'CPU budget');
requireEqual(route?.performance?.staticToSleepMs?.p95Ms, 3827.2, 'static-to-sleep p95');
requireEqual(route?.performance?.staticToSleepMs?.budgetMs, 10000, 'static-to-sleep budget');
requireEqual(route?.performance?.gpuFrameTimeMs?.status, 'NOT_AVAILABLE', 'GPU time status');

requireEqual(reprojection?.maximumAbsoluteDifference, 0, 'camera reprojection difference');
if (resolveGpu?.maximumAbsoluteDifference > resolveGpu?.absoluteTolerance) {
  failures.push('TAA Resolve GPU parity exceeds its frozen tolerance');
}
if (resolveReference?.maximumAbsoluteDifference > resolveReference?.absoluteTolerance) {
  failures.push('TAA Resolve reference parity exceeds its frozen tolerance');
}
if (staticRuntime?.maximumAbsoluteDifference > staticRuntime?.tolerance) {
  failures.push('Static Accumulation runtime parity exceeds its frozen tolerance');
}
if (staticReference?.maximumAbsoluteDifference > staticReference?.absoluteTolerance) {
  failures.push('Static Accumulation reference parity exceeds its frozen tolerance');
}
requireEqual(presentReference?.maximumDifference, 0, 'Present reference difference');
requireEqual(temporalPipeline?.scheduler?.mode, 'sleeping', 'pipeline scheduler mode');
requireEqual(temporalPipeline?.scheduler?.pending, false, 'pipeline pending RAF');
requireEqual(
  temporalPipeline?.feature?.pipeline?.staticConvergence?.sampleCount,
  2,
  'static samples',
);
requireEqual(temporalPipeline?.resourcesAfterFeatureDispose?.activeCount, 0, 'pipeline disposal');
requireEqual(temporalPipeline?.resourcesAfterFeatureDispose?.createdTotal, 81, 'pipeline created');
requireEqual(
  temporalPipeline?.resourcesAfterFeatureDispose?.destroyedTotal,
  81,
  'pipeline destroyed',
);
requireEqual(temporalOutput?.resourcesAfterDispose?.activeCount, 0, 'temporal output disposal');
requireEqual(staticLifecycle?.resourcesAfterDispose?.activeCount, 0, 'static disposal');
requireEqual(presentSurface?.resourcesAfterDispose?.activeCount, 0, 'Present disposal');
requireEqual(history?.resourcesAfterHistoryDispose?.activeCount, 2, 'History disposal');
requireEqual(
  history?.resourcesAfterHistoryDispose?.byKind?.texture?.activeCount,
  0,
  'History Texture disposal',
);

requireEqual(
  metadata?.comparison,
  {
    status: 'PASS',
    threshold: 0.2,
    maximumDiffPixels: 0,
    actualDiffPixels: 0,
  },
  'visual comparison',
);
requireEqual(metadata?.canonicalProvenance?.verificationRunId, expectedRun, 'visual run');
requireEqual(metadata?.canonicalProvenance?.verificationCommit, expectedSource, 'visual source');
await requireFileMetadata('visual-baselines/phase-04', metadata);

const [
  acceptanceDoc,
  technicalDoc,
  ownerDoc,
  routeSource,
  routeTest,
  online,
  ci,
  deploy,
  packageJson,
] = await Promise.all([
  readText('docs/acceptance/phase-04/PHASE_04_ACCEPTANCE.md'),
  readText('docs/acceptance/phase-04/TECHNICAL_QA.md'),
  readText('docs/acceptance/phase-04/OWNER_ACCEPTANCE.md'),
  readText('apps/playground/src/acceptance/phase-04/index.ts'),
  readText('tests/e2e/phase-04-acceptance.spec.ts'),
  readText('tests/e2e/online-pages.spec.ts'),
  readText('.github/workflows/ci.yml'),
  readText('.github/workflows/deploy-pages.yml'),
  readText('package.json'),
]);

for (const [source, label, fragments] of [
  [
    acceptanceDoc,
    'acceptance document',
    ['Owner Acceptance Passed — Deployment Pending', '33 / 33', 'Phase 4 remains'],
  ],
  [
    technicalDoc,
    'technical document',
    ['Technical QA Passed', 'GPU timestamp duration', 'Public GitHub Pages verification'],
  ],
  [
    ownerDoc,
    'owner document',
    [
      'Camera',
      'Replace Texture',
      'Play animation',
      'Current public deployment status: **PENDING**',
    ],
  ],
  [
    routeTest,
    'route browser gate',
    ['maxDiffPixels: 0', 'Simulate Device Lost', 'Start animation', 'STATIC_TO_SLEEP_BUDGET_MS'],
  ],
  [
    online,
    'online Phase 4 gate',
    [
      'if (phase === 4)',
      '[data-action="reset-history"]',
      '[data-action="animation"]',
      '[data-action="lose"]',
      '[data-action="dispose"]',
    ],
  ],
  [ci, 'CI workflow', ['pnpm verify', 'test-results/phase-04/runtime/', 'if: ${{ !cancelled() }}']],
  [
    deploy,
    'Pages workflow',
    ['Deploy accepted Playgrounds', 'Verify public interactions', 'playwright.pages.config.ts'],
  ],
]) {
  for (const fragment of fragments) {
    if (!source.includes(fragment)) failures.push(`${label}: missing ${fragment}`);
  }
}

const packageImports = [...routeSource.matchAll(/from ['"]([^./][^'"]*)['"]/gu)].map(
  ([, specifier]) => specifier,
);
if (packageImports.some((specifier) => !specifier.startsWith('@kyxos/render-sdk'))) {
  failures.push(`public route: forbidden package import ${packageImports.join(', ')}`);
}
if (!packageJson.includes('check:acceptance:phase-04')) {
  failures.push('package scripts: Phase 4 acceptance schema is not part of verify');
}
if (ci.includes('phase-04-lifecycle-patch') || ci.includes('git apply')) {
  failures.push('CI workflow: source mutation is forbidden');
}

try {
  const accepted = await resolveAcceptedPhases(root);
  requireEqual(accepted.latest, 4, 'deployment candidate latest phase');
  requireEqual(accepted.phases, [0, 1, 2, 3, 4], 'deployment candidate phases');
} catch (error) {
  failures.push(`deployment candidate: ${String(error)}`);
}

if (failures.length > 0) {
  process.stderr.write(`${JSON.stringify({ failures, phase: '04', status: 'FAIL' }, null, 2)}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `${JSON.stringify({ phase: '04', runtimeRecords: 12, status: 'PASS', deployment: 'PENDING' }, null, 2)}\n`,
  );
}
