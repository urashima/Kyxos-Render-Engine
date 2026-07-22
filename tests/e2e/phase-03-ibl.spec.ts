import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import {
  IBL_REFERENCE_INPUT,
  IBL_REFERENCE_SAMPLE_COUNT,
  evaluateDeterministicIblReference,
} from '../../packages/material-pbr/src/ibl-reference.js';
import { PHASE_03_IBL_REFERENCE_WGSL } from '../../packages/material-pbr/src/generated/phase-03-ibl-reference.wgsl.js';

const referenceOutputAbsoluteTolerance = 0.0005;
const accumulatedWeightAbsoluteTolerance = 0.001;
const outputLabels = [
  'diffuse irradiance red',
  'diffuse irradiance green',
  'diffuse irradiance blue',
  'diffuse sample count',
  'Lambertian radiance red',
  'Lambertian radiance green',
  'Lambertian radiance blue',
  'pi convention',
  'specular prefilter red',
  'specular prefilter green',
  'specular prefilter blue',
  'specular sample weight',
  'BRDF LUT scale',
  'BRDF LUT bias',
  'BRDF LUT N dot V',
  'BRDF LUT roughness',
] as const;
const absoluteTolerances = outputLabels.map((label) =>
  label === 'specular sample weight'
    ? accumulatedWeightAbsoluteTolerance
    : referenceOutputAbsoluteTolerance,
);

test.describe('Phase 3 deterministic IBL reference', () => {
  test('matches diffuse, GGX prefilter, and BRDF LUT CPU results through WebGPU readback', async ({
    page,
  }) => {
    await page.goto('/acceptance/phase-01');
    const gpuResult = await page.evaluate(async (source) => {
      const adapter = await navigator.gpu?.requestAdapter();
      if (adapter === null || adapter === undefined) throw new Error('WebGPU adapter unavailable.');
      const device = await adapter.requestDevice();
      const module = device.createShaderModule({ code: source, label: 'Phase 3 IBL reference' });
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
      const outputByteLength = 16 * Float32Array.BYTES_PER_ELEMENT;
      const output = device.createBuffer({
        label: 'Phase 3 IBL output',
        size: outputByteLength,
        usage: bufferUsage.copySource | bufferUsage.storage,
      });
      const readback = device.createBuffer({
        label: 'Phase 3 IBL readback',
        size: outputByteLength,
        usage: bufferUsage.copyDestination | bufferUsage.mapRead,
      });

      try {
        const pipeline = await device.createComputePipelineAsync({
          compute: { entryPoint: 'computeMain', module },
          label: 'Phase 3 IBL reference pipeline',
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
    }, PHASE_03_IBL_REFERENCE_WGSL);

    const cpu = evaluateDeterministicIblReference();
    const expected = [
      ...cpu.diffuse.irradiance,
      cpu.diffuse.sampleCount,
      ...cpu.diffuse.lambertianRadiance,
      Math.PI,
      ...cpu.specular.radiance,
      cpu.specular.sampleWeight,
      cpu.brdfLut.scale,
      cpu.brdfLut.bias,
      cpu.brdfLut.nDotV,
      cpu.brdfLut.roughness,
    ];
    expect(gpuResult.compilationMessages.filter((message) => message.type === 'error')).toEqual([]);
    expect(gpuResult.values).toHaveLength(expected.length);
    const absoluteDifferences = gpuResult.values.map((value, index) =>
      Math.abs(value - (expected[index] as number)),
    );
    absoluteDifferences.forEach((difference, index) => {
      expect(
        difference,
        `${outputLabels[index]}: CPU ${expected[index]}, GPU ${gpuResult.values[index]}`,
      ).toBeLessThanOrEqual(absoluteTolerances[index] as number);
    });

    const runtimeDirectory = path.resolve('test-results/phase-03/runtime');
    await mkdir(runtimeDirectory, { recursive: true });
    await writeFile(
      path.join(runtimeDirectory, 'ibl-reference.json'),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          phase: '03',
          checkpoint: 'P3-06',
          algorithm: {
            sequence: '64-point unsigned Hammersley / Van der Corput',
            diffuse: 'cosine-weighted physical irradiance plus E/pi Lambertian radiance',
            specular: 'GGX half-vector importance sampling with N dot L normalization',
            brdfLut: 'split-sum F0 scale and Fresnel bias using the P3-02 Smith visibility',
          },
          input: IBL_REFERENCE_INPUT,
          sampleCount: IBL_REFERENCE_SAMPLE_COUNT,
          outputLabels,
          cpu: expected,
          gpu: gpuResult.values,
          absoluteDifferences,
          maximumAbsoluteDifference: Math.max(...absoluteDifferences),
          referenceOutputAbsoluteTolerance,
          accumulatedWeightAbsoluteTolerance,
          absoluteTolerances,
          maximumToleranceRatio: Math.max(
            ...absoluteDifferences.map(
              (difference, index) => difference / (absoluteTolerances[index] as number),
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
});
