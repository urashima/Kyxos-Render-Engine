import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { ENVIRONMENT_CUBE_FACES, encodeFloat16 } from '../../packages/environment/src/index.js';

const shader = /* wgsl */ `
@group(0) @binding(0) var diffuseIrradiance: texture_cube<f32>;
@group(0) @binding(1) var cubeSampler: sampler;
@group(0) @binding(2) var specularPrefilter: texture_cube<f32>;
@group(0) @binding(3) var brdfLut: texture_2d<f32>;
@group(0) @binding(4) var brdfLutSampler: sampler;

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4f {
  let positions = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f(3.0, -1.0),
    vec2f(-1.0, 3.0),
  );
  return vec4f(positions[vertexIndex], 0.0, 1.0);
}

@fragment
fn fragmentMain() -> @location(0) vec4f {
  let direction = vec3f(1.0, 0.0, 0.0);
  let diffuse = textureSampleLevel(diffuseIrradiance, cubeSampler, direction, 0.0).rgb;
  let specular = textureSampleLevel(specularPrefilter, cubeSampler, direction, 1.0).rgb;
  let lut = textureSampleLevel(brdfLut, brdfLutSampler, vec2f(0.5), 0.0).rg;
  return vec4f(diffuse + specular + vec3f(lut, 0.0), 1.0);
}
`;

function cubeLevel(size: number, positiveX: readonly [number, number, number]): number[] {
  const values = new Float32Array(size * size * ENVIRONMENT_CUBE_FACES.length * 4);
  for (let face = 0; face < ENVIRONMENT_CUBE_FACES.length; face += 1) {
    for (let texel = 0; texel < size * size; texel += 1) {
      const offset = (face * size * size + texel) * 4;
      values[offset] = face === 0 ? positiveX[0] : 0;
      values[offset + 1] = face === 0 ? positiveX[1] : 0;
      values[offset + 2] = face === 0 ? positiveX[2] : 0;
      values[offset + 3] = 1;
    }
  }
  return Array.from(encodeFloat16(values));
}

test.describe('Phase 3 environment resource lifecycle', () => {
  test('samples rgba16float cube mips and rg16float BRDF LUT through explicit views', async ({
    page,
  }) => {
    await page.goto('/acceptance/phase-01');
    const gpuResult = await page.evaluate(
      async ({ brdf, diffuse, source, specularMip0, specularMip1 }) => {
        const adapter = await navigator.gpu?.requestAdapter();
        if (adapter === null || adapter === undefined)
          throw new Error('WebGPU adapter unavailable.');
        const device = await adapter.requestDevice();
        const module = device.createShaderModule({
          code: source,
          label: 'P3-07 environment views',
        });
        const compilation = await module.getCompilationInfo();
        const compilationMessages = compilation.messages.map((message) => ({
          line: message.lineNum,
          message: message.message,
          type: message.type,
        }));
        const errors = compilationMessages.filter((message) => message.type === 'error');
        if (errors.length > 0) throw new Error(JSON.stringify(errors));

        const textureUsage = {
          copyDestination: 0x02,
          copySource: 0x01,
          render: 0x10,
          sampled: 0x04,
        };
        const bufferUsage = { copyDestination: 0x0008, mapRead: 0x0001 };
        const diffuseTexture = device.createTexture({
          format: 'rgba16float',
          label: 'P3-07 diffuse cube',
          size: { depthOrArrayLayers: 6, height: 1, width: 1 },
          usage: textureUsage.copyDestination | textureUsage.sampled,
        });
        const specularTexture = device.createTexture({
          format: 'rgba16float',
          label: 'P3-07 specular cube',
          mipLevelCount: 2,
          size: { depthOrArrayLayers: 6, height: 2, width: 2 },
          usage: textureUsage.copyDestination | textureUsage.sampled,
        });
        const lutTexture = device.createTexture({
          format: 'rg16float',
          label: 'P3-07 BRDF LUT',
          size: { height: 1, width: 1 },
          usage: textureUsage.copyDestination | textureUsage.sampled,
        });
        const target = device.createTexture({
          format: 'rgba8unorm',
          label: 'P3-07 output',
          size: { height: 1, width: 1 },
          usage: textureUsage.copySource | textureUsage.render,
        });
        const readback = device.createBuffer({
          label: 'P3-07 readback',
          size: 256,
          usage: bufferUsage.copyDestination | bufferUsage.mapRead,
        });
        try {
          device.queue.writeTexture(
            { texture: diffuseTexture },
            new Uint16Array(diffuse),
            { bytesPerRow: 8, rowsPerImage: 1 },
            { depthOrArrayLayers: 6, height: 1, width: 1 },
          );
          device.queue.writeTexture(
            { mipLevel: 0, texture: specularTexture },
            new Uint16Array(specularMip0),
            { bytesPerRow: 16, rowsPerImage: 2 },
            { depthOrArrayLayers: 6, height: 2, width: 2 },
          );
          device.queue.writeTexture(
            { mipLevel: 1, texture: specularTexture },
            new Uint16Array(specularMip1),
            { bytesPerRow: 8, rowsPerImage: 1 },
            { depthOrArrayLayers: 6, height: 1, width: 1 },
          );
          device.queue.writeTexture(
            { texture: lutTexture },
            new Uint16Array(brdf),
            { bytesPerRow: 4, rowsPerImage: 1 },
            { height: 1, width: 1 },
          );
          const pipeline = await device.createRenderPipelineAsync({
            fragment: { entryPoint: 'fragmentMain', module, targets: [{ format: 'rgba8unorm' }] },
            label: 'P3-07 environment pipeline',
            layout: 'auto',
            primitive: { topology: 'triangle-list' },
            vertex: { entryPoint: 'vertexMain', module },
          });
          const cubeSampler = device.createSampler({
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
            addressModeW: 'clamp-to-edge',
            magFilter: 'linear',
            minFilter: 'linear',
            mipmapFilter: 'linear',
          });
          const lutSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
          const bindGroup = device.createBindGroup({
            entries: [
              { binding: 0, resource: diffuseTexture.createView({ dimension: 'cube' }) },
              { binding: 1, resource: cubeSampler },
              { binding: 2, resource: specularTexture.createView({ dimension: 'cube' }) },
              { binding: 3, resource: lutTexture.createView({ dimension: '2d' }) },
              { binding: 4, resource: lutSampler },
            ],
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
          pass.draw(3);
          pass.end();
          encoder.copyTextureToBuffer(
            { texture: target },
            { buffer: readback, bytesPerRow: 256, rowsPerImage: 1 },
            { height: 1, width: 1 },
          );
          device.queue.submit([encoder.finish()]);
          await readback.mapAsync(bufferUsage.mapRead);
          const pixel = Array.from(new Uint8Array(readback.getMappedRange()).slice(0, 4));
          readback.unmap();
          return { compilationMessages, pixel };
        } finally {
          diffuseTexture.destroy();
          specularTexture.destroy();
          lutTexture.destroy();
          target.destroy();
          readback.destroy();
          device.destroy();
        }
      },
      {
        brdf: Array.from(encodeFloat16(new Float32Array([0.1, 0.2]))),
        diffuse: cubeLevel(1, [0.1, 0.2, 0.3]),
        source: shader,
        specularMip0: cubeLevel(2, [0.01, 0.01, 0.01]),
        specularMip1: cubeLevel(1, [0.05, 0.04, 0.03]),
      },
    );

    const expectedPixel = [64, 112, 84, 255];
    expect(gpuResult.compilationMessages.filter((message) => message.type === 'error')).toEqual([]);
    expect(gpuResult.pixel).toEqual(expectedPixel);

    const runtimeDirectory = path.resolve('test-results/phase-03/runtime');
    await mkdir(runtimeDirectory, { recursive: true });
    await writeFile(
      path.join(runtimeDirectory, 'environment-resources.json'),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          phase: '03',
          checkpoint: 'P3-07',
          cubeFaceOrder: ENVIRONMENT_CUBE_FACES,
          formats: {
            diffuseIrradiance: 'rgba16float cube / one level',
            specularPrefilter: 'rgba16float cube / complete two-level mip chain',
            brdfLut: 'rg16float 2d',
          },
          expectedPixel,
          gpuPixel: gpuResult.pixel,
          compilationMessages: gpuResult.compilationMessages,
          status: 'PASS',
        },
        null,
        2,
      )}\n`,
    );
  });
});
