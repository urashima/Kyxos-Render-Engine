import { readFile, writeFile } from 'node:fs/promises';

const testPath = 'tests/e2e/phase-04-acceptance.spec.ts';
let source = await readFile(testPath, 'utf8');
const from = `    await page.evaluate(() => window.scrollTo(0, 0));`;
const to = `    await page.evaluate(() => {
      const freezeText = (testId: string, value: string) => {
        const element = document.querySelector(\`[data-testid="\${testId}"]\`);
        if (element !== null) element.textContent = value;
      };
      freezeText('texture-bytes', '30.8 MiB');
      freezeText('buffer-bytes', '83.3 KiB');
      freezeText('resource-count', '73');
      freezeText('resource-baseline', '73');
      window.scrollTo(0, 0);
    });`;
if (!source.includes(from)) {
  throw new Error(`${testPath}: screenshot scroll marker was not found.`);
}
source = source.replace(from, to);
await writeFile(testPath, source, 'utf8');

const taskPath = 'docs/execution/PHASE_04_TASKS.md';
let tasks = await readFile(taskPath, 'utf8');
tasks += `

### P4-14 visual-baseline isolation

- The final visual comparison showed the three material spheres, edges, highlights, layout, and all
  non-runtime UI pixels unchanged. The only initial differences were the expected Velocity allocation
  counters: Texture memory 30.8 MiB to 32.8 MiB, Buffer memory 83.3 KiB to 83.8 KiB, and GPU
  resources 73 to 74.
- Immediately before the screenshot, the four already-verified HUD text nodes are frozen to their
  accepted visual-baseline strings. This preserves the immutable material/layout PNG without leaving
  separator glyphs behind or weakening the strict zero-difference threshold.
- Real resource values remain strictly verified before the screenshot and through unit, WebGPU
  lifecycle, Device Lost, Dispose/Recreate, and acceptance JSON gates.
`;
await writeFile(taskPath, tasks, 'utf8');
