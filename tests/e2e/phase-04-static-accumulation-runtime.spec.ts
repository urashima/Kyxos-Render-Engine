import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import {
  float16BitsToFloat32,
  float32ToFloat16Bits,
} from '../../packages/environment/src/index.js';
import { PHASE_04_STATIC_ACCUMULATION_WGSL } from '../../packages/renderer/src/generated/phase-04-static-accumulation.wgsl.js';
import { accumulateStaticSample } from '../../packages/temporal/src/index.js';

const sampledAccumulationTolerance = 0.002;
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
const samples = [
  [1, 0.25, 0, 1],
  [0, 0.5, 1, 1],
  [0.5, 0.75, 0.25, 1],
] as const;

test.describe('Phase 4 Static Accumulation runtime', () => {
  test('executes three Backend frames, converges, resets, and releases every resource', async ({
    page,
  }) => {
    const runtimeErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') runtimeErrors.push(message.text());
    });
    page.on('pageerror', (error) => runtimeErrors.push(error.message));
    await page.goto('/acceptance/phase-01');
    const sampleHalfBits = samples.map((sample) => sample.map(float32ToFloat16Bits));

    const result = await page.evaluate(
      async ({ backendUrl, halfBits, rendererUrl, signature }) => {
        const { createWebGpuBackend } = (await import(
          /* @vite-ignore */ backendUrl
        )) as typeof import('../../packages/backend-webgpu/src/index.js');
        const { StaticAccumulationGpuHistory, StaticAccumulationPass } = (await import(
          /* @vite-ignore */ rendererUrl
        )) as typeof import('../../packages/renderer/src/index.js');
        const backend = createWebGpuBackend({ label: 'phase-04-static-accumulation-gate' });
        const history = new StaticAccumulationGpuHistory({
          height: 1,
          ownerId: 'phase-04-static-accumulation-gate',
          targetSamples: 3,
          width: 1,
        });
        const accumulationPass = new StaticAccumulationPass({
          ownerId: 'phase-04-static-accumulation-gate',
        });
        let currentTexture: ReturnType<typeof backend.createTexture> | undefined;
        try {
          await backend.initialize();
          history.initialize(backend);
          await accumulationPass.initialize(backend);
          currentTexture = backend.createTexture({
            format: 'rgba16float',
            label: 'phase-04-static-current',
            size: { height: 1, width: 1 },
            usage: ['copy-dst', 'sampled'],
          });
          const sourceTexture = currentTexture;
          const frames: {
            diagnostics: ReturnType<typeof history.getDiagnostics>;
            statistics: ReturnType<typeof accumulationPass.execute>;
          }[] = [];
          for (const bits of halfBits) {
            backend.writeTexture(sourceTexture, new Uint16Array(bits), {
              bytesPerRow: 8,
              rowsPerImage: 1,
              size: { height: 1, width: 1 },
            });
            const frame = history.prepareFrame(signature);
            const statistics = accumulationPass.execute({
              currentColorTexture: sourceTexture,
              frame,
            });
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

          accumulationPass.dispose();
          history.dispose();
          backend.destroyResource(sourceTexture);
          currentTexture = undefined;
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
          if (!history.disposed && history.getDiagnostics().frameOpen) history.cancelFrame();
          accumulationPass.dispose();
          history.dispose();
          if (currentTexture !== undefined) backend.destroyResource(currentTexture);
          backend.dispose();
        }
      },
      {
        backendUrl: backendModuleUrl,
        halfBits: sampleHalfBits,
        rendererUrl: rendererModuleUrl,
        signature: historySignature,
      },
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
      `${JSON.stringify(
        {
          schemaVersion: 1,
          phase: '04',
          checkpoint: 'P4-10-lifecycle',
          ...result,
          status: 'PASS',
        },
        null,
        2,
      )}\n`,
    );
  });

  test('matches a three-frame linear-HDR running mean through rgba16float readback', async ({
    page,
  }) => {
    await page.goto('/acceptance/phase-01');
    let cpu = accumulateStaticSample({
      currentColor: samples[0],
      accumulatedColor: [0, 0, 0, 0],
      historyValid: false,
      accumulatedSampleCount: 0,
    });
    for (const sample of samples.slice(1)) {
      cpu = accumulateStaticSample({
        currentColor: sample,
        accumulatedColor: cpu.outputColor,
        historyValid: true,
        accumulatedSampleCount: cpu.sampleCount,
      });
    }
    const halfBits = samples.map((sample) => sample.map(float32ToFloat16Bits));

    const gpu = await page.evaluate(
      async ({ inputs, source }) => {
        const adapter = await navigator.gpu?.requestAdapter();
        if (adapter === null || adapter === undefined)
          throw new Error('WebGPU adapter unavailable.');
        const device = await adapter.requestDevice();
        const module = device.createShaderModule({
          code: source,
          label: 'Phase 4 Static Accumulation runtime',
        });
        const compilation = await module.getCompilationInfo();
        const errors = compilation.messages.filter((message) => message.type === 'error');
        if (errors.length > 0) throw new Error(JSON.stringify(errors));
        const textureUsage = {
          copyDestination: 0x0002,
          copySource: 0x0001,
          renderAttachment: 0x0010,
          textureBinding: 0x0004,
        } as const;
        const bufferUsage = {
          copyDestination: 0x0008,
          mapRead: 0x0001,
          uniform: 0x0040,
        } as const;
        const current = device.createTexture({
          format: 'rgba16float',
          size: { height: 1, width: 1 },
          usage: textureUsage.copyDestination | textureUsage.textureBinding,
        });
        const histories: [GPUTexture, GPUTexture] = [
          device.createTexture({
            format: 'rgba16float',
            size: { height: 1, width: 1 },
            usage:
              textureUsage.copySource | textureUsage.renderAttachment | textureUsage.textureBinding,
          }),
          device.createTexture({
            format: 'rgba16float',
            size: { height: 1, width: 1 },
            usage:
              textureUsage.copySource | textureUsage.renderAttachment | textureUsage.textureBinding,
          }),
        ];
        const uniform = device.createBuffer({
          size: 16,
          usage: bufferUsage.copyDestination | bufferUsage.uniform,
        });
        const pipeline = device.createRenderPipeline({
          fragment: {
            entryPoint: 'fragmentMain',
            module,
            targets: [{ format: 'rgba16float' }],
          },
          layout: 'auto',
          primitive: { topology: 'triangle-list' },
          vertex: { entryPoint: 'vertexMain', module },
        });
        let readIndex: 0 | 1 = 0;
        for (let index = 0; index < inputs.length; index += 1) {
          const input = inputs[index];
          if (input === undefined) throw new Error(`Missing accumulation input ${index}.`);
          device.queue.writeTexture(
            { texture: current },
            new Uint16Array(input),
            { bytesPerRow: 8, rowsPerImage: 1 },
            { height: 1, width: 1 },
          );
          const previousSampleCount = index;
          device.queue.writeBuffer(
            uniform,
            0,
            new Float32Array([
              previousSampleCount / (previousSampleCount + 1),
              1 / (previousSampleCount + 1),
              index === 0 ? 0 : 1,
              previousSampleCount,
            ]),
          );
          const writeIndex: 0 | 1 = readIndex === 0 ? 1 : 0;
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
            colorAttachments: [
              {
                clearValue: { a: 0, b: 0, g: 0, r: 0 },
                loadOp: 'clear',
                storeOp: 'store',
                view: histories[writeIndex].createView(),
              },
            ],
          });
          renderPass.setPipeline(pipeline);
          renderPass.setBindGroup(0, bindGroup);
          renderPass.draw(3);
          renderPass.end();
          device.queue.submit([encoder.finish()]);
          readIndex = writeIndex;
        }

        const readback = device.createBuffer({
          size: 256,
          usage: bufferUsage.copyDestination | bufferUsage.mapRead,
        });
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
        const compilationMessages = compilation.messages.map((message) => ({
          message: message.message,
          type: message.type,
        }));
        readback.destroy();
        uniform.destroy();
        histories.forEach((texture) => texture.destroy());
        current.destroy();
        device.destroy();
        return { compilationMessages, outputHalfBits };
      },
      { inputs: halfBits, source: PHASE_04_STATIC_ACCUMULATION_WGSL },
    );

    const output = gpu.outputHalfBits.map(float16BitsToFloat32);
    const expected = Array.from(cpu.outputColor);
    const absoluteDifferences = output.map((value, index) =>
      Math.abs(value - (expected[index] as number)),
    );
    absoluteDifferences.forEach((difference) => {
      expect(difference).toBeLessThanOrEqual(sampledAccumulationTolerance);
    });

    const runtimeDirectory = path.resolve('test-results/phase-04/runtime');
    await mkdir(runtimeDirectory, { recursive: true });
    await writeFile(
      path.join(runtimeDirectory, 'static-accumulation-runtime.json'),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          phase: '04',
          checkpoint: 'P4-10-runtime',
          samples,
          expected,
          output,
          absoluteDifferences,
          maximumAbsoluteDifference: Math.max(...absoluteDifferences),
          tolerance: sampledAccumulationTolerance,
          compilationMessages: gpu.compilationMessages,
          status: 'PASS',
        },
        null,
        2,
      )}\n`,
    );
  });
});
