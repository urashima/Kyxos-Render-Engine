import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { PHASE_04_STATIC_ACCUMULATION_REFERENCE_WGSL } from '../../packages/temporal/src/generated/phase-04-static-accumulation-reference.wgsl.js';
import {
  STATIC_ACCUMULATION_REFERENCE_CASES,
  STATIC_ACCUMULATION_REFERENCE_OUTPUT_FIELDS,
  evaluateDeterministicStaticAccumulationReference,
} from '../../packages/temporal/src/index.js';

const absoluteTolerance = 0.000001;

test.describe('Phase 4 deterministic Static Accumulation', () => {
  test('matches first-sample reset and running-mean CPU results through WebGPU readback', async ({
    page,
  }) => {
    await page.goto('/acceptance/phase-01');
    const gpuResult = await page.evaluate(async (source) => {
      const adapter = await navigator.gpu?.requestAdapter();
      if (adapter === null || adapter === undefined) throw new Error('WebGPU adapter unavailable.');
      const device = await adapter.requestDevice();
      const module = device.createShaderModule({
        code: source,
        label: 'Phase 4 Static Accumulation reference',
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
      const outputValueCount = 16;
      const outputByteLength = outputValueCount * Float32Array.BYTES_PER_ELEMENT;
      const output = device.createBuffer({
        label: 'Phase 4 Static Accumulation output',
        size: outputByteLength,
        usage: bufferUsage.copySource | bufferUsage.storage,
      });
      const readback = device.createBuffer({
        label: 'Phase 4 Static Accumulation readback',
        size: outputByteLength,
        usage: bufferUsage.copyDestination | bufferUsage.mapRead,
      });

      try {
        const pipeline = await device.createComputePipelineAsync({
          compute: { entryPoint: 'computeMain', module },
          label: 'Phase 4 Static Accumulation reference pipeline',
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
    }, PHASE_04_STATIC_ACCUMULATION_REFERENCE_WGSL);

    const reference = evaluateDeterministicStaticAccumulationReference();
    const expected = Array.from(reference.values);
    const outputLabels = STATIC_ACCUMULATION_REFERENCE_CASES.flatMap(({ id }) =>
      STATIC_ACCUMULATION_REFERENCE_OUTPUT_FIELDS.map((field) => `${id}:${field}`),
    );
    expect(gpuResult.compilationMessages.filter(({ type }) => type === 'error')).toEqual([]);
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
      path.join(runtimeDirectory, 'static-accumulation-reference.json'),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          phase: '04',
          checkpoint: 'P4-10-reference',
          algorithm: 'linear-HDR arithmetic running mean with fail-closed History reset',
          cases: STATIC_ACCUMULATION_REFERENCE_CASES.map(({ id }) => id),
          outputFields: STATIC_ACCUMULATION_REFERENCE_OUTPUT_FIELDS,
          outputLabels,
          cpu: expected,
          gpu: gpuResult.values,
          absoluteDifferences,
          maximumAbsoluteDifference: Math.max(...absoluteDifferences),
          absoluteTolerance,
          compilationMessages: gpuResult.compilationMessages,
          status: 'PASS',
        },
        null,
        2,
      )}\n`,
    );
  });
});
