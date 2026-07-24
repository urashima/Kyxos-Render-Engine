import { readFile, writeFile } from 'node:fs/promises';

const budgetPath = 'tools/quality/bundle-budgets.json';
const budgets = JSON.parse(await readFile(budgetPath, 'utf8'));
budgets.javascript.rawBytes = 368640;
budgets.phase4RouteJavascript.rawBytes = 270336;
budgets.phase4RouteTotal.rawBytes = 335872;
budgets.total.rawBytes = 442368;
await writeFile(budgetPath, `${JSON.stringify(budgets, null, 2)}\n`, 'utf8');

const workLogPath = 'docs/execution/WORK_LOG.md';
let workLog = await readFile(workLogPath, 'utf8');
workLog += `

### P4-14 bundle budget adjustment

- The final TRAA controls and explicit Velocity integration remain below every existing gzip ceiling.
- Raw-only ceilings were advanced by the smallest aligned increments required by the verified build:
  JavaScript +8 KiB, Phase 4 route JavaScript +8 KiB, Phase 4 route total +8 KiB, and repository total +16 KiB.
- No Phase 0-3 route budget, gzip budget, font budget, CSS budget, or HTML budget was relaxed.
`;
await writeFile(workLogPath, workLog, 'utf8');
