import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { srgbToLinearRgba } from '../../packages/material-core/src/color.js';
import {
  createMaterialTextureBinding,
  createMaterialTextureReference,
} from '../../packages/material-core/src/texture.js';
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
        const textureUsage = {
          copyDestination: 0x02,
          copySource: 0x01,
          renderAttachment: 0x10,
          sampled: 0x04,
        } as const;
        const vertices = new Float32Array([
          -1, -1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 3, -1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, -1, 3, 0, 0, 0,
          1, 0, 0, 1, 0, 0, 1,
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
        const baseColorTexture = device.createTexture({
          format: 'rgba8unorm-srgb',
          label: 'Phase 3 direct PBR white base color',
          size: [1, 1],
          usage: textureUsage.copyDestination | textureUsage.sampled,
        });
        const metallicRoughnessTexture = device.createTexture({
          format: 'rgba8unorm',
          label: 'Phase 3 direct PBR white metallic roughness',
          size: [1, 1],
          usage: textureUsage.copyDestination | textureUsage.sampled,
        });
        const fallbackSampler = device.createSampler({
          magFilter: 'linear',
          minFilter: 'linear',
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
          const white = new Uint8Array([255, 255, 255, 255]);
          device.queue.writeTexture(
            { texture: baseColorTexture },
            white,
            { bytesPerRow: 4, rowsPerImage: 1 },
            { height: 1, width: 1 },
          );
          device.queue.writeTexture(
            { texture: metallicRoughnessTexture },
            white,
            { bytesPerRow: 4, rowsPerImage: 1 },
            { height: 1, width: 1 },
          );
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
                  arrayStride: 48,
                  attributes: [
                    { format: 'float32x3', offset: 0, shaderLocation: 0 },
                    { format: 'float32x3', offset: 12, shaderLocation: 1 },
                    { format: 'float32x2', offset: 24, shaderLocation: 2 },
                    { format: 'float32x4', offset: 32, shaderLocation: 3 },
                  ],
                },
              ],
              entryPoint: 'vertexMain',
              module,
            },
          });
          const bindGroup = device.createBindGroup({
            entries: [
              { binding: 0, resource: { buffer: uniformBuffer } },
              { binding: 1, resource: baseColorTexture.createView() },
              { binding: 2, resource: fallbackSampler },
              { binding: 3, resource: metallicRoughnessTexture.createView() },
              { binding: 4, resource: fallbackSampler },
              { binding: 5, resource: metallicRoughnessTexture.createView() },
              { binding: 6, resource: fallbackSampler },
              { binding: 7, resource: baseColorTexture.createView() },
              { binding: 8, resource: fallbackSampler },
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
          baseColorTexture.destroy();
          metallicRoughnessTexture.destroy();
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

  test('samples sRGB base color and linear G/B metallic-roughness maps with UV transforms', async ({
    page,
  }) => {
    await page.goto('/acceptance/phase-01');
    const baseColorFactor = [0.8, 0.7, 0.6, 0.5] as const;
    const metallicFactor = 0.8;
    const roughnessFactor = 0.6;
    const baseColorTexel = [128, 64, 32, 128] as const;
    const metallicRoughnessTexel = [0, 128, 64, 255] as const;
    const baseColorPixels = new Uint8Array([
      255,
      0,
      0,
      255,
      ...baseColorTexel,
      0,
      255,
      0,
      255,
      0,
      0,
      255,
      255,
    ]);
    const metallicRoughnessPixels = new Uint8Array([
      0,
      255,
      255,
      255,
      0,
      255,
      0,
      255,
      ...metallicRoughnessTexel,
      0,
      0,
      255,
      255,
    ]);
    const material = new PbrMaterial({
      alphaMode: 'blend',
      baseColorFactor,
      metallicFactor,
      roughnessFactor,
      textures: {
        'base-color': createMaterialTextureBinding({
          offset: [0.5, 0],
          texture: createMaterialTextureReference({ id: 'base', transferFunction: 'srgb' }),
        }),
        'metallic-roughness': createMaterialTextureBinding({
          offset: [0, 0.5],
          texture: createMaterialTextureReference({ id: 'mr', transferFunction: 'linear' }),
        }),
      },
    });
    const uniforms = packPbrObjectUniforms({
      cameraPosition: [0, 0, 5],
      light: createPbrDirectionalLight({ direction: [0, 0, 1], intensity: 1 }),
      material: material.snapshot(),
      viewProjectionMatrix: identityMat4(),
      worldMatrix: identityMat4(),
    });
    uniforms.fill(0, 16, 32);
    uniforms[31] = 1;

    const gpuResult = await page.evaluate(
      async ({ basePixels, metallicRoughnessPixels: mrPixels, source, uniformValues }) => {
        const adapter = await navigator.gpu?.requestAdapter();
        if (adapter === null || adapter === undefined)
          throw new Error('WebGPU adapter unavailable.');
        const device = await adapter.requestDevice();
        const module = device.createShaderModule({
          code: source,
          label: 'Phase 3 PBR factor maps',
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
          mapRead: 0x0001,
          uniform: 0x0040,
          vertex: 0x0020,
        } as const;
        const textureUsage = {
          copyDestination: 0x02,
          copySource: 0x01,
          renderAttachment: 0x10,
          sampled: 0x04,
        } as const;
        const vertices = new Float32Array([
          -1, -1, 0, 0, 0, 1, 0.25, 0.25, 1, 0, 0, 1, 3, -1, 0, 0, 0, 1, 0.25, 0.25, 1, 0, 0, 1, -1,
          3, 0, 0, 0, 1, 0.25, 0.25, 1, 0, 0, 1,
        ]);
        const vertexBuffer = device.createBuffer({
          label: 'Phase 3 factor-map vertices',
          size: vertices.byteLength,
          usage: bufferUsage.copyDestination | bufferUsage.vertex,
        });
        const uniformBuffer = device.createBuffer({
          label: 'Phase 3 factor-map uniforms',
          size: uniformValues.length * Float32Array.BYTES_PER_ELEMENT,
          usage: bufferUsage.copyDestination | bufferUsage.uniform,
        });
        const baseColorTexture = device.createTexture({
          format: 'rgba8unorm-srgb',
          label: 'Phase 3 sRGB base color',
          size: [2, 2],
          usage: textureUsage.copyDestination | textureUsage.sampled,
        });
        const metallicRoughnessTexture = device.createTexture({
          format: 'rgba8unorm',
          label: 'Phase 3 linear metallic roughness',
          size: [2, 2],
          usage: textureUsage.copyDestination | textureUsage.sampled,
        });
        const sampler = device.createSampler({
          addressModeU: 'clamp-to-edge',
          addressModeV: 'clamp-to-edge',
          magFilter: 'nearest',
          minFilter: 'nearest',
        });
        const target = device.createTexture({
          format: 'rgba8unorm',
          label: 'Phase 3 factor-map target',
          size: [4, 4],
          usage: textureUsage.copySource | textureUsage.renderAttachment,
        });
        const bytesPerRow = 256;
        const readback = device.createBuffer({
          label: 'Phase 3 factor-map readback',
          size: bytesPerRow * 4,
          usage: bufferUsage.copyDestination | bufferUsage.mapRead,
        });
        try {
          device.queue.writeBuffer(vertexBuffer, 0, vertices);
          device.queue.writeBuffer(uniformBuffer, 0, new Float32Array(uniformValues));
          device.queue.writeTexture(
            { texture: baseColorTexture },
            new Uint8Array(basePixels),
            { bytesPerRow: 8, rowsPerImage: 2 },
            { height: 2, width: 2 },
          );
          device.queue.writeTexture(
            { texture: metallicRoughnessTexture },
            new Uint8Array(mrPixels),
            { bytesPerRow: 8, rowsPerImage: 2 },
            { height: 2, width: 2 },
          );
          const pipeline = await device.createRenderPipelineAsync({
            fragment: {
              entryPoint: 'fragmentBlend',
              module,
              targets: [{ format: 'rgba8unorm' }],
            },
            label: 'Phase 3 factor-map pipeline',
            layout: 'auto',
            primitive: { cullMode: 'none', topology: 'triangle-list' },
            vertex: {
              buffers: [
                {
                  arrayStride: 48,
                  attributes: [
                    { format: 'float32x3', offset: 0, shaderLocation: 0 },
                    { format: 'float32x3', offset: 12, shaderLocation: 1 },
                    { format: 'float32x2', offset: 24, shaderLocation: 2 },
                    { format: 'float32x4', offset: 32, shaderLocation: 3 },
                  ],
                },
              ],
              entryPoint: 'vertexMain',
              module,
            },
          });
          const bindGroup = device.createBindGroup({
            entries: [
              { binding: 0, resource: { buffer: uniformBuffer } },
              { binding: 1, resource: baseColorTexture.createView() },
              { binding: 2, resource: sampler },
              { binding: 3, resource: metallicRoughnessTexture.createView() },
              { binding: 4, resource: sampler },
              { binding: 5, resource: metallicRoughnessTexture.createView() },
              { binding: 6, resource: sampler },
              { binding: 7, resource: baseColorTexture.createView() },
              { binding: 8, resource: sampler },
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
          baseColorTexture.destroy();
          metallicRoughnessTexture.destroy();
          target.destroy();
          readback.destroy();
          device.destroy();
        }
      },
      {
        basePixels: Array.from(baseColorPixels),
        metallicRoughnessPixels: Array.from(metallicRoughnessPixels),
        source: PHASE_03_PBR_DIRECT_WGSL,
        uniformValues: Array.from(uniforms),
      },
    );

    const decodedBaseColor = srgbToLinearRgba(
      baseColorTexel.map((channel) => channel / 255) as unknown as readonly [
        number,
        number,
        number,
        number,
      ],
    );
    const finalBaseColor = [
      decodedBaseColor[0] * baseColorFactor[0],
      decodedBaseColor[1] * baseColorFactor[1],
      decodedBaseColor[2] * baseColorFactor[2],
    ] as const;
    const metallic = metallicFactor * (metallicRoughnessTexel[2] / 255);
    const roughness = roughnessFactor * (metallicRoughnessTexel[1] / 255);
    const cpu = evaluateMetallicRoughnessBrdf({
      baseColor: finalBaseColor,
      metallic,
      nDotH: 1,
      nDotL: 1,
      nDotV: 1,
      roughness,
      vDotH: 1,
    });
    const expectedPixel = [
      ...cpu.total.map((channel) => Math.round(Math.min(1, channel) * 255)),
      Math.round(decodedBaseColor[3] * baseColorFactor[3] * 255),
    ];
    expect(gpuResult.compilationMessages.filter((message) => message.type === 'error')).toEqual([]);
    gpuResult.pixel.forEach((channel, index) => {
      const expected = expectedPixel[index] as number;
      expect(
        Math.abs(channel - expected),
        `factor-map pixel channel ${index}: expected ${expected}, received ${channel}`,
      ).toBeLessThanOrEqual(2);
    });

    const runtimeDirectory = path.resolve('test-results/phase-03/runtime');
    await mkdir(runtimeDirectory, { recursive: true });
    await writeFile(
      path.join(runtimeDirectory, 'pbr-texture-renderer.json'),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          phase: '03',
          checkpoint: 'P3-04',
          semantics: {
            baseColor: 'RGBA sRGB decoded before factor multiplication',
            metallicRoughness: 'linear G=roughness B=metallic',
          },
          uv: {
            input: [0.25, 0.25],
            baseColorOffset: [0.5, 0],
            metallicRoughnessOffset: [0, 0.5],
          },
          selectedTexels: { baseColorTexel, metallicRoughnessTexel },
          effectiveMaterial: { finalBaseColor, metallic, roughness },
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

  test('applies tangent-space Normal Y direction and sRGB Emission strength', async ({ page }) => {
    await page.goto('/acceptance/phase-01');
    const baseColor = [0.5, 0.4, 0.3] as const;
    const normalTexel = [128, 255, 128, 255] as const;
    const emissiveTexel = [64, 128, 255, 255] as const;
    const emissiveFactor = [0.5, 0.25, 0.75] as const;
    const emissiveStrength = 2;
    const normalBinding = createMaterialTextureBinding({
      texture: createMaterialTextureReference({ id: 'normal', transferFunction: 'linear' }),
    });
    const emissiveBinding = createMaterialTextureBinding({
      texture: createMaterialTextureReference({ id: 'emissive', transferFunction: 'srgb' }),
    });
    const normalMaterial = new PbrMaterial({
      baseColorFactor: [...baseColor, 1],
      metallicFactor: 0,
      roughnessFactor: 0.6,
      textures: { normal: normalBinding },
    });
    const emissiveMaterial = new PbrMaterial({
      baseColorFactor: [0, 0, 0, 1],
      emissiveFactor,
      emissiveStrength,
      textures: { emissive: emissiveBinding },
    });
    const pack = (
      material: PbrMaterial,
      lightIntensity: number,
      normalYDirection: 'down' | 'up' = 'up',
    ): Float32Array => {
      return packPbrObjectUniforms({
        cameraPosition: [0, 0, 5],
        light: createPbrDirectionalLight({ direction: [0, 1, 0], intensity: lightIntensity }),
        material: material.snapshot(),
        normalYDirection,
        viewProjectionMatrix: identityMat4(),
        worldMatrix: identityMat4(),
      });
    };
    const upUniforms = pack(normalMaterial, 1, 'up');
    const downUniforms = pack(normalMaterial, 1, 'down');
    const emissiveUniforms = pack(emissiveMaterial, 0);

    const gpuResult = await page.evaluate(
      async ({
        downUniformValues,
        emissivePixel,
        emissiveUniformValues,
        normalPixel,
        source,
        upUniformValues,
      }) => {
        const adapter = await navigator.gpu?.requestAdapter();
        if (adapter === null || adapter === undefined)
          throw new Error('WebGPU adapter unavailable.');
        const device = await adapter.requestDevice();
        const module = device.createShaderModule({
          code: source,
          label: 'Phase 3 Normal and Emission maps',
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
          mapRead: 0x0001,
          uniform: 0x0040,
          vertex: 0x0020,
        } as const;
        const textureUsage = {
          copyDestination: 0x02,
          copySource: 0x01,
          renderAttachment: 0x10,
          sampled: 0x04,
        } as const;
        const vertices = new Float32Array([
          -1, -1, 0, 0, 0, 1, 0.5, 0.5, 1, 0, 0, 1, 3, -1, 0, 0, 0, 1, 0.5, 0.5, 1, 0, 0, 1, -1, 3,
          0, 0, 0, 1, 0.5, 0.5, 1, 0, 0, 1,
        ]);
        const vertexBuffer = device.createBuffer({
          label: 'Phase 3 Normal and Emission vertices',
          size: vertices.byteLength,
          usage: bufferUsage.copyDestination | bufferUsage.vertex,
        });
        const baseColorTexture = device.createTexture({
          format: 'rgba8unorm-srgb',
          label: 'Phase 3 Normal and Emission white base color',
          size: [1, 1],
          usage: textureUsage.copyDestination | textureUsage.sampled,
        });
        const metallicRoughnessTexture = device.createTexture({
          format: 'rgba8unorm',
          label: 'Phase 3 Normal and Emission white metallic roughness',
          size: [1, 1],
          usage: textureUsage.copyDestination | textureUsage.sampled,
        });
        const normalTexture = device.createTexture({
          format: 'rgba8unorm',
          label: 'Phase 3 tangent-space Normal',
          size: [1, 1],
          usage: textureUsage.copyDestination | textureUsage.sampled,
        });
        const emissiveTexture = device.createTexture({
          format: 'rgba8unorm-srgb',
          label: 'Phase 3 sRGB Emission',
          size: [1, 1],
          usage: textureUsage.copyDestination | textureUsage.sampled,
        });
        const sampler = device.createSampler({ magFilter: 'nearest', minFilter: 'nearest' });
        const pipeline = await device.createRenderPipelineAsync({
          fragment: {
            entryPoint: 'fragmentOpaque',
            module,
            targets: [{ format: 'rgba8unorm' }],
          },
          label: 'Phase 3 Normal and Emission pipeline',
          layout: 'auto',
          primitive: { cullMode: 'none', topology: 'triangle-list' },
          vertex: {
            buffers: [
              {
                arrayStride: 48,
                attributes: [
                  { format: 'float32x3', offset: 0, shaderLocation: 0 },
                  { format: 'float32x3', offset: 12, shaderLocation: 1 },
                  { format: 'float32x2', offset: 24, shaderLocation: 2 },
                  { format: 'float32x4', offset: 32, shaderLocation: 3 },
                ],
              },
            ],
            entryPoint: 'vertexMain',
            module,
          },
        });
        const white = new Uint8Array([255, 255, 255, 255]);
        device.queue.writeBuffer(vertexBuffer, 0, vertices);
        for (const [texture, pixels] of [
          [baseColorTexture, white],
          [metallicRoughnessTexture, white],
          [normalTexture, new Uint8Array(normalPixel)],
          [emissiveTexture, new Uint8Array(emissivePixel)],
        ] as const) {
          device.queue.writeTexture(
            { texture },
            pixels,
            { bytesPerRow: 4, rowsPerImage: 1 },
            { height: 1, width: 1 },
          );
        }

        const render = async (uniformValues: number[]): Promise<number[]> => {
          const uniformBuffer = device.createBuffer({
            label: 'Phase 3 Normal and Emission uniforms',
            size: uniformValues.length * Float32Array.BYTES_PER_ELEMENT,
            usage: bufferUsage.copyDestination | bufferUsage.uniform,
          });
          const target = device.createTexture({
            format: 'rgba8unorm',
            label: 'Phase 3 Normal and Emission target',
            size: [1, 1],
            usage: textureUsage.copySource | textureUsage.renderAttachment,
          });
          const readback = device.createBuffer({
            label: 'Phase 3 Normal and Emission readback',
            size: 256,
            usage: bufferUsage.copyDestination | bufferUsage.mapRead,
          });
          try {
            device.queue.writeBuffer(uniformBuffer, 0, new Float32Array(uniformValues));
            const bindGroup = device.createBindGroup({
              entries: [
                { binding: 0, resource: { buffer: uniformBuffer } },
                { binding: 1, resource: baseColorTexture.createView() },
                { binding: 2, resource: sampler },
                { binding: 3, resource: metallicRoughnessTexture.createView() },
                { binding: 4, resource: sampler },
                { binding: 5, resource: normalTexture.createView() },
                { binding: 6, resource: sampler },
                { binding: 7, resource: emissiveTexture.createView() },
                { binding: 8, resource: sampler },
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
            pass.setVertexBuffer(0, vertexBuffer);
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
            return pixel;
          } finally {
            uniformBuffer.destroy();
            target.destroy();
            readback.destroy();
          }
        };

        try {
          return {
            compilationMessages,
            downPixel: await render(downUniformValues),
            emissivePixel: await render(emissiveUniformValues),
            upPixel: await render(upUniformValues),
          };
        } finally {
          vertexBuffer.destroy();
          baseColorTexture.destroy();
          metallicRoughnessTexture.destroy();
          normalTexture.destroy();
          emissiveTexture.destroy();
          device.destroy();
        }
      },
      {
        downUniformValues: Array.from(downUniforms),
        emissivePixel: Array.from(emissiveTexel),
        emissiveUniformValues: Array.from(emissiveUniforms),
        normalPixel: Array.from(normalTexel),
        source: PHASE_03_PBR_DIRECT_WGSL,
        upUniformValues: Array.from(upUniforms),
      },
    );

    const tangentNormal = normalTexel.slice(0, 3).map((channel) => (channel / 255) * 2 - 1);
    const tangentNormalLength = Math.hypot(...tangentNormal);
    const worldNormal = tangentNormal.map((channel) => channel / tangentNormalLength);
    const worldY = worldNormal[1] ?? 0;
    const worldZ = worldNormal[2] ?? 0;
    const inverseSqrtTwo = 1 / Math.sqrt(2);
    const cpu = evaluateMetallicRoughnessBrdf({
      baseColor,
      metallic: 0,
      nDotH: Math.max(0, worldY * inverseSqrtTwo + worldZ * inverseSqrtTwo),
      nDotL: Math.max(0, worldY),
      nDotV: Math.max(0, worldZ),
      roughness: 0.6,
      vDotH: inverseSqrtTwo,
    });
    const expectedUpPixel = [
      ...cpu.total.map((channel) => Math.round(Math.min(1, channel * worldY) * 255)),
      255,
    ];
    const expectedDownPixel = [0, 0, 0, 255];
    const decodedEmission = srgbToLinearRgba(
      emissiveTexel.map((channel) => channel / 255) as unknown as readonly [
        number,
        number,
        number,
        number,
      ],
    );
    const expectedEmissivePixel = [
      ...decodedEmission
        .slice(0, 3)
        .map((channel, index) =>
          Math.round(
            Math.min(1, channel * (emissiveFactor[index] as number) * emissiveStrength) * 255,
          ),
        ),
      255,
    ];
    expect(gpuResult.compilationMessages.filter((message) => message.type === 'error')).toEqual([]);
    for (const [label, actual, expected] of [
      ['normal Y-up', gpuResult.upPixel, expectedUpPixel],
      ['normal Y-down', gpuResult.downPixel, expectedDownPixel],
      ['emission', gpuResult.emissivePixel, expectedEmissivePixel],
    ] as const) {
      actual.forEach((channel, index) => {
        expect(
          Math.abs(channel - (expected[index] as number)),
          `${label} channel ${index}: expected ${expected[index]}, received ${channel}`,
        ).toBeLessThanOrEqual(2);
      });
    }

    const runtimeDirectory = path.resolve('test-results/phase-03/runtime');
    await mkdir(runtimeDirectory, { recursive: true });
    await writeFile(
      path.join(runtimeDirectory, 'pbr-normal-emission.json'),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          phase: '03',
          checkpoint: 'P3-05',
          semantics: {
            normal: 'tangent-space RGB with tangent.w handedness and explicit Y direction',
            emission: 'sRGB decoded before factor and strength multiplication',
          },
          inputs: { baseColor, emissiveFactor, emissiveStrength, emissiveTexel, normalTexel },
          compilationMessages: gpuResult.compilationMessages,
          expectedPixels: {
            normalYUp: expectedUpPixel,
            normalYDown: expectedDownPixel,
            emission: expectedEmissivePixel,
          },
          gpuPixels: {
            normalYUp: gpuResult.upPixel,
            normalYDown: gpuResult.downPixel,
            emission: gpuResult.emissivePixel,
          },
          uniformByteLength: upUniforms.byteLength,
          status: 'PASS',
        },
        null,
        2,
      )}\n`,
    );
  });
});
