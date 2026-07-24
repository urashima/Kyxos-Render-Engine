import { readFile, writeFile } from 'node:fs/promises';

async function replace(path, from, to) {
  const source = await readFile(path, 'utf8');
  if (!source.includes(from)) {
    throw new Error(`${path}: expected fragment was not found\n--- expected ---\n${from}`);
  }
  await writeFile(path, source.replace(from, to), 'utf8');
}

async function writeMirror(shaderPath, generatedPath, exportName) {
  const shader = await readFile(shaderPath, 'utf8');
  await writeFile(generatedPath, `export const ${exportName} = \`${shader}\`;\n`, 'utf8');
}

await replace(
  'shaders/webgpu/phase-04-pbr-temporal-output.wgsl',
  `  return PbrTemporalFragmentOutput(vec4f(shaded.color.rgb, 1.0), shaded.normal);`,
  `  return PbrTemporalFragmentOutput(
    vec4f(shaded.color.rgb, 1.0),
    shaded.normal,
    pbrTemporalVelocity(input),
  );`,
);
await writeMirror(
  'shaders/webgpu/phase-04-pbr-temporal-output.wgsl',
  'packages/renderer/src/generated/phase-04-pbr-temporal-output.wgsl.ts',
  'PHASE_04_PBR_TEMPORAL_OUTPUT_WGSL',
);

await replace(
  'shaders/webgpu/phase-04-taa-resolve.wgsl',
  `  var clipMinimum = neighborhood.minimum;
  var clipMaximum = neighborhood.maximum;
  if (uniforms.options2.x > 0.0) {
    clipMinimum = max(clipMinimum, neighborhood.mean - neighborhood.deviation * uniforms.options2.x);
    clipMaximum = min(clipMaximum, neighborhood.mean + neighborhood.deviation * uniforms.options2.x);
  }
  let clippedHistory = taaClipAabb(historyColor.rgb, currentColor.rgb, clipMinimum, clipMaximum);
  let responsiveMask = uniforms.viewportHistoryResponsive.w;
  var historyWeight = uniforms.options0.x * (1.0 - responsiveMask * uniforms.options1.x);
  let velocityLength = length(reprojection.velocityPixels);
  historyWeight *= 1.0 - clamp(velocityLength / max(uniforms.options1.z, TAA_EPSILON), 0.0, 1.0);`,
  `  var clippedHistory = clamp(historyColor.rgb, neighborhood.minimum, neighborhood.maximum);
  if (uniforms.options2.x > 0.0) {
    let clipMinimum = max(
      neighborhood.minimum,
      neighborhood.mean - neighborhood.deviation * uniforms.options2.x,
    );
    let clipMaximum = min(
      neighborhood.maximum,
      neighborhood.mean + neighborhood.deviation * uniforms.options2.x,
    );
    clippedHistory = taaClipAabb(historyColor.rgb, currentColor.rgb, clipMinimum, clipMaximum);
  }
  let responsiveMask = uniforms.viewportHistoryResponsive.w;
  var historyWeight = uniforms.options0.x * (1.0 - responsiveMask * uniforms.options1.x);
  let advancedWeightingEnabled =
    uniforms.options1.y > 0.0 ||
    uniforms.options1.w > 0.0 ||
    uniforms.options2.x > 0.0 ||
    uniforms.options2.y > 0.0 ||
    uniforms.options2.z > 0.0;
  let velocityLength = length(reprojection.velocityPixels);
  if (advancedWeightingEnabled) {
    historyWeight *=
      1.0 - clamp(velocityLength / max(uniforms.options1.z, TAA_EPSILON), 0.0, 1.0);
  }`,
);
await writeMirror(
  'shaders/webgpu/phase-04-taa-resolve.wgsl',
  'packages/renderer/src/generated/phase-04-taa-resolve.wgsl.ts',
  'PHASE_04_TAA_RESOLVE_WGSL',
);

await replace(
  'tests/e2e/phase-04-present.spec.ts',
  `      texture: { activeCount: 7 },`,
  `      texture: { activeCount: 8 },`,
);

const temporalPath = 'tests/e2e/phase-04-temporal.spec.ts';
let temporal = await readFile(temporalPath, 'utf8');
const replacements = [
  [
    `    const uniforms = new Float32Array(44);
    uniforms.set(identityMat4(), 0);
    uniforms.set(identityMat4(), 16);
    uniforms[32] = width;
    uniforms[33] = 1;
    uniforms[34] = 1;
    uniforms[35] = 0.5;
    uniforms[36] = TEMPORAL_TAA_DEFAULT_OPTIONS.baseHistoryWeight;
    uniforms[37] = TEMPORAL_TAA_DEFAULT_OPTIONS.depthAbsoluteThreshold;
    uniforms[38] = TEMPORAL_TAA_DEFAULT_OPTIONS.depthRelativeThreshold;
    uniforms[39] = TEMPORAL_TAA_DEFAULT_OPTIONS.normalRejectionCosine;
    uniforms[40] = TEMPORAL_TAA_DEFAULT_OPTIONS.responsiveHistoryReduction;`,
    `    const uniforms = new Float32Array(84);
    uniforms.set(identityMat4(), 0);
    uniforms.set(identityMat4(), 16);
    uniforms.set(identityMat4(), 32);
    uniforms.set(identityMat4(), 48);
    uniforms[64] = width;
    uniforms[65] = 1;
    uniforms[66] = 1;
    uniforms[67] = 0.5;
    uniforms[72] = TEMPORAL_TAA_DEFAULT_OPTIONS.baseHistoryWeight;
    uniforms[73] = TEMPORAL_TAA_DEFAULT_OPTIONS.depthAbsoluteThreshold;
    uniforms[74] = TEMPORAL_TAA_DEFAULT_OPTIONS.depthRelativeThreshold;
    uniforms[75] = TEMPORAL_TAA_DEFAULT_OPTIONS.normalRejectionCosine;
    uniforms[76] = TEMPORAL_TAA_DEFAULT_OPTIONS.responsiveHistoryReduction;
    uniforms[78] = 128;`,
  ],
  [
    `        const currentNormalTexture = createColorTexture(
          'P4-07 Current Normal',
          textureUsage.copyDestination | textureUsage.sampled,
        );
        const historyColorTexture = createColorTexture(`,
    `        const currentNormalTexture = createColorTexture(
          'P4-07 Current Normal',
          textureUsage.copyDestination | textureUsage.sampled,
        );
        const currentVelocityTexture = device.createTexture({
          format: 'rg16float',
          label: 'P4-07 Current Velocity',
          size: { height: 1, width: viewportWidth },
          usage: textureUsage.copyDestination | textureUsage.sampled,
        });
        const historyColorTexture = createColorTexture(`,
  ],
  [
    `          device.queue.writeTexture(
            { texture: historyColorTexture },`,
    `          device.queue.writeTexture(
            { texture: currentVelocityTexture },
            new Uint16Array(viewportWidth * 2),
            { bytesPerRow: viewportWidth * 4, rowsPerImage: 1 },
            extent,
          );
          device.queue.writeTexture(
            { texture: historyColorTexture },`,
  ],
  [
    `              { binding: 3, resource: currentNormalTexture.createView() },
              { binding: 4, resource: historyColorTexture.createView() },
              { binding: 5, resource: historyDepthTexture.createView() },
              { binding: 6, resource: historyNormalTexture.createView() },
              { binding: 7, resource: sampler },`,
    `              { binding: 3, resource: currentNormalTexture.createView() },
              { binding: 4, resource: currentVelocityTexture.createView() },
              { binding: 5, resource: historyColorTexture.createView() },
              { binding: 6, resource: historyDepthTexture.createView() },
              { binding: 7, resource: historyNormalTexture.createView() },
              { binding: 8, resource: sampler },`,
  ],
  [
    `          currentNormalTexture.destroy();
          historyColorTexture.destroy();`,
    `          currentNormalTexture.destroy();
          currentVelocityTexture.destroy();
          historyColorTexture.destroy();`,
  ],
  [
    `              struct FragmentOutput {
                @location(0) color: vec4f,
                @location(1) normal: vec4f,
              }`,
    `              struct FragmentOutput {
                @location(0) color: vec4f,
                @location(1) normal: vec4f,
                @location(2) velocity: vec2f,
              }`,
  ],
  [
    `                output.normal = vec4f(0.5, 0.5, 1.0, 1.0);
                return output;`,
    `                output.normal = vec4f(0.5, 0.5, 1.0, 1.0);
                output.velocity = vec2f(0.0);
                return output;`,
  ],
  [
    `              targets: [{ format: 'rgba16float' }, { format: 'rgba16float' }],`,
    `              targets: [
                { format: 'rgba16float' },
                { format: 'rgba16float' },
                { format: 'rg16float' },
              ],`,
  ],
  [
    `                  {
                    clearColor: { a: 1, b: 1, g: 0.5, r: 0.5 },
                    loadOp: 'clear',
                    storeOp: 'store',
                    texture: first.writeNormalTexture,
                  },
                ],`,
    `                  {
                    clearColor: { a: 1, b: 1, g: 0.5, r: 0.5 },
                    loadOp: 'clear',
                    storeOp: 'store',
                    texture: first.writeNormalTexture,
                  },
                  {
                    clearColor: { a: 0, b: 0, g: 0, r: 0 },
                    loadOp: 'clear',
                    storeOp: 'store',
                    texture: first.currentVelocityTexture,
                  },
                ],`,
  ],
  [
    `                  {
                    clearColor: { a: 1, b: 1, g: 0.5, r: 0.5 },
                    texture: third.writeNormalTexture,
                  },
                ],`,
    `                  {
                    clearColor: { a: 1, b: 1, g: 0.5, r: 0.5 },
                    texture: third.writeNormalTexture,
                  },
                  {
                    clearColor: { a: 0, b: 0, g: 0, r: 0 },
                    texture: third.currentVelocityTexture,
                  },
                ],`,
  ],
  [
    `              currentStable: second.currentColorTexture === first.currentColorTexture,`,
    `              currentStable:
                second.currentColorTexture === first.currentColorTexture &&
                second.currentVelocityTexture === first.currentVelocityTexture,`,
  ],
  [
    `                third.currentColorTexture !== first.currentColorTexture &&
                third.readColorTexture !== first.readColorTexture &&`,
    `                third.currentColorTexture !== first.currentColorTexture &&
                third.currentVelocityTexture !== first.currentVelocityTexture &&
                third.readColorTexture !== first.readColorTexture &&`,
  ],
  [`      estimatedGpuBytes: 288,`, `      estimatedGpuBytes: 312,`],
  [`        estimatedGpuBytes: 960,`, `        estimatedGpuBytes: 1040,`],
  [
    `      activeCount: 14,
      byKind: {
        'bind-group': { activeCount: 1 },
        buffer: { activeCount: 1 },
        pipeline: { activeCount: 2 },
        sampler: { activeCount: 1 },
        'shader-module': { activeCount: 2 },
        texture: { activeCount: 7, activeEstimatedBytes: 960 },
      },
      createdTotal: 27,
      destroyedTotal: 13,`,
    `      activeCount: 15,
      byKind: {
        'bind-group': { activeCount: 1 },
        buffer: { activeCount: 1 },
        pipeline: { activeCount: 2 },
        sampler: { activeCount: 1 },
        'shader-module': { activeCount: 2 },
        texture: { activeCount: 8, activeEstimatedBytes: 1040 },
      },
      createdTotal: 29,
      destroyedTotal: 14,`,
  ],
  [
    `      activeCount: 10,
      byKind: {
        pipeline: { activeCount: 1 },
        sampler: { activeCount: 1 },
        'shader-module': { activeCount: 1 },
        texture: { activeCount: 7, activeEstimatedBytes: 960 },
      },
      createdTotal: 27,
      destroyedTotal: 17,`,
    `      activeCount: 11,
      byKind: {
        pipeline: { activeCount: 1 },
        sampler: { activeCount: 1 },
        'shader-module': { activeCount: 1 },
        texture: { activeCount: 8, activeEstimatedBytes: 1040 },
      },
      createdTotal: 29,
      destroyedTotal: 18,`,
  ],
  [
    `      createdTotal: 27,
      destroyedTotal: 25,`,
    `      createdTotal: 29,
      destroyedTotal: 27,`,
  ],
];
for (const [from, to] of replacements) {
  if (!temporal.includes(from)) {
    throw new Error(`${temporalPath}: expected fragment was not found\n--- expected ---\n${from}`);
  }
  temporal = temporal.replace(from, to);
}
await writeFile(temporalPath, temporal, 'utf8');
