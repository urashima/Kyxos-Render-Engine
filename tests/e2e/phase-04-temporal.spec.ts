import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { PHASE_04_TAA_REFERENCE_WGSL } from '../../packages/temporal/src/generated/phase-04-taa-reference.wgsl.js';
import {
  TEMPORAL_TAA_DEFAULT_OPTIONS,
  TEMPORAL_TAA_REFERENCE_CASES,
  TEMPORAL_TAA_REFERENCE_OUTPUT_FIELDS,
  evaluateDeterministicTemporalTaaReference,
} from '../../packages/temporal/src/index.js';

const absoluteTolerance = 0.000001;

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
});
