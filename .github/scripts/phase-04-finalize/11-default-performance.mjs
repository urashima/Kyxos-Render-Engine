import { readFile, writeFile } from 'node:fs/promises';

const shaderPath = 'shaders/webgpu/phase-04-taa-resolve.wgsl';
let shader = await readFile(shaderPath, 'utf8');
const from = `  let depthNeighborhood = taaDepthNeighborhood(pixel, dimensions);
  let edgeEnabled = uniforms.options1.y > 0.0;
  let edge = edgeEnabled && depthNeighborhood.farthestDepth - depthNeighborhood.closestDepth > uniforms.options1.y;
  let velocityPixel = select(pixel, depthNeighborhood.closestPixel, edge);`;
const to = `  var velocityPixel = pixel;
  if (uniforms.options1.y > 0.0) {
    let depthNeighborhood = taaDepthNeighborhood(pixel, dimensions);
    if (depthNeighborhood.farthestDepth - depthNeighborhood.closestDepth > uniforms.options1.y) {
      velocityPixel = depthNeighborhood.closestPixel;
    }
  }`;
if (!shader.includes(from)) {
  throw new Error(`${shaderPath}: unconditional edge-depth neighborhood block was not found.`);
}
shader = shader.replace(from, to);
await writeFile(shaderPath, shader, 'utf8');
await writeFile(
  'packages/renderer/src/generated/phase-04-taa-resolve.wgsl.ts',
  `export const PHASE_04_TAA_RESOLVE_WGSL = \`${shader}\`;\n`,
  'utf8',
);

const taskPath = 'docs/execution/PHASE_04_TASKS.md';
let tasks = await readFile(taskPath, 'utf8');
tasks += `

### P4-14 default Resolve performance

- Closest-depth Velocity selection remains available through Edge Depth Difference.
- When the public parameter is 0, its documented disabled state now bypasses the 3×3 depth-neighborhood search entirely instead of paying nine unnecessary depth loads per pixel.
- The enabled path, output contract, Velocity target, History ownership, and public tuning range are unchanged.
`;
await writeFile(taskPath, tasks, 'utf8');
