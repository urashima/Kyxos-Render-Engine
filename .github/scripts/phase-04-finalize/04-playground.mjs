import { readFile, writeFile } from 'node:fs/promises';

const path = 'apps/playground/src/acceptance/phase-04/index.ts';
let source = await readFile(path, 'utf8');
source = source.replace(
  `  | 'depthRelativeThreshold'
  | 'jitterScale'`,
  `  | 'depthRelativeThreshold'
  | 'edgeDepthDifference'
  | 'flickerReduction'
  | 'jitterScale'
  | 'maxVelocityLength'
  | 'minimumCurrentWeight'`,
);
source = source.replace(
  `  | 'responsiveHistoryReduction'
  | 'responsiveMask';`,
  `  | 'responsiveHistoryReduction'
  | 'responsiveMask'
  | 'subpixelCorrection'
  | 'varianceClipGamma';`,
);
source = source.replace(
  `  'depthRelativeThreshold',
  'normalRejectionCosine',`,
  `  'depthRelativeThreshold',
  'edgeDepthDifference',
  'maxVelocityLength',
  'minimumCurrentWeight',
  'varianceClipGamma',
  'subpixelCorrection',
  'flickerReduction',
  'normalRejectionCosine',`,
);
source = source.replace(
  `  depthRelativeThreshold: 3,
  jitterScale: 2,`,
  `  depthRelativeThreshold: 3,
  edgeDepthDifference: 4,
  flickerReduction: 2,
  jitterScale: 2,
  maxVelocityLength: 0,
  minimumCurrentWeight: 2,`,
);
source = source.replace(
  `  responsiveHistoryReduction: 2,
  responsiveMask: 2,`,
  `  responsiveHistoryReduction: 2,
  responsiveMask: 2,
  subpixelCorrection: 2,
  varianceClipGamma: 2,`,
);
source = source.replace(
  `    depthRelativeThreshold: TEMPORAL_TAA_DEFAULT_SETTINGS.resolve.depthRelativeThreshold,
    jitterScale: TEMPORAL_TAA_DEFAULT_SETTINGS.jitterScale,`,
  `    depthRelativeThreshold: TEMPORAL_TAA_DEFAULT_SETTINGS.resolve.depthRelativeThreshold,
    edgeDepthDifference: TEMPORAL_TAA_DEFAULT_SETTINGS.resolve.edgeDepthDifference,
    flickerReduction: TEMPORAL_TAA_DEFAULT_SETTINGS.resolve.flickerReduction,
    jitterScale: TEMPORAL_TAA_DEFAULT_SETTINGS.jitterScale,
    maxVelocityLength: TEMPORAL_TAA_DEFAULT_SETTINGS.resolve.maxVelocityLength,
    minimumCurrentWeight: TEMPORAL_TAA_DEFAULT_SETTINGS.resolve.minimumCurrentWeight,`,
);
source = source.replace(
  `    responsiveHistoryReduction: TEMPORAL_TAA_DEFAULT_SETTINGS.resolve.responsiveHistoryReduction,
    responsiveMask: TEMPORAL_TAA_DEFAULT_SETTINGS.responsiveMask,`,
  `    responsiveHistoryReduction: TEMPORAL_TAA_DEFAULT_SETTINGS.resolve.responsiveHistoryReduction,
    responsiveMask: TEMPORAL_TAA_DEFAULT_SETTINGS.responsiveMask,
    subpixelCorrection: TEMPORAL_TAA_DEFAULT_SETTINGS.resolve.subpixelCorrection,
    varianceClipGamma: TEMPORAL_TAA_DEFAULT_SETTINGS.resolve.varianceClipGamma,`,
);
for (const [preset, values] of [
  [
    `    depthRelativeThreshold: 0.01,
    jitterScale: 0,`,
    `    depthRelativeThreshold: 0.01,
    edgeDepthDifference: 0,
    flickerReduction: 0,
    jitterScale: 0,
    maxVelocityLength: 128,
    minimumCurrentWeight: 0,`,
  ],
  [
    `    responsiveHistoryReduction: 0.8,
    responsiveMask: 0,`,
    `    responsiveHistoryReduction: 0.8,
    responsiveMask: 0,
    subpixelCorrection: 0,
    varianceClipGamma: 0,`,
  ],
  [
    `    depthRelativeThreshold: 0.006,
    jitterScale: 0.65,`,
    `    depthRelativeThreshold: 0.006,
    edgeDepthDifference: 0.001,
    flickerReduction: 0.65,
    jitterScale: 0.65,
    maxVelocityLength: 96,
    minimumCurrentWeight: 0.08,`,
  ],
  [
    `    responsiveHistoryReduction: 0.9,
    responsiveMask: 0.1,`,
    `    responsiveHistoryReduction: 0.9,
    responsiveMask: 0.1,
    subpixelCorrection: 0.85,
    varianceClipGamma: 0.9,`,
  ],
  [
    `    depthRelativeThreshold: 0.02,
    jitterScale: 0.35,`,
    `    depthRelativeThreshold: 0.02,
    edgeDepthDifference: 0.001,
    flickerReduction: 0.8,
    jitterScale: 0.35,
    maxVelocityLength: 128,
    minimumCurrentWeight: 0.05,`,
  ],
  [
    `    responsiveHistoryReduction: 0.75,
    responsiveMask: 0,`,
    `    responsiveHistoryReduction: 0.75,
    responsiveMask: 0,
    subpixelCorrection: 0.65,
    varianceClipGamma: 1.25,`,
  ],
]) {
  source = source.replace(preset, values);
}
source = source.replace(
  `           <label class="taa-control-card">
             <span><b>Responsive Mask</b><output data-taa-output="responsiveMask">0.00</output></span>
             <div><input data-taa-control="responsiveMask" type="range" min="0" max="1" step="0.01" value="0"><input data-taa-control="responsiveMask" type="number" min="0" max="1" step="0.01" value="0"></div>
             <small>Constant test mask: 0 keeps normal History, 1 applies the full responsive reduction.</small>
           </label>`,
  `           <label class="taa-control-card">
             <span><b>Responsive Mask</b><output data-taa-output="responsiveMask">0.00</output></span>
             <div><input data-taa-control="responsiveMask" type="range" min="0" max="1" step="0.01" value="0"><input data-taa-control="responsiveMask" type="number" min="0" max="1" step="0.01" value="0"></div>
             <small>Constant test mask: 0 keeps normal History, 1 applies the full responsive reduction.</small>
           </label>
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
           </label>`,
);
source = source.replace(
  `    depthRelativeThreshold: settings.resolve.depthRelativeThreshold,
    jitterScale: settings.jitterScale,`,
  `    depthRelativeThreshold: settings.resolve.depthRelativeThreshold,
    edgeDepthDifference: settings.resolve.edgeDepthDifference,
    flickerReduction: settings.resolve.flickerReduction,
    jitterScale: settings.jitterScale,
    maxVelocityLength: settings.resolve.maxVelocityLength,
    minimumCurrentWeight: settings.resolve.minimumCurrentWeight,`,
);
source = source.replace(
  `    responsiveHistoryReduction: settings.resolve.responsiveHistoryReduction,
    responsiveMask: settings.responsiveMask,`,
  `    responsiveHistoryReduction: settings.resolve.responsiveHistoryReduction,
    responsiveMask: settings.responsiveMask,
    subpixelCorrection: settings.resolve.subpixelCorrection,
    varianceClipGamma: settings.resolve.varianceClipGamma,`,
);
await writeFile(path, source, 'utf8');

const testPath = 'tests/e2e/phase-04-acceptance.spec.ts';
let test = await readFile(testPath, 'utf8');
test = test.replace(
  `      'depthRelativeThreshold',
      'normalRejectionCosine',`,
  `      'depthRelativeThreshold',
      'edgeDepthDifference',
      'maxVelocityLength',
      'minimumCurrentWeight',
      'varianceClipGamma',
      'subpixelCorrection',
      'flickerReduction',
      'normalRejectionCosine',`,
);
await writeFile(testPath, test, 'utf8');
