import { readFile, writeFile } from 'node:fs/promises';

async function editAll(path, replacements) {
  let source = await readFile(path, 'utf8');
  for (const [from, to] of replacements) {
    if (!source.includes(from)) {
      throw new Error(`${path}: expected fragment not found\n--- expected ---\n${from}`);
    }
    source = source.replace(from, to);
  }
  await writeFile(path, source, 'utf8');
}

async function regenerateWgslMirror(sourcePath, outputPath, exportName) {
  const source = await readFile(sourcePath, 'utf8');
  await writeFile(outputPath, `export const ${exportName} = \`${source}\`;\n`, 'utf8');
}

await editAll('shaders/webgpu/phase-04-pbr-temporal-output.wgsl', [
  [
    `  return PbrTemporalFragmentOutput(vec4f(shaded.color.rgb, 1.0), shaded.normal);`,
    `  return PbrTemporalFragmentOutput(\n    vec4f(shaded.color.rgb, 1.0),\n    shaded.normal,\n    pbrTemporalVelocity(input),\n  );`,
  ],
]);

await editAll('shaders/webgpu/phase-04-taa-resolve.wgsl', [
  [
    `  let clippedHistory = taaClipAabb(historyColor.rgb, currentColor.rgb, clipMinimum, clipMaximum);`,
    `  var clippedHistory = clamp(historyColor.rgb, clipMinimum, clipMaximum);\n  if (uniforms.options2.x > 0.0) {\n    clippedHistory = taaClipAabb(historyColor.rgb, currentColor.rgb, clipMinimum, clipMaximum);\n  }`,
  ],
]);

await regenerateWgslMirror(
  'shaders/webgpu/phase-04-pbr-temporal-output.wgsl',
  'packages/renderer/src/generated/phase-04-pbr-temporal-output.wgsl.ts',
  'PHASE_04_PBR_TEMPORAL_OUTPUT_WGSL',
);
await regenerateWgslMirror(
  'shaders/webgpu/phase-04-taa-resolve.wgsl',
  'packages/renderer/src/generated/phase-04-taa-resolve.wgsl.ts',
  'PHASE_04_TAA_RESOLVE_WGSL',
);

await editAll('tests/e2e/phase-04-present.spec.ts', [
  [`      texture: { activeCount: 7 },`, `      texture: { activeCount: 8 },`],
]);

await editAll('tests/e2e/phase-04-temporal.spec.ts', [
  [
    `    const uniforms = new Float32Array(44);\n    uniforms.set(identityMat4(), 0);\n    uniforms.set(identityMat4(), 16);\n    uniforms[32] = width;\n    uniforms[33] = 1;\n    uniforms[34] = 1;\n    uniforms[35] = 0.5;\n    uniforms[36] = TEMPORAL_TAA_DEFAULT_OPTIONS.baseHistoryWeight;\n    uniforms[37] = TEMPORAL_TAA_DEFAULT_OPTIONS.depthAbsoluteThreshold;\n    uniforms[38] = TEMPORAL_TAA_DEFAULT_OPTIONS.depthRelativeThreshold;\n    uniforms[39] = TEMPORAL_TAA_DEFAULT_OPTIONS.normalRejectionCosine;\n    uniforms[40] = TEMPORAL_TAA_DEFAULT_OPTIONS.responsiveHistoryReduction;`,
    `    const uniforms = new Float32Array(84);\n    uniforms.set(identityMat4(), 0);\n    uniforms.set(identityMat4(), 16);\n    uniforms.set(identityMat4(), 32);\n    uniforms.set(identityMat4(), 48);\n    uniforms[64] = width;\n    uniforms[65] = 1;\n    uniforms[66] = 1;\n    uniforms[67] = 0.5;\n    uniforms[72] = TEMPORAL_TAA_DEFAULT_OPTIONS.baseHistoryWeight;\n    uniforms[73] = TEMPORAL_TAA_DEFAULT_OPTIONS.depthAbsoluteThreshold;\n    uniforms[74] = TEMPORAL_TAA_DEFAULT_OPTIONS.depthRelativeThreshold;\n    uniforms[75] = TEMPORAL_TAA_DEFAULT_OPTIONS.normalRejectionCosine;\n    uniforms[76] = TEMPORAL_TAA_DEFAULT_OPTIONS.responsiveHistoryReduction;\n    uniforms[77] = TEMPORAL_TAA_DEFAULT_OPTIONS.edgeDepthDifference;\n    uniforms[78] = TEMPORAL_TAA_DEFAULT_OPTIONS.maxVelocityLength;\n    uniforms[79] = TEMPORAL_TAA_DEFAULT_OPTIONS.minimumCurrentWeight;\n    uniforms[80] = TEMPORAL_TAA_DEFAULT_OPTIONS.varianceClipGamma;\n    uniforms[81] = TEMPORAL_TAA_DEFAULT_OPTIONS.subpixelCorrection;\n    uniforms[82] = TEMPORAL_TAA_DEFAULT_OPTIONS.flickerReduction;`,
  ],
  [
    `        const createDepthTexture = (label: string) =>\n          device.createTexture({`,
    `        const createVelocityTexture = (label: string) =>\n          device.createTexture({\n            format: 'rg16float',\n            label,\n            size: { height: 1, width: viewportWidth },\n            usage: textureUsage.copyDestination | textureUsage.sampled,\n          });\n        const createDepthTexture = (label: string) =>\n          device.createTexture({`,
  ],
  [
    `        const currentDepthTexture = createDepthTexture('P4-07 Current Depth');\n        const currentNormalTexture = createColorTexture(`,
    `        const currentDepthTexture = createDepthTexture('P4-07 Current Depth');\n        const currentNormalTexture = createColorTexture(`,
  ],
  [
    `        const historyColorTexture = createColorTexture(`,
    `        const currentVelocityTexture = createVelocityTexture('P4-07 Current Velocity');\n        const historyColorTexture = createColorTexture(`,
  ],
  [
    `          device.queue.writeTexture(\n            { texture: historyColorTexture },`,
    `          device.queue.writeTexture(\n            { texture: currentVelocityTexture },\n            new Uint16Array(viewportWidth * 2),\n            { bytesPerRow: viewportWidth * 4, rowsPerImage: 1 },\n            extent,\n          );\n          device.queue.writeTexture(\n            { texture: historyColorTexture },`,
  ],
  [
    `              { binding: 4, resource: historyColorTexture.createView() },\n              { binding: 5, resource: historyDepthTexture.createView() },\n              { binding: 6, resource: historyNormalTexture.createView() },\n              { binding: 7, resource: sampler },`,
    `              { binding: 4, resource: currentVelocityTexture.createView() },\n              { binding: 5, resource: historyColorTexture.createView() },\n              { binding: 6, resource: historyDepthTexture.createView() },\n              { binding: 7, resource: historyNormalTexture.createView() },\n              { binding: 8, resource: sampler },`,
  ],
  [
    `          currentNormalTexture.destroy();\n          historyColorTexture.destroy();`,
    `          currentNormalTexture.destroy();\n          currentVelocityTexture.destroy();\n          historyColorTexture.destroy();`,
  ],
  [
    `              struct FragmentOutput {\n                @location(0) color: vec4f,\n                @location(1) normal: vec4f,\n              }`,
    `              struct FragmentOutput {\n                @location(0) color: vec4f,\n                @location(1) normal: vec4f,\n                @location(2) velocity: vec2f,\n              }`,
  ],
  [
    `                output.normal = vec4f(0.5, 0.5, 1.0, 1.0);\n                return output;`,
    `                output.normal = vec4f(0.5, 0.5, 1.0, 1.0);\n                output.velocity = vec2f(0.0);\n                return output;`,
  ],
  [
    `              targets: [{ format: 'rgba16float' }, { format: 'rgba16float' }],`,
    `              targets: [\n                { format: 'rgba16float' },\n                { format: 'rgba16float' },\n                { format: 'rg16float' },\n              ],`,
  ],
  [
    `                  {\n                    clearColor: { a: 1, b: 1, g: 0.5, r: 0.5 },\n                    loadOp: 'clear',\n                    storeOp: 'store',\n                    texture: first.writeNormalTexture,\n                  },\n                ],`,
    `                  {\n                    clearColor: { a: 1, b: 1, g: 0.5, r: 0.5 },\n                    loadOp: 'clear',\n                    storeOp: 'store',\n                    texture: first.writeNormalTexture,\n                  },\n                  {\n                    clearColor: { a: 0, b: 0, g: 0, r: 0 },\n                    loadOp: 'clear',\n                    storeOp: 'store',\n                    texture: first.currentVelocityTexture,\n                  },\n                ],`,
  ],
  [
    `                  {\n                    clearColor: { a: 1, b: 1, g: 0.5, r: 0.5 },\n                    texture: third.writeNormalTexture,\n                  },\n                ],`,
    `                  {\n                    clearColor: { a: 1, b: 1, g: 0.5, r: 0.5 },\n                    texture: third.writeNormalTexture,\n                  },\n                  {\n                    clearColor: { a: 0, b: 0, g: 0, r: 0 },\n                    texture: third.currentVelocityTexture,\n                  },\n                ],`,
  ],
  [`      estimatedGpuBytes: 288,`, `      estimatedGpuBytes: 312,`],
  [`        estimatedGpuBytes: 960,`, `        estimatedGpuBytes: 1040,`],
  [
    `                third.currentColorTexture !== first.currentColorTexture &&\n                third.readColorTexture !== first.readColorTexture`,
    `                third.currentColorTexture !== first.currentColorTexture &&\n                third.currentVelocityTexture !== first.currentVelocityTexture &&\n                third.readColorTexture !== first.readColorTexture`,
  ],
  [
    `      activeCount: 14,\n      byKind: {`,
    `      activeCount: 15,\n      byKind: {`,
  ],
  [
    `        texture: { activeCount: 7, activeEstimatedBytes: 960 },\n      },\n      createdTotal: 27,\n      destroyedTotal: 13,`,
    `        texture: { activeCount: 8, activeEstimatedBytes: 1040 },\n      },\n      createdTotal: 29,\n      destroyedTotal: 14,`,
  ],
  [
    `      activeCount: 10,\n      byKind: {`,
    `      activeCount: 11,\n      byKind: {`,
  ],
  [
    `        texture: { activeCount: 7, activeEstimatedBytes: 960 },\n      },\n      createdTotal: 27,\n      destroyedTotal: 17,`,
    `        texture: { activeCount: 8, activeEstimatedBytes: 1040 },\n      },\n      createdTotal: 29,\n      destroyedTotal: 18,`,
  ],
  [
    `      createdTotal: 27,\n      destroyedTotal: 25,`,
    `      createdTotal: 29,\n      destroyedTotal: 27,`,
  ],
]);
