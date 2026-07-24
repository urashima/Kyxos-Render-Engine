import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { float32ToFloat16Bits } from '../../packages/environment/src/index.js';
import { evaluatePbrOutputTransform } from '../../packages/material-pbr/src/index.js';
import { PHASE_04_TAA_PRESENT_WGSL } from '../../packages/renderer/src/generated/phase-04-taa-present.wgsl.js';

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

test.describe('Phase 4 final Dynamic TAA Present', () => {
  test('submits the resolved write target to a real Canvas Surface and releases every owned resource', async ({
    page,
  }) => {
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
        const { DynamicTaaGpuHistory, DynamicTaaPresentPass } = (await import(
          /* @vite-ignore */ rendererUrl
        )) as typeof import('../../packages/renderer/src/index.js');
        const backend = createWebGpuBackend({ label: 'phase-04-taa-present-gate' });
        const history = new DynamicTaaGpuHistory({
          height: 2,
          ownerId: 'phase-04-taa-present-gate',
          width: 3,
        });
        const canvas = document.createElement('canvas');
        canvas.dataset['testid'] = 'phase-04-present-canvas';
        document.body.append(canvas);
        const present = new DynamicTaaPresentPass({
          output: { exposure: -1, toneMapping: 'khronos-pbr-neutral' },
          ownerId: 'phase-04-taa-present-gate',
          surface: {
            cssHeight: 2,
            cssWidth: 3,
            devicePixelRatio: 1,
            target: canvas,
          },
        });
        let frame: ReturnType<typeof history.prepareFrame> | undefined;
        try {
          await backend.initialize();
          history.initialize(backend);
          frame = history.prepareFrame(signature);
          await present.initialize(backend);
          const statistics = present.execute({ frame });
          await backend.waitForIdle();
          const diagnostics = present.getDiagnostics();
          const resourcesBeforeDispose = backend.getResourceStatistics();
          present.dispose();
          history.cancelFrame();
          frame = undefined;
          history.dispose();
          const resourcesAfterDispose = backend.getResourceStatistics();
          return {
            checkpoint: 'P4-09-surface',
            diagnostics,
            resourcesAfterDispose,
            resourcesBeforeDispose,
            statistics,
            status: 'PASS',
          };
        } finally {
          present.dispose();
          if (frame !== undefined) history.cancelFrame();
          history.dispose();
          backend.dispose();
          canvas.remove();
        }
      },
      { backendUrl: backendModuleUrl, rendererUrl: rendererModuleUrl, signature: historySignature },
    );

    expect(result.statistics).toEqual({
      drawCalls: 1,
      instances: 1,
      triangles: 1,
      vertices: 3,
    });
    expect(result.diagnostics).toMatchObject({
      activeBindGroupCount: 1,
      executionCount: 1,
      outputExposure: -1,
      outputExposureMultiplier: 0.5,
      outputToneMapping: 'khronos-pbr-neutral',
      ownerId: 'phase-04-taa-present-gate',
      resourceGeneration: 1,
      state: 'ready',
      surface: { size: { physicalHeight: 2, physicalWidth: 3, suspended: false } },
    });
    expect(result.resourcesBeforeDispose.byKind).toMatchObject({
      'bind-group': { activeCount: 1 },
      buffer: { activeCount: 1 },
      pipeline: { activeCount: 1 },
      sampler: { activeCount: 1 },
      'shader-module': { activeCount: 1 },
      surface: { activeCount: 1 },
      texture: { activeCount: 8 },
    });
    expect(result.resourcesAfterDispose.activeCount).toBe(0);
    expect(runtimeErrors).toEqual([]);

    const runtimeDirectory = path.resolve('test-results/phase-04/runtime');
    await mkdir(runtimeDirectory, { recursive: true });
    await writeFile(
      path.join(runtimeDirectory, 'taa-present-surface.json'),
      `${JSON.stringify({ schemaVersion: 1, phase: '04', ...result }, null, 2)}\n`,
    );
  });

  test('matches the CPU exposure, Khronos PBR Neutral, and sRGB oracle through rgba8unorm readback', async ({
    page,
  }) => {
    await page.goto('/acceptance/phase-01');
    const linearPixels = [
      [0.18, 0.18, 0.18, 1],
      [2, 0.5, 0.125, 0.5],
      [8, 4, 1, 0.25],
    ] as const;
    const sourceHalfBits = linearPixels.flatMap((pixel) =>
      pixel.map((channel) => float32ToFloat16Bits(channel)),
    );
    const expectedPixels = linearPixels.map((pixel) => {
      const output = evaluatePbrOutputTransform([pixel[0], pixel[1], pixel[2]], {
        exposure: -1,
        toneMapping: 'khronos-pbr-neutral',
      });
      return [
        ...output.srgb.map((channel) => Math.round(channel * 255)),
        Math.round(pixel[3] * 255),
      ];
    });

    const gpuResult = await page.evaluate(
      async ({ expected, halfBits, source }) => {
        const adapter = await navigator.gpu?.requestAdapter();
        if (adapter === null || adapter === undefined)
          throw new Error('WebGPU adapter unavailable.');
        const device = await adapter.requestDevice();
        const module = device.createShaderModule({ code: source, label: 'Phase 4 TAA Present' });
        const compilation = await module.getCompilationInfo();
        const compilationMessages = compilation.messages.map((message) => ({
          line: message.lineNum,
          message: message.message,
          type: message.type,
        }));
        const errors = compilationMessages.filter((message) => message.type === 'error');
        if (errors.length > 0) throw new Error(JSON.stringify(errors));

        const bufferUsage = { copyDestination: 0x0008, mapRead: 0x0001, uniform: 0x0040 } as const;
        const textureUsage = {
          copyDestination: 0x0002,
          copySource: 0x0001,
          renderAttachment: 0x0010,
          textureBinding: 0x0004,
        } as const;
        const sourceTexture = device.createTexture({
          format: 'rgba16float',
          label: 'Phase 4 Present source',
          size: { height: 1, width: 3 },
          usage: textureUsage.copyDestination | textureUsage.textureBinding,
        });
        device.queue.writeTexture(
          { texture: sourceTexture },
          new Uint16Array(halfBits),
          { bytesPerRow: 24, rowsPerImage: 1 },
          { height: 1, width: 3 },
        );
        const outputTexture = device.createTexture({
          format: 'rgba8unorm',
          label: 'Phase 4 Present output',
          size: { height: 1, width: 3 },
          usage: textureUsage.copySource | textureUsage.renderAttachment,
        });
        const uniform = device.createBuffer({
          label: 'Phase 4 Present uniform',
          size: 16,
          usage: bufferUsage.copyDestination | bufferUsage.uniform,
        });
        device.queue.writeBuffer(uniform, 0, new Float32Array([0.5, 1, 0, 0]));
        const pipeline = device.createRenderPipeline({
          fragment: { entryPoint: 'fragmentMain', module, targets: [{ format: 'rgba8unorm' }] },
          layout: 'auto',
          primitive: { topology: 'triangle-list' },
          vertex: { entryPoint: 'vertexMain', module },
        });
        const bindGroup = device.createBindGroup({
          entries: [
            { binding: 0, resource: { buffer: uniform } },
            { binding: 1, resource: sourceTexture.createView() },
          ],
          layout: pipeline.getBindGroupLayout(0),
        });
        const readback = device.createBuffer({
          label: 'Phase 4 Present readback',
          size: 256,
          usage: bufferUsage.copyDestination | bufferUsage.mapRead,
        });
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass({
          colorAttachments: [
            {
              clearValue: { a: 0, b: 0, g: 0, r: 0 },
              loadOp: 'clear',
              storeOp: 'store',
              view: outputTexture.createView(),
            },
          ],
        });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.draw(3);
        pass.end();
        encoder.copyTextureToBuffer(
          { texture: outputTexture },
          { buffer: readback, bytesPerRow: 256, rowsPerImage: 1 },
          { height: 1, width: 3 },
        );
        device.queue.submit([encoder.finish()]);
        await readback.mapAsync(0x0001);
        const bytes = new Uint8Array(readback.getMappedRange()).slice(0, 12);
        readback.unmap();
        const pixels = Array.from({ length: 3 }, (_, index) =>
          Array.from(bytes.slice(index * 4, index * 4 + 4)),
        );
        const differences = pixels.map((pixel, pixelIndex) =>
          pixel.map((channel, channelIndex) =>
            Math.abs(channel - (expected[pixelIndex]?.[channelIndex] ?? 0)),
          ),
        );
        const maximumDifference = Math.max(...differences.flat());
        readback.destroy();
        uniform.destroy();
        outputTexture.destroy();
        sourceTexture.destroy();
        device.destroy();
        return { compilationMessages, differences, maximumDifference, pixels };
      },
      { expected: expectedPixels, halfBits: sourceHalfBits, source: PHASE_04_TAA_PRESENT_WGSL },
    );

    expect(gpuResult.compilationMessages.filter(({ type }) => type === 'error')).toEqual([]);
    expect(gpuResult.maximumDifference).toBeLessThanOrEqual(2);

    const result = {
      checkpoint: 'P4-09-reference',
      expectedPixels,
      linearPixels,
      ...gpuResult,
      status: 'PASS',
    };
    const runtimeDirectory = path.resolve('test-results/phase-04/runtime');
    await mkdir(runtimeDirectory, { recursive: true });
    await writeFile(
      path.join(runtimeDirectory, 'taa-present-reference.json'),
      `${JSON.stringify({ schemaVersion: 1, phase: '04', ...result }, null, 2)}\n`,
    );
  });
});
