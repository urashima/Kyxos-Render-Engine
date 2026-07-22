import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const distDirectory = path.join(root, 'apps/playground/dist');
const budgetPath = path.join(root, 'tools/quality/bundle-budgets.json');
const manifestPath = path.join(distDirectory, '.vite/manifest.json');

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(absolutePath)));
    } else if (entry.isFile()) {
      files.push(absolutePath);
    }
  }
  return files;
}

function categoryFor(filePath) {
  if (filePath.endsWith('.woff2')) return 'font';
  if (filePath.endsWith('.js')) return 'javascript';
  if (filePath.endsWith('.css')) return 'css';
  if (filePath.endsWith('.html')) return 'html';
  return undefined;
}

const budgets = JSON.parse(await readFile(budgetPath, 'utf8'));
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const files = await collectFiles(distDirectory);
const metrics = {
  css: { gzipBytes: 0, rawBytes: 0 },
  font: { gzipBytes: 0, rawBytes: 0 },
  html: { gzipBytes: 0, rawBytes: 0 },
  javascript: { gzipBytes: 0, rawBytes: 0 },
  phase0InitialJavascript: { gzipBytes: 0, rawBytes: 0 },
  phase0InitialTotal: { gzipBytes: 0, rawBytes: 0 },
  phase1RouteJavascript: { gzipBytes: 0, rawBytes: 0 },
  phase1RouteTotal: { gzipBytes: 0, rawBytes: 0 },
  phase2RouteJavascript: { gzipBytes: 0, rawBytes: 0 },
  phase2RouteTotal: { gzipBytes: 0, rawBytes: 0 },
  phase3RouteJavascript: { gzipBytes: 0, rawBytes: 0 },
  phase3RouteTotal: { gzipBytes: 0, rawBytes: 0 },
  total: { gzipBytes: 0, rawBytes: 0 },
};

function manifestClosure(key, inheritedFiles = new Set(['index.html'])) {
  const files = new Set(inheritedFiles);
  const visited = new Set();
  function addEntry(entryKey) {
    if (visited.has(entryKey)) return;
    visited.add(entryKey);
    const entry = manifest[entryKey];
    if (entry === undefined) throw new Error(`Vite manifest entry is missing: ${entryKey}`);
    files.add(entry.file);
    for (const file of entry.css ?? []) files.add(file);
    for (const file of entry.assets ?? []) files.add(file);
    for (const imported of entry.imports ?? []) addEntry(imported);
  }
  addEntry(key);
  return files;
}

const initialShellFiles = manifestClosure('index.html');
const phase0InitialFiles = manifestClosure('src/acceptance/phase-00/index.ts', initialShellFiles);
function routeClosure(key) {
  return manifestClosure(key, initialShellFiles);
}
const phase1RouteFiles = routeClosure('src/acceptance/phase-01/index.ts');
const phase2RouteFiles = routeClosure('src/acceptance/phase-02/index.ts');
const phase3RouteFiles = routeClosure('src/acceptance/phase-03/index.ts');

function addMeasurement(measurement, rawBytes, gzipBytes) {
  measurement.rawBytes += rawBytes;
  measurement.gzipBytes += gzipBytes;
}

function addRouteMeasurement(fileSet, javascriptMeasurement, totalMeasurement, values) {
  if (!fileSet.has(values.relativePath)) return;
  addMeasurement(totalMeasurement, values.rawBytes, values.gzipBytes);
  if (values.category === 'javascript') {
    addMeasurement(javascriptMeasurement, values.rawBytes, values.gzipBytes);
  }
}

/*
 * Dynamic imports are deliberately excluded from the entry closure. Each route
 * adds exactly one selected dynamic entry and its static dependencies so a new
 * acceptance phase cannot hide regressions in an already accepted route.
 */
function assertDynamicRoute(key) {
  const entry = manifest[key];
  if (entry === undefined) throw new Error(`Vite manifest entry is missing: ${key}`);
  if (entry.isDynamicEntry !== true) {
    throw new Error(`Acceptance route must remain a lazy dynamic entry: ${key}`);
  }
}
assertDynamicRoute('src/acceptance/phase-01/index.ts');
assertDynamicRoute('src/acceptance/phase-02/index.ts');
assertDynamicRoute('src/acceptance/phase-03/index.ts');
assertDynamicRoute('src/acceptance/phase-00/index.ts');

for (const filePath of files) {
  const category = categoryFor(filePath);
  if (category === undefined) continue;
  const content = await readFile(filePath);
  const rawBytes = (await stat(filePath)).size;
  const gzipBytes = gzipSync(content).byteLength;
  addMeasurement(metrics[category], rawBytes, gzipBytes);
  addMeasurement(metrics.total, rawBytes, gzipBytes);
  const relativePath = path.relative(distDirectory, filePath).split(path.sep).join('/');
  if (phase0InitialFiles.has(relativePath)) {
    addMeasurement(metrics.phase0InitialTotal, rawBytes, gzipBytes);
    if (category === 'javascript') {
      addMeasurement(metrics.phase0InitialJavascript, rawBytes, gzipBytes);
    }
  }
  const values = { category, gzipBytes, rawBytes, relativePath };
  addRouteMeasurement(
    phase1RouteFiles,
    metrics.phase1RouteJavascript,
    metrics.phase1RouteTotal,
    values,
  );
  addRouteMeasurement(
    phase2RouteFiles,
    metrics.phase2RouteJavascript,
    metrics.phase2RouteTotal,
    values,
  );
  addRouteMeasurement(
    phase3RouteFiles,
    metrics.phase3RouteJavascript,
    metrics.phase3RouteTotal,
    values,
  );
}

const failures = [];
for (const [category, measurements] of Object.entries(metrics)) {
  for (const [metric, value] of Object.entries(measurements)) {
    const budget = budgets[category][metric];
    if (value > budget) {
      failures.push(`${category}.${metric}: ${value} > ${budget}`);
    }
  }
}

process.stdout.write(
  `${JSON.stringify({ budgets, metrics, status: failures.length === 0 ? 'PASS' : 'FAIL' }, null, 2)}\n`,
);
if (failures.length > 0) {
  process.stderr.write(`Bundle budget failures:\n${failures.join('\n')}\n`);
  process.exitCode = 1;
}
