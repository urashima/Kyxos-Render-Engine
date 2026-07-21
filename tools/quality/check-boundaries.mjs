import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const packagesDirectory = path.join(root, 'packages');
const appsDirectory = path.join(root, 'apps');
const fixturePath = path.join(root, 'tools/quality/fixtures/forbidden-renderer-import.fixture.ts');

const allowedDependencies = new Map([
  ['@kyxos/render-core', new Set()],
  ['@kyxos/render-backend-api', new Set(['@kyxos/render-core'])],
  ['@kyxos/render-backend-webgpu', new Set(['@kyxos/render-backend-api', '@kyxos/render-core'])],
  ['@kyxos/render-frame-scheduler', new Set(['@kyxos/render-core'])],
  [
    '@kyxos/render-renderer',
    new Set(['@kyxos/render-backend-api', '@kyxos/render-core', '@kyxos/render-frame-scheduler']),
  ],
  [
    '@kyxos/render-sdk',
    new Set([
      '@kyxos/render-backend-api',
      '@kyxos/render-backend-webgpu',
      '@kyxos/render-core',
      '@kyxos/render-frame-scheduler',
      '@kyxos/render-renderer',
    ]),
  ],
  [
    '@kyxos/render-testing',
    new Set(['@kyxos/render-backend-api', '@kyxos/render-core', '@kyxos/render-frame-scheduler']),
  ],
  ['@kyxos/render-playground', new Set(['@kyxos/render-sdk', '@kyxos/render-testing'])],
]);

const forbiddenFrameworks = new Set(['next', 'react', 'react-dom', 'zustand']);
const importPattern =
  /(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/gu;

async function workspaceEntries(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const packageRoot = path.join(directory, entry.name);
    const manifest = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
    result.push({ name: manifest.name, root: packageRoot, manifest });
  }
  return result;
}

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await sourceFiles(entryPath)));
    else if (entry.isFile() && /\.(?:cts|mts|ts)$/u.test(entry.name)) result.push(entryPath);
  }
  return result;
}

function importsFrom(source) {
  const imports = [];
  for (const match of source.matchAll(importPattern)) {
    imports.push(match[1] ?? match[2]);
  }
  return imports;
}

function workspaceTarget(specifier, entries) {
  return entries.find(({ name }) => specifier === name || specifier.startsWith(`${name}/`));
}

function validateImport({ entries, filePath, owner, specifier }) {
  const violations = [];
  const target = workspaceTarget(specifier, entries);
  if (target !== undefined) {
    if (specifier !== target.name) {
      violations.push({ code: 'PRIVATE_SUBPATH', filePath, owner, specifier });
    }
    if (target.name !== owner && !allowedDependencies.get(owner)?.has(target.name)) {
      violations.push({ code: 'LAYER_VIOLATION', filePath, owner, specifier });
    }
    return violations;
  }

  if (specifier.startsWith('.')) {
    const resolved = path.resolve(path.dirname(filePath), specifier);
    const crossed = entries.find(
      (entry) => entry.name !== owner && resolved.startsWith(`${entry.root}${path.sep}`),
    );
    if (crossed !== undefined) {
      violations.push({ code: 'CROSS_PACKAGE_RELATIVE_IMPORT', filePath, owner, specifier });
    }
  }

  const externalRoot = specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : specifier.split('/')[0];
  if (forbiddenFrameworks.has(externalRoot) || specifier.includes('texture-lab')) {
    violations.push({ code: 'FORBIDDEN_PRODUCT_OR_UI_DEPENDENCY', filePath, owner, specifier });
  }
  return violations;
}

function cycleViolations(graph) {
  const violations = [];
  const visiting = new Set();
  const visited = new Set();

  function visit(node, trail) {
    if (visiting.has(node)) {
      const start = trail.indexOf(node);
      violations.push({ code: 'DEPENDENCY_CYCLE', cycle: [...trail.slice(start), node] });
      return;
    }
    if (visited.has(node)) return;

    visiting.add(node);
    for (const target of graph.get(node) ?? []) visit(target, [...trail, node]);
    visiting.delete(node);
    visited.add(node);
  }

  for (const node of graph.keys()) visit(node, []);
  return violations;
}

const entries = [
  ...(await workspaceEntries(packagesDirectory)),
  ...(await workspaceEntries(appsDirectory)),
];

if (process.argv.includes('--verify-fixture')) {
  const source = await readFile(fixturePath, 'utf8');
  const owner = source.match(/@boundary-owner\s+(\S+)/u)?.[1];
  const violations = importsFrom(source).flatMap((specifier) =>
    validateImport({ entries, filePath: fixturePath, owner, specifier }),
  );
  if (!violations.some(({ code }) => code === 'LAYER_VIOLATION')) {
    process.stderr.write('FAIL: deliberate renderer-to-SDK fixture was not rejected.\n');
    process.exitCode = 1;
  } else {
    process.stdout.write('PASS: deliberate renderer-to-SDK fixture rejected.\n');
  }
} else {
  const violations = [];
  const graph = new Map(entries.map(({ name }) => [name, new Set()]));

  for (const entry of entries) {
    const sourceRoot = path.join(entry.root, 'src');
    for (const filePath of await sourceFiles(sourceRoot)) {
      const source = await readFile(filePath, 'utf8');
      for (const specifier of importsFrom(source)) {
        const target = workspaceTarget(specifier, entries);
        if (target !== undefined && target.name !== entry.name)
          graph.get(entry.name).add(target.name);
        violations.push(...validateImport({ entries, filePath, owner: entry.name, specifier }));
      }
    }

    for (const dependency of Object.keys(entry.manifest.dependencies ?? {})) {
      const target = entries.find(({ name }) => name === dependency);
      if (target === undefined) continue;
      graph.get(entry.name).add(target.name);
      if (!allowedDependencies.get(entry.name)?.has(target.name)) {
        violations.push({
          code: 'MANIFEST_LAYER_VIOLATION',
          filePath: path.join(entry.root, 'package.json'),
          owner: entry.name,
          specifier: target.name,
        });
      }
    }
  }

  violations.push(...cycleViolations(graph));
  if (violations.length > 0) {
    process.stderr.write(`${JSON.stringify({ status: 'FAIL', violations }, null, 2)}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(
      `${JSON.stringify({ edges: Object.fromEntries([...graph].map(([name, targets]) => [name, [...targets].sort()])), status: 'PASS' }, null, 2)}\n`,
    );
  }
}
