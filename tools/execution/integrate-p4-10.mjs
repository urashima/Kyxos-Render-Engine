import { readFile, writeFile } from 'node:fs/promises';

async function replaceOnce(path, before, after) {
  const source = await readFile(path, 'utf8');
  if (source.includes(after)) return;
  if (!source.includes(before)) throw new Error(`${path}: patch anchor not found.`);
  await writeFile(path, source.replace(before, after));
}

await replaceOnce(
  'packages/renderer/src/index.ts',
  "export {\n  StaticAccumulationGpuHistory,\n  type StaticAccumulationGpuFrame,\n  type StaticAccumulationGpuHistoryDiagnostics,\n  type StaticAccumulationGpuHistoryOptions,\n  type StaticAccumulationGpuHistorySize,\n} from './static-accumulation-gpu-history.js';\n",
  "export {\n  StaticAccumulationGpuHistory,\n  type StaticAccumulationGpuFrame,\n  type StaticAccumulationGpuHistoryDiagnostics,\n  type StaticAccumulationGpuHistoryOptions,\n  type StaticAccumulationGpuHistorySize,\n} from './static-accumulation-gpu-history.js';\nexport {\n  STATIC_ACCUMULATION_UNIFORM_LAYOUT,\n  StaticAccumulationPass,\n  packStaticAccumulationUniforms,\n  type StaticAccumulationPassDiagnostics,\n  type StaticAccumulationPassInput,\n  type StaticAccumulationPassOptions,\n} from './static-accumulation-pass.js';\n",
);

await replaceOnce(
  'tools/shader-build/validate-shaders.mjs',
  "  [\n    'webgpu/phase-04-static-accumulation-reference.wgsl',\n    {\n      exportName: 'PHASE_04_STATIC_ACCUMULATION_REFERENCE_WGSL',\n      path: 'packages/temporal/src/generated/phase-04-static-accumulation-reference.wgsl.ts',\n    },\n  ],\n",
  "  [\n    'webgpu/phase-04-static-accumulation-reference.wgsl',\n    {\n      exportName: 'PHASE_04_STATIC_ACCUMULATION_REFERENCE_WGSL',\n      path: 'packages/temporal/src/generated/phase-04-static-accumulation-reference.wgsl.ts',\n    },\n  ],\n  [\n    'webgpu/phase-04-static-accumulation.wgsl',\n    {\n      exportName: 'PHASE_04_STATIC_ACCUMULATION_WGSL',\n      path: 'packages/renderer/src/generated/phase-04-static-accumulation.wgsl.ts',\n    },\n  ],\n",
);

const sdkPath = 'packages/sdk/src/index.ts';
let sdk = await readFile(sdkPath, 'utf8');
const sdkReplacements = [
  [
    "  TEMPORAL_SAMPLE_LIMIT,\n  TEMPORAL_TAA_DEFAULT_OPTIONS,",
    "  STATIC_ACCUMULATION_REFERENCE_CASES,\n  STATIC_ACCUMULATION_REFERENCE_OUTPUT_FIELDS,\n  TEMPORAL_SAMPLE_LIMIT,\n  TEMPORAL_TAA_DEFAULT_OPTIONS,",
  ],
  [
    "  TemporalHistory,\n  createTemporalJitterSample,",
    "  TemporalHistory,\n  accumulateStaticSample,\n  createTemporalJitterSample,",
  ],
  [
    '  evaluateDeterministicTemporalTaaReference,',
    '  evaluateDeterministicStaticAccumulationReference,\n  evaluateDeterministicTemporalTaaReference,',
  ],
  [
    '  type DeterministicTemporalTaaReference,',
    '  type DeterministicStaticAccumulationReference,\n  type DeterministicTemporalTaaReference,',
  ],
  [
    '  type TemporalConvergenceOptions,',
    '  type StaticAccumulationInput,\n  type StaticAccumulationReferenceCase,\n  type StaticAccumulationResult,\n  type StaticAccumulationRgba,\n  type TemporalConvergenceOptions,',
  ],
  [
    "  SceneRenderFeatureOptions,\n} from '@kyxos/render-renderer';",
    "  SceneRenderFeatureOptions,\n  StaticAccumulationGpuFrame,\n  StaticAccumulationGpuHistoryDiagnostics,\n  StaticAccumulationGpuHistoryOptions,\n  StaticAccumulationGpuHistorySize,\n  StaticAccumulationPassDiagnostics,\n  StaticAccumulationPassInput,\n  StaticAccumulationPassOptions,\n} from '@kyxos/render-renderer';",
  ],
  [
    '  DYNAMIC_TAA_RESOLVE_UNIFORM_LAYOUT,\n  PBR_OBJECT_UNIFORM_LAYOUT,',
    '  DYNAMIC_TAA_RESOLVE_UNIFORM_LAYOUT,\n  PBR_OBJECT_UNIFORM_LAYOUT,\n  STATIC_ACCUMULATION_UNIFORM_LAYOUT,',
  ],
  [
    '  SceneRenderFeature,\n  createPbrDirectionalLight,',
    '  SceneRenderFeature,\n  StaticAccumulationGpuHistory,\n  StaticAccumulationPass,\n  createPbrDirectionalLight,',
  ],
  [
    "  packDynamicTaaResolveUniforms,\n} from '@kyxos/render-renderer';",
    "  packDynamicTaaResolveUniforms,\n  packStaticAccumulationUniforms,\n} from '@kyxos/render-renderer';",
  ],
];
for (const [before, after] of sdkReplacements) {
  if (sdk.includes(after)) continue;
  if (!sdk.includes(before)) throw new Error('packages/sdk/src/index.ts: patch anchor not found.');
  sdk = sdk.replace(before, after);
}
await writeFile(sdkPath, sdk);

const consumerPath = 'packages/sdk/test/sdk-only-consumer.test.ts';
let consumer = await readFile(consumerPath, 'utf8');
const consumerReplacements = [
  [
    '  PerspectiveCamera,\n  TemporalCameraMatrixTracker,',
    '  PerspectiveCamera,\n  StaticAccumulationGpuHistory,\n  StaticAccumulationPass,\n  TemporalCameraMatrixTracker,',
  ],
  [
    '  createBackendCapabilityReport,\n  createKyxosRendererFromBackend,',
    '  accumulateStaticSample,\n  createBackendCapabilityReport,\n  createKyxosRendererFromBackend,',
  ],
  [
    '  evaluateDeterministicIblReference,\n  evaluateDeterministicTemporalTaaReference,',
    '  evaluateDeterministicIblReference,\n  evaluateDeterministicStaticAccumulationReference,\n  evaluateDeterministicTemporalTaaReference,',
  ],
];
for (const [before, after] of consumerReplacements) {
  if (consumer.includes(after)) continue;
  if (!consumer.includes(before)) throw new Error('SDK consumer patch anchor not found.');
  consumer = consumer.replace(before, after);
}
const consumerMarker = "  it('evaluates deterministic Camera reprojection from the public SDK', () => {";
if (!consumer.includes('exports deterministic Static Accumulation')) {
  const test = `  it('exports deterministic Static Accumulation through the public SDK', () => {\n    expect(StaticAccumulationGpuHistory).toBeTypeOf('function');\n    expect(StaticAccumulationPass).toBeTypeOf('function');\n    const first = accumulateStaticSample({\n      currentColor: [1, 0.5, 0.25, 1],\n      historyColor: [0, 0, 0, 0],\n      historyValid: false,\n      previousSampleCount: 0,\n    });\n    expect(first.outputColor).toEqual([1, 0.5, 0.25, 1]);\n    expect(evaluateDeterministicStaticAccumulationReference().values).toHaveLength(16);\n  });\n\n`;
  if (!consumer.includes(consumerMarker)) throw new Error('SDK consumer test marker not found.');
  consumer = consumer.replace(consumerMarker, test + consumerMarker);
}
await writeFile(consumerPath, consumer);

const e2ePath = 'tests/e2e/phase-04-static-accumulation.spec.ts';
let e2e = await readFile(e2ePath, 'utf8');
if (!e2e.includes("../../packages/environment/src/index.js")) {
  e2e = e2e.replace(
    "import { expect, test } from '@playwright/test';\n",
    "import { expect, test } from '@playwright/test';\n\nimport { float16BitsToFloat32, float32ToFloat16Bits } from '../../packages/environment/src/index.js';\n",
  );
}
if (!e2e.includes('PHASE_04_STATIC_ACCUMULATION_WGSL')) {
  e2e = e2e.replace(
    "import { PHASE_04_STATIC_ACCUMULATION_REFERENCE_WGSL } from '../../packages/temporal/src/generated/phase-04-static-accumulation-reference.wgsl.js';\n",
    "import { PHASE_04_STATIC_ACCUMULATION_WGSL } from '../../packages/renderer/src/generated/phase-04-static-accumulation.wgsl.js';\nimport { PHASE_04_STATIC_ACCUMULATION_REFERENCE_WGSL } from '../../packages/temporal/src/generated/phase-04-static-accumulation-reference.wgsl.js';\n",
  );
}
if (!e2e.includes('accumulateStaticSample,')) {
  e2e = e2e.replace(
    '  STATIC_ACCUMULATION_REFERENCE_OUTPUT_FIELDS,\n',
    '  STATIC_ACCUMULATION_REFERENCE_OUTPUT_FIELDS,\n  accumulateStaticSample,\n',
  );
}
if (!e2e.includes('const backendModuleUrl')) {
  e2e = e2e.replace(
    'const absoluteTolerance = 0.000001;\n',
    "const absoluteTolerance = 0.000001;\nconst sampledAccumulationTolerance = 0.002;\nconst backendModuleUrl = `/@fs${path.resolve('packages/backend-webgpu/src/index.ts')}`;\nconst rendererModuleUrl = `/@fs${path.resolve('packages/renderer/src/index.ts')}`;\nconst historySignature = {\n  camera: 1,\n  device: 1,\n  environment: 1,\n  geometry: 1,\n  lighting: 1,\n  materials: 1,\n  postProcess: 1,\n  scene: 1,\n  viewport: 1,\n} as const;\n",
  );
}
if (!e2e.includes('executes three native accumulation frames')) {
  const marker = '\n});\n';
  const index = e2e.lastIndexOf(marker);
  if (index < 0) throw new Error('Static accumulation describe terminator not found.');
  const tests = `
  test('executes three native accumulation frames, converges, resets, and releases resources', async ({ page }) => {
    const runtimeErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') runtimeErrors.push(message.text());
    });
    page.on('pageerror', (error) => runtimeErrors.push(error.message));
    await page.goto('/acceptance/phase-01');
    const samples = [
      [1, 0.25, 0, 1],
      [0, 0.5, 1, 1],
      [0.5, 0.75, 0.25, 1],
    ] as const;
    const sampleHalfBits = samples.map((sample) => sample.map(float32ToFloat16Bits));
    const result = await page.evaluate(
      async ({ backendUrl, halfBits, rendererUrl, signature }) => {
        const { createWebGpuBackend } = (await import(/* @vite-ignore */ backendUrl)) as typeof import('../../packages/backend-webgpu/src/index.js');
        const { StaticAccumulationGpuHistory, StaticAccumulationPass } = (await import(/* @vite-ignore */ rendererUrl)) as typeof import('../../packages/renderer/src/index.js');
        const backend = createWebGpuBackend({ label: 'phase-04-static-accumulation-gate' });
        const history = new StaticAccumulationGpuHistory({
          height: 1,
          ownerId: 'phase-04-static-accumulation-gate',
          targetSamples: 3,
          width: 1,
        });
        const pass = new StaticAccumulationPass({ ownerId: 'phase-04-static-accumulation-gate' });
        let current: ReturnType<typeof backend.createTexture> | undefined;
        try {
          await backend.initialize();
          history.initialize(backend);
          await pass.initialize(backend);
          current = backend.createTexture({
            format: 'rgba16float',
            label: 'phase-04-static-current',
            size: { height: 1, width: 1 },
            usage: ['copy-dst', 'sampled'],
          });
          const frames = [];
          for (const bits of halfBits) {
            backend.writeTexture(current, new Uint16Array(bits), {
              bytesPerRow: 8,
              rowsPerImage: 1,
              size: { height: 1, width: 1 },
            });
            const frame = history.prepareFrame(signature);
            const statistics = pass.execute({ currentColorTexture: current, frame });
            const diagnostics = history.commitFrame();
            frames.push({ diagnostics, statistics });
          }
          await backend.waitForIdle();
          let blockedCode: string | null = null;
          try {
            history.prepareFrame(signature);
          } catch (error) {
            blockedCode = (error as { code?: string }).code ?? null;
          }
          const accumulatedTextureId = history.getAccumulatedColorTexture().id;
          const resourcesBeforeReset = backend.getResourceStatistics();
          const reset = history.invalidate('material');
          const resetFrame = history.prepareFrame({ ...signature, materials: 2 });
          const resetFrameSummary = {
            historyValid: resetFrame.historyValid,
            previousSampleCount: resetFrame.previousSampleCount,
          };
          history.cancelFrame();
          pass.dispose();
          history.dispose();
          backend.destroyResource(current);
          current = undefined;
          const resourcesAfterDispose = backend.getResourceStatistics();
          return {
            accumulatedTextureId,
            blockedCode,
            frames,
            reset,
            resetFrameSummary,
            resourcesAfterDispose,
            resourcesBeforeReset,
          };
        } finally {
          if (history.getDiagnostics().frameOpen) history.cancelFrame();
          pass.dispose();
          history.dispose();
          if (current !== undefined) backend.destroyResource(current);
          backend.dispose();
        }
      },
      { backendUrl: backendModuleUrl, halfBits: sampleHalfBits, rendererUrl: rendererModuleUrl, signature: historySignature },
    );
    expect(result.frames.map(({ statistics }) => statistics)).toEqual([
      { drawCalls: 1, instances: 1, triangles: 1, vertices: 3 },
      { drawCalls: 1, instances: 1, triangles: 1, vertices: 3 },
      { drawCalls: 1, instances: 1, triangles: 1, vertices: 3 },
    ]);
    expect(result.frames.at(-1)?.diagnostics).toMatchObject({
      convergence: { converged: true, reason: 'sample-limit', sampleCount: 3 },
      history: { sampleCount: 3, valid: true },
    });
    expect(result.blockedCode).toBe('INVALID_STATE');
    expect(result.resourcesBeforeReset.byKind).toMatchObject({
      'bind-group': { activeCount: 2 },
      buffer: { activeCount: 1 },
      pipeline: { activeCount: 1 },
      sampler: { activeCount: 1 },
      'shader-module': { activeCount: 1 },
      texture: { activeCount: 3 },
    });
    expect(result.reset).toMatchObject({
      convergence: { converged: false, sampleCount: 0 },
      history: { lastInvalidation: 'material', sampleCount: 0, valid: false },
    });
    expect(result.resetFrameSummary).toEqual({ historyValid: false, previousSampleCount: 0 });
    expect(result.resourcesAfterDispose.activeCount).toBe(0);
    expect(runtimeErrors).toEqual([]);
    const runtimeDirectory = path.resolve('test-results/phase-04/runtime');
    await mkdir(runtimeDirectory, { recursive: true });
    await writeFile(
      path.join(runtimeDirectory, 'static-accumulation-lifecycle.json'),
      JSON.stringify({ schemaVersion: 1, phase: '04', checkpoint: 'P4-10-lifecycle', ...result, status: 'PASS' }, null, 2) + '\n',
    );
  });

  test('matches a three-frame linear-HDR running mean through rgba16float readback', async ({ page }) => {
    await page.goto('/acceptance/phase-01');
    const samples = [
      [1, 0.25, 0, 1],
      [0, 0.5, 1, 1],
      [0.5, 0.75, 0.25, 1],
    ] as const;
    let cpu = accumulateStaticSample({
      currentColor: samples[0],
      historyColor: [0, 0, 0, 0],
      historyValid: false,
      previousSampleCount: 0,
    });
    for (const sample of samples.slice(1)) {
      cpu = accumulateStaticSample({
        currentColor: sample,
        historyColor: cpu.outputColor,
        historyValid: true,
        previousSampleCount: cpu.sampleCount,
      });
    }
    const halfBits = samples.map((sample) => sample.map(float32ToFloat16Bits));
    const gpu = await page.evaluate(async ({ inputs, source }) => {
      const adapter = await navigator.gpu?.requestAdapter();
      if (adapter === null || adapter === undefined) throw new Error('WebGPU adapter unavailable.');
      const device = await adapter.requestDevice();
      const module = device.createShaderModule({ code: source, label: 'Phase 4 Static Accumulation runtime' });
      const compilation = await module.getCompilationInfo();
      const errors = compilation.messages.filter((message) => message.type === 'error');
      if (errors.length > 0) throw new Error(JSON.stringify(errors));
      const textureUsage = { copyDestination: 0x0002, copySource: 0x0001, renderAttachment: 0x0010, textureBinding: 0x0004 } as const;
      const bufferUsage = { copyDestination: 0x0008, mapRead: 0x0001, uniform: 0x0040 } as const;
      const current = device.createTexture({
        format: 'rgba16float',
        size: { height: 1, width: 1 },
        usage: textureUsage.copyDestination | textureUsage.textureBinding,
      });
      const histories = [0, 1].map(() => device.createTexture({
        format: 'rgba16float',
        size: { height: 1, width: 1 },
        usage: textureUsage.copySource | textureUsage.renderAttachment | textureUsage.textureBinding,
      }));
      const uniform = device.createBuffer({ size: 16, usage: bufferUsage.copyDestination | bufferUsage.uniform });
      const pipeline = device.createRenderPipeline({
        fragment: { entryPoint: 'fragmentMain', module, targets: [{ format: 'rgba16float' }] },
        layout: 'auto',
        primitive: { topology: 'triangle-list' },
        vertex: { entryPoint: 'vertexMain', module },
      });
      let readIndex = 0;
      for (let index = 0; index < inputs.length; index += 1) {
        device.queue.writeTexture(
          { texture: current },
          new Uint16Array(inputs[index]),
          { bytesPerRow: 8, rowsPerImage: 1 },
          { height: 1, width: 1 },
        );
        const previous = index;
        device.queue.writeBuffer(uniform, 0, new Float32Array([previous / (previous + 1), 1 / (previous + 1), index === 0 ? 0 : 1, previous]));
        const writeIndex = readIndex === 0 ? 1 : 0;
        const bindGroup = device.createBindGroup({
          entries: [
            { binding: 0, resource: { buffer: uniform } },
            { binding: 1, resource: current.createView() },
            { binding: 2, resource: histories[readIndex].createView() },
          ],
          layout: pipeline.getBindGroupLayout(0),
        });
        const encoder = device.createCommandEncoder();
        const renderPass = encoder.beginRenderPass({
          colorAttachments: [{
            clearValue: { a: 0, b: 0, g: 0, r: 0 },
            loadOp: 'clear',
            storeOp: 'store',
            view: histories[writeIndex].createView(),
          }],
        });
        renderPass.setPipeline(pipeline);
        renderPass.setBindGroup(0, bindGroup);
        renderPass.draw(3);
        renderPass.end();
        device.queue.submit([encoder.finish()]);
        readIndex = writeIndex;
      }
      const readback = device.createBuffer({ size: 256, usage: bufferUsage.copyDestination | bufferUsage.mapRead });
      const encoder = device.createCommandEncoder();
      encoder.copyTextureToBuffer(
        { texture: histories[readIndex] },
        { buffer: readback, bytesPerRow: 256, rowsPerImage: 1 },
        { height: 1, width: 1 },
      );
      device.queue.submit([encoder.finish()]);
      await readback.mapAsync(bufferUsage.mapRead);
      const outputHalfBits = Array.from(new Uint16Array(readback.getMappedRange()).slice(0, 4));
      readback.unmap();
      readback.destroy();
      uniform.destroy();
      histories.forEach((texture) => texture.destroy());
      current.destroy();
      device.destroy();
      return {
        compilationMessages: compilation.messages.map((message) => ({ message: message.message, type: message.type })),
        outputHalfBits,
      };
    }, { inputs: halfBits, source: PHASE_04_STATIC_ACCUMULATION_WGSL });
    const output = gpu.outputHalfBits.map(float16BitsToFloat32);
    const expected = Array.from(cpu.outputColor);
    const absoluteDifferences = output.map((value, index) => Math.abs(value - (expected[index] as number)));
    absoluteDifferences.forEach((difference) => expect(difference).toBeLessThanOrEqual(sampledAccumulationTolerance));
    const runtimeDirectory = path.resolve('test-results/phase-04/runtime');
    await mkdir(runtimeDirectory, { recursive: true });
    await writeFile(
      path.join(runtimeDirectory, 'static-accumulation-runtime.json'),
      JSON.stringify({ schemaVersion: 1, phase: '04', checkpoint: 'P4-10-runtime', samples, expected, output, absoluteDifferences, maximumAbsoluteDifference: Math.max(...absoluteDifferences), tolerance: sampledAccumulationTolerance, compilationMessages: gpu.compilationMessages, status: 'PASS' }, null, 2) + '\n',
    );
  });
`;
  e2e = e2e.slice(0, index) + tests + e2e.slice(index);
}
await writeFile(e2ePath, e2e);
