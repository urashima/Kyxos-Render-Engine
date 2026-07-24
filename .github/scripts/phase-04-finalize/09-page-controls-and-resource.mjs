import { readFile, writeFile } from 'node:fs/promises';

const pagePath = 'apps/playground/src/acceptance/phase-04/index.ts';
let page = await readFile(pagePath, 'utf8');
const marker = `          </label>
        </div>
        <div class="taa-live-config">`;
const cards = `          </label>
          <label class="taa-control-card">
            <span><b>Edge Depth Difference</b><output data-taa-output="edgeDepthDifference">0.0000</output></span>
            <div><input data-taa-control="edgeDepthDifference" type="range" min="0" max="0.02" step="0.0001" value="0"><input data-taa-control="edgeDepthDifference" type="number" min="0" max="0.02" step="0.0001" value="0"></div>
            <small>Enables closest-depth Velocity selection when a 3×3 neighborhood crosses an edge.</small>
          </label>
          <label class="taa-control-card">
            <span><b>Max Velocity Length</b><output data-taa-output="maxVelocityLength">128</output></span>
            <div><input data-taa-control="maxVelocityLength" type="range" min="1" max="256" step="1" value="128"><input data-taa-control="maxVelocityLength" type="number" min="1" max="256" step="1" value="128"></div>
            <small>Pixel motion where reprojected History contribution reaches zero.</small>
          </label>
          <label class="taa-control-card">
            <span><b>Minimum Current Weight</b><output data-taa-output="minimumCurrentWeight">0.00</output></span>
            <div><input data-taa-control="minimumCurrentWeight" type="range" min="0" max="1" step="0.01" value="0"><input data-taa-control="minimumCurrentWeight" type="number" min="0" max="1" step="0.01" value="0"></div>
            <small>Guarantees a minimum current-frame response after temporal weighting.</small>
          </label>
          <label class="taa-control-card">
            <span><b>Variance Clip Gamma</b><output data-taa-output="varianceClipGamma">0.00</output></span>
            <div><input data-taa-control="varianceClipGamma" type="range" min="0" max="3" step="0.05" value="0"><input data-taa-control="varianceClipGamma" type="number" min="0" max="3" step="0.05" value="0"></div>
            <small>0 uses accepted min/max clipping; positive values intersect mean ± sigma bounds.</small>
          </label>
          <label class="taa-control-card">
            <span><b>Subpixel Correction</b><output data-taa-output="subpixelCorrection">0.00</output></span>
            <div><input data-taa-control="subpixelCorrection" type="range" min="0" max="1" step="0.01" value="0"><input data-taa-control="subpixelCorrection" type="number" min="0" max="1" step="0.01" value="0"></div>
            <small>Reduces History near fractional-pixel motion to retain moving detail.</small>
          </label>
          <label class="taa-control-card">
            <span><b>Flicker Reduction</b><output data-taa-output="flickerReduction">0.00</output></span>
            <div><input data-taa-control="flickerReduction" type="range" min="0" max="1" step="0.01" value="0"><input data-taa-control="flickerReduction" type="number" min="0" max="1" step="0.01" value="0"></div>
            <small>Luminance-weights HDR History to suppress unstable highlights.</small>
          </label>
        </div>
        <div class="taa-live-config">`;
if (!page.includes(marker)) {
  throw new Error(`${pagePath}: final TAA grid marker was not found.`);
}
page = page.replace(marker, cards);
await writeFile(pagePath, page, 'utf8');

const temporalPath = 'tests/e2e/phase-04-temporal.spec.ts';
let temporal = await readFile(temporalPath, 'utf8');
const count = `      texture: { activeCount: 13 },`;
if (!temporal.includes(count)) {
  throw new Error(`${temporalPath}: PBR temporal texture expectation was not found.`);
}
temporal = temporal.replace(count, `      texture: { activeCount: 14 },`);
await writeFile(temporalPath, temporal, 'utf8');
