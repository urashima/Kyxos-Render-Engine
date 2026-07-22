import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { PHASE_04_CAMERA_REPROJECTION_REFERENCE_WGSL } from '../../packages/camera/src/generated/phase-04-camera-reprojection-reference.wgsl.js';
import {
  CAMERA_REPROJECTION_REFERENCE_CASES,
  CAMERA_REPROJECTION_REFERENCE_OUTPUT_FIELDS,
  evaluateDeterministicCameraReprojectionReference,
} from '../../packages/camera/src/index.js';
import { PHASE_04_TAA_REFERENCE_WGSL } from '../../packages/temporal/src/generated/phase-04-taa-reference.wgsl.js';
import {
  TEMPORAL_TAA_DEFAULT_OPTIONS,
  TEMPORAL_TAA_REFERENCE_CASES,
  TEMPORAL_TAA_REFERENCE_OUTPUT_FIELDS,
  evaluateDeterministicTemporalTaaReference,
} from '../../packages/temporal/src/index.js';

const absoluteTolerance = 0.000001;
const cameraReprojectionAbsoluteTolerance = 0.00001;
const backendModuleUrl = `/@fs${path.resolve('packages/backend-webgpu/src/index.ts')}`;
const rendererModuleUrl = `/@fs${path.resolve('packages/renderer/src/index.ts')}`;

const historySignature = {
  camera: 1,
  device: 1,
  environment: 1,
  geometry: 1,
  lighting: 1,
  materials: 1,
  postProcess: 1,
  scene: 1,
  viewport: 1,
} as const;

test.describe('Phase 4 deterministic Dynamic TAA resolve', () => {
  test('matches accepted, Depth-rejected, and Normal-rejected CPU results through WebGPU readback', async ({
    page,
  }) => {
    await page.goto('/acceptance/phase-01');
    const gpuResult = await page.evaluate(async (source) => {
      const adapter = await navigator.gpu?.requestAdapter();
      if (adapter === null || adapter === undefined) throw new Error('WebGPU adapter unavailable.');
      const device = await adapter.requestDevice();
      const module = device.createShaderModule({ code: source, label: 'Phase 4 TAA reference' });
      const compilation = await module.getCompilationInfo();
      const compilationMessages = compilation.messages.map((message) => ({
        line: message.lineNum,
        message: message.message,
        type: message.type,
      }));
      const errors = compilationMessages.filter((message) => message.type === 'error');
      if (errors.length > 0) throw new Error(JSON.stringify(errors));

      const bufferUsage = {
        copyDestination: 0x0008,
        copySource: 0x0004,
        mapRead: 0x0001,
        storage: 0x0080,
      } as const;
      const outputValueCount = 60;
      const outputByteLength = outputValueCount * Float32Array.BYTES_PER_ELEMENT;
      const output = device.createBuffer({
        label: 'Phase 4 TAA output',
        size: outputByteLength,
        usage: bufferUsage.copySource | bufferUsage.storage,
      });
      const readback = device.createBuffer({
        label: 'Phase 4 TAA readback',
        size: outputByteLength,
        usage: bufferUsage.copyDestination | bufferUsage.mapRead,
      });

      try {
        const pipeline = await device.createComputePipelineAsync({
          compute: { entryPoint: 'computeMain', module },
          label: 'Phase 4 TAA reference pipeline',
          layout: 'auto',
        });
        const bindGroup = device.createBindGroup({
          entries: [{ binding: 0, resource: { buffer: output } }],
          layout: pipeline.getBindGroupLayout(0),
        });
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginComputePass();
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(1);
        pass.end();
        encoder.copyBufferToBuffer(output, 0, readback, 0, outputByteLength);
        device.queue.submit([encoder.finish()]);
        await readback.mapAsync(bufferUsage.mapRead);
        const values = Array.from(new Float32Array(readback.getMappedRange()).slice());
        readback.unmap();
        return { compilationMessages, values };
      } finally {
        output.destroy();
        readback.destroy();
        device.destroy();
      }
    }, PHASE_04_TAA_REFERENCE_WGSL);

    const reference = evaluateDeterministicTemporalTaaReference();
    const expected = Array.from(reference.values);
    const outputLabels = TEMPORAL_TAA_REFERENCE_CASES.flatMap(({ id }) =>
      TEMPORAL_TAA_REFERENCE_OUTPUT_FIELDS.map((field) => `${id}:${field}`),
    );
    expect(gpuResult.compilationMessages.filter((message) => message.type === 'error')).toEqual([]);
    expect(gpuResult.values).toHaveLength(expected.length);
    const absoluteDifferences = gpuResult.values.map((value, index) =>
      Math.abs(value - (expected[index] as number)),
    );
    absoluteDifferences.forEach((difference, index) => {
      expect(
        difference,
        `${outputLabels[index]}: CPU ${expected[index]}, GPU ${gpuResult.values[index]}`,
      ).toBeLessThanOrEqual(absoluteTolerance);
    });

    const runtimeDirectory = path.resolve('test-results/phase-04/runtime');
    await mkdir(runtimeDirectory, { recursive: true });
    await writeFile(
      path.join(runtimeDirectory, 'taa-resolve-reference.json'),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          phase: '04',
          checkpoint: 'P4-03',
          algorithm: {
            colorSpace: 'linear HDR RGB with current-frame Alpha',
            neighborhood: 'component-wise 3x3 current-color minimum/maximum clamp',
            rejection: 'History validity plus relative/absolute Depth and normalized Normal cosine',
            responsiveWeight: 'base weight multiplied by one minus mask times reduction',
          },
          options: TEMPORAL_TAA_DEFAULT_OPTIONS,
          cases: TEMPORAL_TAA_REFERENCE_CASES.map(({ id }) => id),
          outputFields: TEMPORAL_TAA_REFERENCE_OUTPUT_FIELDS,
          outputLabels,
          cpu: expected,
          gpu: gpuResult.values,
          absoluteDifferences,
          maximumAbsoluteDifference: Math.max(...absoluteDifferences),
          absoluteTolerance,
          maximumToleranceRatio: Math.max(
            ...absoluteDifferences.map((difference) => difference / absoluteTolerance),
          ),
          compilationMessages: gpuResult.compilationMessages,
          status: 'PASS',
        },
        null,
        2,
      )}\n`,
    );
  });

  test('matches deterministic Camera-motion reprojection through WebGPU readback', async ({
    page,
  }) => {
    await page.goto('/acceptance/phase-01');
    const encodedInputs = CAMERA_REPROJECTION_REFERENCE_CASES.flatMap(({ input }) => [
      ...input.currentInverseViewProjection,
      ...input.previousViewProjection,
      ...input.currentUv,
      input.currentDepth,
      0,
    ]);
    const gpuResult = await page.evaluate(
      async ({ caseCount, inputs, source }) => {
        const adapter = await navigator.gpu?.requestAdapter();
        if (adapter === null || adapter === undefined)
          throw new Error('WebGPU adapter unavailable.');
        const device = await adapter.requestDevice();
        const module = device.createShaderModule({
          code: source,
          label: 'Phase 4 Camera reprojection reference',
        });
        const compilation = await module.getCompilationInfo();
        const compilationMessages = compilation.messages.map((message) => ({
          line: message.lineNum,
          message: message.message,
          type: message.type,
        }));
        const errors = compilationMessages.filter((message) => message.type === 'error');
        if (errors.length > 0) throw new Error(JSON.stringify(errors));

        const bufferUsage = {
          copyDestination: 0x0008,
          copySource: 0x0004,
          mapRead: 0x0001,
          storage: 0x0080,
        } as const;
        const outputValueCount = caseCount * 16;
        const outputByteLength = outputValueCount * Float32Array.BYTES_PER_ELEMENT;
        const inputValues = new Float32Array(inputs);
        const input = device.createBuffer({
          label: 'Phase 4 Camera reprojection input',
          size: inputValues.byteLength,
          usage: bufferUsage.copyDestination | bufferUsage.storage,
        });
        const output = device.createBuffer({
          label: 'Phase 4 Camera reprojection output',
          size: outputByteLength,
          usage: bufferUsage.copySource | bufferUsage.storage,
        });
        const readback = device.createBuffer({
          label: 'Phase 4 Camera reprojection readback',
          size: outputByteLength,
          usage: bufferUsage.copyDestination | bufferUsage.mapRead,
        });

        try {
          device.queue.writeBuffer(input, 0, inputValues);
          const pipeline = await device.createComputePipelineAsync({
            compute: { entryPoint: 'computeMain', module },
            label: 'Phase 4 Camera reprojection reference pipeline',
            layout: 'auto',
          });
          const bindGroup = device.createBindGroup({
            entries: [
              { binding: 0, resource: { buffer: input } },
              { binding: 1, resource: { buffer: output } },
            ],
            layout: pipeline.getBindGroupLayout(0),
          });
          const encoder = device.createCommandEncoder();
          const pass = encoder.beginComputePass();
          pass.setPipeline(pipeline);
          pass.setBindGroup(0, bindGroup);
          pass.dispatchWorkgroups(caseCount);
          pass.end();
          encoder.copyBufferToBuffer(output, 0, readback, 0, outputByteLength);
          device.queue.submit([encoder.finish()]);
          await readback.mapAsync(bufferUsage.mapRead);
          const values = Array.from(new Float32Array(readback.getMappedRange()).slice());
          readback.unmap();
          return { compilationMessages, values };
        } finally {
          input.destroy();
          output.destroy();
          readback.destroy();
          device.destroy();
        }
      },
      {
        caseCount: CAMERA_REPROJECTION_REFERENCE_CASES.length,
        inputs: encodedInputs,
        source: PHASE_04_CAMERA_REPROJECTION_REFERENCE_WGSL,
      },
    );

    const reference = evaluateDeterministicCameraReprojectionReference();
    const expected = Array.from(reference.values);
    const outputLabels = CAMERA_REPROJECTION_REFERENCE_CASES.flatMap(({ id }) =>
      CAMERA_REPROJECTION_REFERENCE_OUTPUT_FIELDS.map((field) => `${id}:${field}`),
    );
    expect(gpuResult.compilationMessages.filter((message) => message.type === 'error')).toEqual([]);
    expect(gpuResult.values).toHaveLength(expected.length);
    const absoluteDifferences = gpuResult.values.map((value, index) =>
      Math.abs(value - (expected[index] as number)),
    );
    absoluteDifferences.forEach((difference, index) => {
      expect(
        difference,
        `${outputLabels[index]}: CPU ${expected[index]}, GPU ${gpuResult.values[index]}`,
      ).toBeLessThanOrEqual(cameraReprojectionAbsoluteTolerance);
    });

    const runtimeDirectory = path.resolve('test-results/phase-04/runtime');
    await mkdir(runtimeDirectory, { recursive: true });
    await writeFile(
      path.join(runtimeDirectory, 'camera-reprojection.json'),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          phase: '04',
          checkpoint: 'P4-05',
          algorithm: {
            clipDepth: 'WebGPU zero through one',
            historyCoordinate: 'top-left raster UV from Previous jittered View-Projection',
            motionDirection: 'Current UV minus History UV',
            reconstruction: 'Current Depth through inverse Current jittered View-Projection',
            validity:
              'background, homogeneous W, previous clip W/depth, and History UV fail closed',
          },
          cases: CAMERA_REPROJECTION_REFERENCE_CASES.map(({ id }) => id),
          outputFields: CAMERA_REPROJECTION_REFERENCE_OUTPUT_FIELDS,
          outputLabels,
          cpu: expected,
          gpu: gpuResult.values,
          absoluteDifferences,
          maximumAbsoluteDifference: Math.max(...absoluteDifferences),
          absoluteTolerance: cameraReprojectionAbsoluteTolerance,
          maximumToleranceRatio: Math.max(
            ...absoluteDifferences.map(
              (difference) => difference / cameraReprojectionAbsoluteTolerance,
            ),
          ),
          compilationMessages: gpuResult.compilationMessages,
          status: 'PASS',
        },
        null,
        2,
      )}\n`,
    );
  });

  test('submits ordered MRT passes through owner-scoped TAA target sets', async ({ page }) => {
    const runtimeErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') runtimeErrors.push(message.text());
    });
    page.on('pageerror', (error) => runtimeErrors.push(error.message));
    await page.goto('/acceptance/phase-01');

    const result = await page.evaluate(
      async ({ backendUrl, rendererUrl, signature }) => {
        const { createWebGpuBackend } = (await import(
          /* @vite-ignore */ backendUrl
        )) as typeof import('../../packages/backend-webgpu/src/index.js');
        const { DynamicTaaGpuHistory } = (await import(
          /* @vite-ignore */ rendererUrl
        )) as typeof import('../../packages/renderer/src/index.js');
        const backend = createWebGpuBackend({ label: 'phase-04-offscreen-gate' });
        const history = new DynamicTaaGpuHistory({
          height: 2,
          ownerId: 'phase-04-offscreen-gate',
          width: 3,
        });
        let shader: ReturnType<typeof backend.createShaderModule> | undefined;
        let pipeline: Awaited<ReturnType<typeof backend.createRenderPipeline>> | undefined;
        try {
          await backend.initialize();
          history.initialize(backend);
          shader = backend.createShaderModule({
            code: `
              @vertex
              fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4f {
                let positions = array<vec2f, 3>(
                  vec2f(-1.0, -1.0),
                  vec2f(3.0, -1.0),
                  vec2f(-1.0, 3.0)
                );
                return vec4f(positions[vertexIndex], 0.0, 1.0);
              }

              struct FragmentOutput {
                @location(0) color: vec4f,
                @location(1) normal: vec4f,
              }

              @fragment
              fn fragmentMain() -> FragmentOutput {
                var output: FragmentOutput;
                output.color = vec4f(0.25, 0.5, 1.0, 1.0);
                output.normal = vec4f(0.5, 0.5, 1.0, 1.0);
                return output;
              }
            `,
            label: 'phase-04-offscreen-shader',
            language: 'wgsl',
          });
          const compilation = await backend.getShaderCompilationInfo(shader);
          if (!compilation.valid) throw new Error(JSON.stringify(compilation.messages));
          pipeline = await backend.createRenderPipeline({
            depthStencil: {
              depthCompare: 'always',
              depthWriteEnabled: true,
              format: 'depth32float',
            },
            fragment: {
              entryPoint: 'fragmentMain',
              module: shader,
              targets: [{ format: 'rgba16float' }, { format: 'rgba16float' }],
            },
            label: 'phase-04-offscreen-pipeline',
            vertex: { entryPoint: 'vertexMain', module: shader },
          });

          const first = history.prepareFrame(signature);
          const firstStats = backend.executeFrame({
            commandEncoder: backend.createCommandEncoder({ label: 'phase-04-offscreen-first' }),
            renderPasses: [
              {
                clearColor: { a: 1, b: 0, g: 0, r: 0 },
                colorAttachments: [
                  {
                    loadOp: 'clear',
                    storeOp: 'store',
                    texture: first.currentColorTexture,
                  },
                  {
                    clearColor: { a: 1, b: 1, g: 0.5, r: 0.5 },
                    loadOp: 'clear',
                    storeOp: 'store',
                    texture: first.writeNormalTexture,
                  },
                ],
                depthAttachment: {
                  clearValue: 1,
                  loadOp: 'clear',
                  storeOp: 'store',
                  texture: first.writeDepthTexture,
                },
                draws: [{ pipeline, vertexCount: 3 }],
                label: 'phase-04-offscreen-first',
              },
            ],
          });
          await backend.waitForIdle();
          const committed = history.commitFrame();
          const second = history.prepareFrame(signature);
          history.cancelFrame();

          const resized = history.resize(5, 4);
          const third = history.prepareFrame({ ...signature, viewport: 2 });
          const resizedStats = backend.executeFrame({
            commandEncoder: backend.createCommandEncoder({ label: 'phase-04-offscreen-resized' }),
            renderPasses: [
              {
                clearColor: { a: 1, b: 0.25, g: 0.5, r: 1 },
                colorAttachments: [
                  { texture: third.currentColorTexture },
                  {
                    clearColor: { a: 1, b: 1, g: 0.5, r: 0.5 },
                    texture: third.writeNormalTexture,
                  },
                ],
                depthAttachment: { texture: third.writeDepthTexture },
                draws: [{ pipeline, vertexCount: 3 }],
                label: 'phase-04-offscreen-resized',
              },
            ],
          });
          await backend.waitForIdle();
          const resizedCommitted = history.commitFrame();
          const resourcesBeforeHistoryDispose = backend.getResourceStatistics();
          history.dispose();
          const resourcesAfterHistoryDispose = backend.getResourceStatistics();

          return {
            checkpoint: 'P4-06',
            compilationMessages: compilation.messages,
            first: {
              historyValid: first.historyValid,
              statistics: firstStats,
            },
            firstCommit: committed,
            second: {
              currentStable: second.currentColorTexture === first.currentColorTexture,
              historyValid: second.historyValid,
              swapped:
                second.readColorTexture === first.writeColorTexture &&
                second.readDepthTexture === first.writeDepthTexture &&
                second.readNormalTexture === first.writeNormalTexture &&
                second.writeColorTexture === first.readColorTexture &&
                second.writeDepthTexture === first.readDepthTexture &&
                second.writeNormalTexture === first.readNormalTexture,
            },
            resize: {
              committed: resizedCommitted,
              preparedHistoryValid: third.historyValid,
              resourcesReplaced:
                third.currentColorTexture !== first.currentColorTexture &&
                third.readColorTexture !== first.readColorTexture &&
                third.readDepthTexture !== first.readDepthTexture &&
                third.readNormalTexture !== first.readNormalTexture &&
                third.writeColorTexture !== first.writeColorTexture &&
                third.writeDepthTexture !== first.writeDepthTexture &&
                third.writeNormalTexture !== first.writeNormalTexture,
              state: resized,
              statistics: resizedStats,
            },
            resourcesAfterHistoryDispose,
            resourcesBeforeHistoryDispose,
            status: 'PASS',
          };
        } finally {
          history.dispose();
          if (pipeline !== undefined) backend.destroyResource(pipeline);
          if (shader !== undefined) backend.destroyResource(shader);
          backend.dispose();
        }
      },
      { backendUrl: backendModuleUrl, rendererUrl: rendererModuleUrl, signature: historySignature },
    );

    expect(result.compilationMessages).toEqual([]);
    expect(result.first).toEqual({
      historyValid: false,
      statistics: { drawCalls: 1, instances: 1, triangles: 1, vertices: 3 },
    });
    expect(result.firstCommit).toMatchObject({
      estimatedGpuBytes: 288,
      history: { sampleCount: 1, valid: true },
      resourceGeneration: 1,
      state: 'ready',
    });
    expect(result.second).toEqual({ currentStable: true, historyValid: true, swapped: true });
    expect(result.resize).toMatchObject({
      committed: {
        estimatedGpuBytes: 960,
        history: { sampleCount: 1, valid: true },
        resourceGeneration: 2,
      },
      preparedHistoryValid: false,
      resourcesReplaced: true,
      state: {
        history: { lastInvalidation: 'viewport', sampleCount: 0, valid: false },
        size: { height: 4, width: 5 },
      },
      statistics: { drawCalls: 1, instances: 1, triangles: 1, vertices: 3 },
    });
    expect(result.resourcesBeforeHistoryDispose).toMatchObject({
      activeCount: 10,
      byKind: {
        pipeline: { activeCount: 1 },
        sampler: { activeCount: 1 },
        'shader-module': { activeCount: 1 },
        texture: { activeCount: 7, activeEstimatedBytes: 960 },
      },
      createdTotal: 20,
      destroyedTotal: 10,
    });
    expect(result.resourcesAfterHistoryDispose).toMatchObject({
      activeCount: 2,
      byKind: { sampler: { activeCount: 0 }, texture: { activeCount: 0 } },
      createdTotal: 20,
      destroyedTotal: 18,
    });
    expect(runtimeErrors).toEqual([]);

    const runtimeDirectory = path.resolve('test-results/phase-04/runtime');
    await mkdir(runtimeDirectory, { recursive: true });
    await writeFile(
      path.join(runtimeDirectory, 'taa-history-gpu.json'),
      `${JSON.stringify({ schemaVersion: 1, phase: '04', ...result }, null, 2)}\n`,
    );
  });
});
