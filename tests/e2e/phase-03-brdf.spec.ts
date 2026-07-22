import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { evaluateMetallicRoughnessBrdf } from '../../packages/material-pbr/src/brdf.js';
import { PHASE_03_BRDF_REFERENCE_WGSL } from '../../packages/material-pbr/src/generated/phase-03-brdf-reference.wgsl.js';
import { PbrMaterial } from '../../packages/material-pbr/src/pbr-material.js';
import { identityMat4 } from '../../packages/math/src/index.js';
import { PHASE_03_PBR_DIRECT_WGSL } from '../../packages/renderer/src/generated/phase-03-pbr-direct.wgsl.js';
import {
  createPbrDirectionalLight,
  packPbrObjectUniforms,
} from '../../packages/renderer/src/pbr-gpu-layout.js';

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

  test('renders direct-light PBR into an RGBA8 target with CPU-reference pixel parity', async ({
    page,
  }) => {
    await page.goto('/acceptance/phase-01');
    const material = new PbrMaterial({
      baseColorFactor: [0.8, 0.3, 0.1, 1],
      metallicFactor: 0,
      roughnessFactor: 0.5,
    });
    const uniforms = packPbrObjectUniforms({
      cameraPosition: [0, 0, 5],
      light: createPbrDirectionalLight({ direction: [0, 0, 1], intensity: 2 }),
      material: material.snapshot(),
      viewProjectionMatrix: identityMat4(),
      worldMatrix: identityMat4(),
    });
    uniforms.fill(0, 16, 32);
    uniforms[31] = 1;

    const gpuResult = await page.evaluate(
      async ({ source, uniformValues }) => {
        const adapter = await navigator.gpu?.requestAdapter();
        if (adapter === null || adapter === undefined)
          throw new Error('WebGPU adapter unavailable.');
        const device = await adapter.requestDevice();
        const module = device.createShaderModule({ code: source, label: 'Phase 3 direct PBR' });
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
          mapRead: 0x0001,
          uniform: 0x0040,
          vertex: 0x0020,
        } as const;
        const textureUsage = { copySource: 0x01, renderAttachment: 0x10 } as const;
        const vertices = new Float32Array([
          -1, -1, 0, 0, 0, 1, 3, -1, 0, 0, 0, 1, -1, 3, 0, 0, 0, 1,
        ]);
        const vertexBuffer = device.createBuffer({
          label: 'Phase 3 direct PBR vertices',
          size: vertices.byteLength,
          usage: bufferUsage.copyDestination | bufferUsage.vertex,
        });
        const uniformBuffer = device.createBuffer({
          label: 'Phase 3 direct PBR uniforms',
          size: uniformValues.length * Float32Array.BYTES_PER_ELEMENT,
          usage: bufferUsage.copyDestination | bufferUsage.uniform,
        });
        const target = device.createTexture({
          format: 'rgba8unorm',
          label: 'Phase 3 direct PBR target',
          size: [4, 4],
          usage: textureUsage.copySource | textureUsage.renderAttachment,
        });
        const bytesPerRow = 256;
        const readback = device.createBuffer({
          label: 'Phase 3 direct PBR readback',
          size: bytesPerRow * 4,
          usage: bufferUsage.copyDestination | bufferUsage.mapRead,
        });
        try {
          device.queue.writeBuffer(vertexBuffer, 0, vertices);
          device.queue.writeBuffer(uniformBuffer, 0, new Float32Array(uniformValues));
          const pipeline = await device.createRenderPipelineAsync({
            fragment: {
              entryPoint: 'fragmentOpaque',
              module,
              targets: [{ format: 'rgba8unorm' }],
            },
            label: 'Phase 3 direct PBR pipeline',
            layout: 'auto',
            primitive: { cullMode: 'none', topology: 'triangle-list' },
            vertex: {
              buffers: [
                {
                  arrayStride: 24,
                  attributes: [
                    { format: 'float32x3', offset: 0, shaderLocation: 0 },
                    { format: 'float32x3', offset: 12, shaderLocation: 1 },
                  ],
                },
              ],
              entryPoint: 'vertexMain',
              module,
            },
          });
          const bindGroup = device.createBindGroup({
            entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
            layout: pipeline.getBindGroupLayout(0),
          });
          const encoder = device.createCommandEncoder();
          const pass = encoder.beginRenderPass({
            colorAttachments: [
              {
                clearValue: { a: 0, b: 0, g: 0, r: 0 },
                loadOp: 'clear',
                storeOp: 'store',
                view: target.createView(),
              },
            ],
          });
          pass.setPipeline(pipeline);
          pass.setBindGroup(0, bindGroup);
          pass.setVertexBuffer(0, vertexBuffer);
          pass.draw(3);
          pass.end();
          encoder.copyTextureToBuffer(
            { texture: target },
            { buffer: readback, bytesPerRow, rowsPerImage: 4 },
            { height: 4, width: 4 },
          );
          device.queue.submit([encoder.finish()]);
          await readback.mapAsync(bufferUsage.mapRead);
          const offset = 2 * bytesPerRow + 2 * 4;
          const pixel = Array.from(
            new Uint8Array(readback.getMappedRange()).slice(offset, offset + 4),
          );
          readback.unmap();
          return { compilationMessages, pixel };
        } finally {
          vertexBuffer.destroy();
          uniformBuffer.destroy();
          target.destroy();
          readback.destroy();
          device.destroy();
        }
      },
      { source: PHASE_03_PBR_DIRECT_WGSL, uniformValues: Array.from(uniforms) },
    );

    const cpu = evaluateMetallicRoughnessBrdf({
      baseColor: [0.8, 0.3, 0.1],
      metallic: 0,
      nDotH: 1,
      nDotL: 1,
      nDotV: 1,
      roughness: 0.5,
      vDotH: 1,
    });
    const expectedPixel = [...cpu.total.map((channel) => Math.round(channel * 2 * 255)), 255];
    expect(gpuResult.compilationMessages.filter((message) => message.type === 'error')).toEqual([]);
    gpuResult.pixel.forEach((channel, index) => {
      const expected = expectedPixel[index] as number;
      expect(
        Math.abs(channel - expected),
        `direct PBR pixel channel ${index}: expected ${expected}, received ${channel}`,
      ).toBeLessThanOrEqual(2);
    });

    const runtimeDirectory = path.resolve('test-results/phase-03/runtime');
    await mkdir(runtimeDirectory, { recursive: true });
    await writeFile(
      path.join(runtimeDirectory, 'pbr-direct-renderer.json'),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          phase: '03',
          checkpoint: 'P3-03',
          compilationMessages: gpuResult.compilationMessages,
          expectedPixel,
          gpuPixel: gpuResult.pixel,
          uniformByteLength: uniforms.byteLength,
          status: 'PASS',
        },
        null,
        2,
      )}\n`,
    );
  });
});
