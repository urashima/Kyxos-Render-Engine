import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { evaluateMetallicRoughnessBrdf } from '../../packages/material-pbr/src/brdf.js';
import { PHASE_03_BRDF_REFERENCE_WGSL } from '../../packages/material-pbr/src/generated/phase-03-brdf-reference.wgsl.js';

const referenceInput = {
  baseColor: [0.8, 0.3, 0.1] as const,
  metallic: 0.65,
  nDotH: 0.92,
  nDotL: 0.73,
  nDotV: 0.81,
  roughness: 0.42,
  vDotH: 0.88,
};

test.describe('Phase 3 BRDF reference', () => {
  test('compiles and matches the CPU reference through WebGPU float32 readback', async ({
    page,
  }) => {
    await page.goto('/acceptance/phase-01');
    const gpuResult = await page.evaluate(async (source) => {
      const adapter = await navigator.gpu?.requestAdapter();
      if (adapter === null || adapter === undefined) throw new Error('WebGPU adapter unavailable.');
      const device = await adapter.requestDevice();
      const module = device.createShaderModule({ code: source, label: 'Phase 3 BRDF reference' });
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

      const output = device.createBuffer({
        label: 'Phase 3 BRDF output',
        size: 48,
        usage: bufferUsage.copySource | bufferUsage.storage,
      });
      const readback = device.createBuffer({
        label: 'Phase 3 BRDF readback',
        size: 48,
        usage: bufferUsage.copyDestination | bufferUsage.mapRead,
      });
      try {
        const pipeline = await device.createComputePipelineAsync({
          compute: { entryPoint: 'computeMain', module },
          label: 'Phase 3 BRDF reference pipeline',
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
        encoder.copyBufferToBuffer(output, 0, readback, 0, 48);
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
    }, PHASE_03_BRDF_REFERENCE_WGSL);

    const cpu = evaluateMetallicRoughnessBrdf(referenceInput);
    const expected = [
      ...cpu.diffuse,
      cpu.alpha,
      ...cpu.specular,
      cpu.distribution,
      ...cpu.total,
      cpu.visibility,
    ];
    expect(gpuResult.compilationMessages.filter((message) => message.type === 'error')).toEqual([]);
    expect(gpuResult.values).toHaveLength(expected.length);
    for (const [index, value] of gpuResult.values.entries()) {
      expect(value, `BRDF float ${index}`).toBeCloseTo(expected[index] as number, 5);
    }

    const runtimeDirectory = path.resolve('test-results/phase-03/runtime');
    await mkdir(runtimeDirectory, { recursive: true });
    await writeFile(
      path.join(runtimeDirectory, 'brdf-reference.json'),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          phase: '03',
          checkpoint: 'P3-02',
          input: referenceInput,
          cpu: expected,
          gpu: gpuResult.values,
          compilationMessages: gpuResult.compilationMessages,
          status: 'PASS',
        },
        null,
        2,
      )}\n`,
    );
  });
});
