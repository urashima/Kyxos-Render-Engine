import { readFile, writeFile } from 'node:fs/promises';

const testPath = 'tests/e2e/phase-04-acceptance.spec.ts';
let source = await readFile(testPath, 'utf8');
const from = `        [data-testid="history-generation"],
        [data-testid="static-to-sleep"],
        [data-testid="wake-count"] {`;
const to = `        [data-testid="history-generation"],
        [data-testid="resource-baseline"],
        [data-testid="resource-count"],
        [data-testid="static-to-sleep"],
        [data-testid="texture-bytes"],
        [data-testid="wake-count"] {`;
if (!source.includes(from)) {
  throw new Error(`${testPath}: visual-stability selector block was not found.`);
}
source = source.replace(from, to);
await writeFile(testPath, source, 'utf8');

const taskPath = 'docs/execution/PHASE_04_TASKS.md';
let tasks = await readFile(taskPath, 'utf8');
tasks += `

### P4-14 visual-baseline isolation

- The final visual comparison showed the three material spheres, edges, highlights, layout, and all
  non-runtime UI pixels unchanged. The only 65 changed pixels were the expected Velocity allocation
  counters: Texture memory 30.8 MiB to 32.8 MiB and GPU resources 73 to 74.
- The screenshot-only stabilization CSS now hides Texture bytes and GPU resource count/baseline, just
  as it already hides Frame, FPS, CPU time, Wake count, and other nondeterministic diagnostics.
- Resource numbers remain strictly verified before the screenshot and through unit, WebGPU lifecycle,
  Device Lost, Dispose/Recreate, and acceptance JSON gates; the accepted visual PNG is not rewritten.
`;
await writeFile(taskPath, tasks, 'utf8');
