import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const distDirectory = path.join(root, 'apps/playground/dist');
const budgetPath = path.join(root, 'tools/quality/bundle-budgets.json');

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
  if (filePath.endsWith('.js')) return 'javascript';
  if (filePath.endsWith('.css')) return 'css';
  if (filePath.endsWith('.html')) return 'html';
  return undefined;
}

const budgets = JSON.parse(await readFile(budgetPath, 'utf8'));
const files = await collectFiles(distDirectory);
const metrics = {
  css: { gzipBytes: 0, rawBytes: 0 },
  html: { gzipBytes: 0, rawBytes: 0 },
  javascript: { gzipBytes: 0, rawBytes: 0 },
  total: { gzipBytes: 0, rawBytes: 0 },
};

for (const filePath of files) {
  const category = categoryFor(filePath);
  if (category === undefined) continue;
  const content = await readFile(filePath);
  const rawBytes = (await stat(filePath)).size;
  const gzipBytes = gzipSync(content).byteLength;
  metrics[category].rawBytes += rawBytes;
  metrics[category].gzipBytes += gzipBytes;
  metrics.total.rawBytes += rawBytes;
  metrics.total.gzipBytes += gzipBytes;
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
