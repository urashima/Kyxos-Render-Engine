/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');

const path = 'tools/agent/p4-08-apply.mjs';
let source = fs.readFileSync(path, 'utf8');
source = source.replace(
  "'   PbrDirectionalLightDescriptor,\\n   PbrEnvironmentDescriptor,'",
  "'  PbrDirectionalLightDescriptor,\\n  PbrEnvironmentDescriptor,'",
);
source = source.replace(
  "      `${JSON.stringify({ schemaVersion: 1, phase: '04', ...result }, null, 2)}\\\\n`,",
  "      JSON.stringify({ schemaVersion: 1, phase: '04', ...result }, null, 2) + '\\\\n',",
);
const docsPatch = source.indexOf(
  "await update('docs/research/phase-04-temporal-state-contract.md'",
);
if (docsPatch < 0) throw new Error('P4-08 documentation patch anchor not found.');
source = source.slice(0, docsPatch);
fs.writeFileSync(path, source);
