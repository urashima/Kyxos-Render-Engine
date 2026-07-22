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
fs.writeFileSync(path, source);
