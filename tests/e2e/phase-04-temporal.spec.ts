import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { PHASE_04_CAMERA_REPROJECTION_REFERENCE_WGSL } from '../../packages/camera/src/generated/phase-04-camera-reprojection-reference.wgsl.js';
import {
  CAMERA_REPROJECTION_REFERENCE_CASES,
  CAMERA_REPROJECTION_REFERENCE_OUTPUT_FIELDS,
  evaluateDeterministicCameraReprojectionReference,
} from '../../packages/camera/src/index.js';
import { encodeFloat16, float16BitsToFloat32 } from '../../packages/environment/src/index.js';
import { identityMat4 } from '../../packages/math/src/index.js';
import { PHASE_04_TAA_RESOLVE_WGSL } from '../../packages/renderer/src/generated/phase-04-taa-resolve.wgsl.js';
import { PHASE_04_TAA_REFERENCE_WGSL } from '../../packages/temporal/src/generated/phase-04-taa-reference.wgsl.js';
import {
  TEMPORAL_TAA_DEFAULT_OPTIONS,
  TEMPORAL_TAA_REFERENCE_CASES,
  TEMPORAL_TAA_REFERENCE_OUTPUT_FIELDS,
  type TemporalTaaNeighborhood,
  type TemporalTaaRgba,
  type TemporalTaaVec3,
  evaluateDeterministicTemporalTaaReference,
  resolveTemporalTaa,
} from '../../packages/temporal/src/index.js';

const absoluteTolerance = 0.000001;
const cameraReprojectionAbsoluteTolerance = 0.00001;
const sampledResolveAbsoluteTolerance = 0.001;
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

  test('matches sampled Dynamic TAA resolve pixels through native WebGPU readback', async ({
    page,
  }) => {
    await page.goto('/acceptance/phase-01');
    const width = 3;
    const currentColors = [
      [0.25, 0.35, 0.45, 0.8],
      [0.3, 0.2, 0.5, 0.7],
      [0.4, 0.1, 0.3, 0.6],
    ] as const;
    const historyColors = [
      [0.29, 0.21, 0.48, 0.2],
      [0.35, 0.15, 0.45, 0.2],
      [0.35, 0.15, 0.4, 0.2],
    ] as const;
    const currentNormals = [
      [0.5, 0.5, 1, 1],
      [0.5, 0.5, 1, 1],
      [0.5, 0.5, 1, 1],
    ] as const;
    const historyNormals = [
      [0.6, 0.5, 0.99, 1],
      [0.6, 0.5, 0.99, 1],
      [0.5, 1, 0.5, 1],
    ] as const;
    const currentColorBits = Array.from(encodeFloat16(currentColors.flat()));
    const historyColorBits = Array.from(encodeFloat16(historyColors.flat()));
    const currentNormalBits = Array.from(encodeFloat16(currentNormals.flat()));
    const historyNormalBits = Array.from(encodeFloat16(historyNormals.flat()));
    const currentDepths = Array.from(new Float32Array([0.4, 0.4, 0.4]));
    const historyDepths = Array.from(new Float32Array([0.403, 0.45, 0.403]));
    const uniforms = new Float32Array(44);
    uniforms.set(identityMat4(), 0);
    uniforms.set(identityMat4(), 16);
    uniforms[32] = width;
    uniforms[33] = 1;
    uniforms[34] = 1;
    uniforms[35] = 0.5;
    uniforms[36] = TEMPORAL_TAA_DEFAULT_OPTIONS.baseHistoryWeight;
    uniforms[37] = TEMPORAL_TAA_DEFAULT_OPTIONS.depthAbsoluteThreshold;
    uniforms[38] = TEMPORAL_TAA_DEFAULT_OPTIONS.depthRelativeThreshold;
    uniforms[39] = TEMPORAL_TAA_DEFAULT_OPTIONS.normalRejectionCosine;
    uniforms[40] = TEMPORAL_TAA_DEFAULT_OPTIONS.responsiveHistoryReduction;

    const gpuResult = await page.evaluate(
      async ({
        currentColor,
        currentDepth,
        currentNormal,
        historyColor,
        historyDepth,
        historyNormal,
        source,
        uniformValues,
        viewportWidth,
      }) => {
        const adapter = await navigator.gpu?.requestAdapter();
        if (adapter === null || adapter === undefined)
          throw new Error('WebGPU adapter unavailable.');
        const device = await adapter.requestDevice();
        const textureUsage = {
          copyDestination: 0x02,
          copySource: 0x01,
          render: 0x10,
          sampled: 0x04,
        } as const;
        const bufferUsage = {
          copyDestination: 0x0008,
          mapRead: 0x0001,
          uniform: 0x0040,
        } as const;
        const createColorTexture = (label: string, usage: number) =>
          device.createTexture({
            format: 'rgba16float',
            label,
            size: { height: 1, width: viewportWidth },
            usage,
          });
        const createDepthTexture = (label: string) =>
          device.createTexture({
            format: 'depth32float',
            label,
            size: { height: 1, width: viewportWidth },
            usage: textureUsage.render | textureUsage.sampled,
          });
        const currentColorTexture = createColorTexture(
          'P4-07 Current Color',
          textureUsage.copyDestination | textureUsage.sampled,
        );
        const currentDepthTexture = createDepthTexture('P4-07 Current Depth');
        const currentNormalTexture = createColorTexture(
          'P4-07 Current Normal',
          textureUsage.copyDestination | textureUsage.sampled,
        );
        const historyColorTexture = createColorTexture(
          'P4-07 History Color',
          textureUsage.copyDestination | textureUsage.sampled,
        );
        const historyDepthTexture = createDepthTexture('P4-07 History Depth');
        const historyNormalTexture = createColorTexture(
          'P4-07 History Normal',
          textureUsage.copyDestination | textureUsage.sampled,
        );
        const target = createColorTexture(
          'P4-07 Resolved Color',
          textureUsage.copySource | textureUsage.render,
        );
        const uniformBuffer = device.createBuffer({
          label: 'P4-07 Resolve Uniforms',
          size: uniformValues.length * Float32Array.BYTES_PER_ELEMENT,
          usage: bufferUsage.copyDestination | bufferUsage.uniform,
        });
        const historyDepthUniform = device.createBuffer({
          label: 'P4-07 History Depth Values',
          size: 4 * Float32Array.BYTES_PER_ELEMENT,
          usage: bufferUsage.copyDestination | bufferUsage.uniform,
        });
        const readback = device.createBuffer({
          label: 'P4-07 Resolve Readback',
          size: 256,
          usage: bufferUsage.copyDestination | bufferUsage.mapRead,
        });
        const sampler = device.createSampler({
          addressModeU: 'clamp-to-edge',
          addressModeV: 'clamp-to-edge',
          magFilter: 'linear',
          minFilter: 'linear',
        });
        const module = device.createShaderModule({ code: source, label: 'P4-07 TAA Resolve' });
        const depthModule = device.createShaderModule({
          code: `
            struct DepthValues {
              values: vec4f,
            }

            struct VertexOutput {
              @builtin(position) position: vec4f,
            }

            @group(0) @binding(0) var<uniform> depthValues: DepthValues;

            @vertex
            fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
              let positions = array(
                vec2f(-1.0, -1.0),
                vec2f(3.0, -1.0),
                vec2f(-1.0, 3.0),
              );
              var output: VertexOutput;
              output.position = vec4f(positions[vertexIndex], 0.0, 1.0);
              return output;
            }

            @fragment
            fn fragmentMain(input: VertexOutput) -> @builtin(frag_depth) f32 {
              let pixel = min(u32(input.position.x), 2u);
              return depthValues.values[pixel];
            }
          `,
          label: 'P4-07 Depth Fixture',
        });

        try {
          const [compilation, depthCompilation] = await Promise.all([
            module.getCompilationInfo(),
            depthModule.getCompilationInfo(),
          ]);
          const compilationMessages = [
            ...compilation.messages.map((message) => ({ message, shader: 'resolve' })),
            ...depthCompilation.messages.map((message) => ({ message, shader: 'depth-fixture' })),
          ].map(({ message, shader }) => ({
            line: message.lineNum,
            message: message.message,
            shader,
            type: message.type,
          }));
          const errors = compilationMessages.filter((message) => message.type === 'error');
          if (errors.length > 0) throw new Error(JSON.stringify(errors));
          const colorLayout = { bytesPerRow: viewportWidth * 8, rowsPerImage: 1 };
          const extent = { depthOrArrayLayers: 1, height: 1, width: viewportWidth };
          device.queue.writeTexture(
            { texture: currentColorTexture },
            new Uint16Array(currentColor),
            colorLayout,
            extent,
          );
          device.queue.writeTexture(
            { texture: currentNormalTexture },
            new Uint16Array(currentNormal),
            colorLayout,
            extent,
          );
          device.queue.writeTexture(
            { texture: historyColorTexture },
            new Uint16Array(historyColor),
            colorLayout,
            extent,
          );
          device.queue.writeTexture(
            { texture: historyNormalTexture },
            new Uint16Array(historyNormal),
            colorLayout,
            extent,
          );
          device.queue.writeBuffer(uniformBuffer, 0, new Float32Array(uniformValues));
          device.queue.writeBuffer(historyDepthUniform, 0, new Float32Array([...historyDepth, 0]));
          const depthPipeline = await device.createRenderPipelineAsync({
            depthStencil: {
              depthCompare: 'always',
              depthWriteEnabled: true,
              format: 'depth32float',
            },
            fragment: { entryPoint: 'fragmentMain', module: depthModule, targets: [] },
            label: 'P4-07 Depth Fixture Pipeline',
            layout: 'auto',
            primitive: { topology: 'triangle-list' },
            vertex: { entryPoint: 'vertexMain', module: depthModule },
          });
          const depthBindGroup = device.createBindGroup({
            entries: [{ binding: 0, resource: { buffer: historyDepthUniform } }],
            layout: depthPipeline.getBindGroupLayout(0),
          });
          const pipeline = await device.createRenderPipelineAsync({
            fragment: { entryPoint: 'fragmentMain', module, targets: [{ format: 'rgba16float' }] },
            label: 'P4-07 TAA Resolve Pipeline',
            layout: 'auto',
            primitive: { topology: 'triangle-list' },
            vertex: { entryPoint: 'vertexMain', module },
          });
          const bindGroup = device.createBindGroup({
            entries: [
              { binding: 0, resource: { buffer: uniformBuffer } },
              { binding: 1, resource: currentColorTexture.createView() },
              { binding: 2, resource: currentDepthTexture.createView() },
              { binding: 3, resource: currentNormalTexture.createView() },
              { binding: 4, resource: historyColorTexture.createView() },
              { binding: 5, resource: historyDepthTexture.createView() },
              { binding: 6, resource: historyNormalTexture.createView() },
              { binding: 7, resource: sampler },
            ],
            layout: pipeline.getBindGroupLayout(0),
          });
          const encoder = device.createCommandEncoder();
          const currentDepthPass = encoder.beginRenderPass({
            colorAttachments: [],
            depthStencilAttachment: {
              depthClearValue: currentDepth[0] as number,
              depthLoadOp: 'clear',
              depthStoreOp: 'store',
              view: currentDepthTexture.createView(),
            },
          });
          currentDepthPass.end();
          const historyDepthPass = encoder.beginRenderPass({
            colorAttachments: [],
            depthStencilAttachment: {
              depthClearValue: 1,
              depthLoadOp: 'clear',
              depthStoreOp: 'store',
              view: historyDepthTexture.createView(),
            },
          });
          historyDepthPass.setPipeline(depthPipeline);
          historyDepthPass.setBindGroup(0, depthBindGroup);
          historyDepthPass.draw(3);
          historyDepthPass.end();
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
            extent,
          );
          device.queue.submit([encoder.finish()]);
          await readback.mapAsync(bufferUsage.mapRead);
          const pixelBits = Array.from(
            new Uint16Array(readback.getMappedRange()).slice(0, viewportWidth * 4),
          );
          readback.unmap();
          return { compilationMessages, pixelBits };
        } finally {
          currentColorTexture.destroy();
          currentDepthTexture.destroy();
          currentNormalTexture.destroy();
          historyColorTexture.destroy();
          historyDepthTexture.destroy();
          historyNormalTexture.destroy();
          target.destroy();
          uniformBuffer.destroy();
          historyDepthUniform.destroy();
          readback.destroy();
          device.destroy();
        }
      },
      {
        currentColor: currentColorBits,
        currentDepth: currentDepths,
        currentNormal: currentNormalBits,
        historyColor: historyColorBits,
        historyDepth: historyDepths,
        historyNormal: historyNormalBits,
        source: PHASE_04_TAA_RESOLVE_WGSL,
        uniformValues: Array.from(uniforms),
        viewportWidth: width,
      },
    );

    const decodePixels = (bits: readonly number[]): readonly TemporalTaaRgba[] =>
      Array.from({ length: width }, (_, pixel) =>
        [0, 1, 2, 3].map((channel) => float16BitsToFloat32(bits[pixel * 4 + channel] as number)),
      ) as unknown as TemporalTaaRgba[];
    const decodeNormal = (encoded: TemporalTaaRgba): TemporalTaaVec3 =>
      [encoded[0] * 2 - 1, encoded[1] * 2 - 1, encoded[2] * 2 - 1] as const;
    const decodedCurrent = decodePixels(currentColorBits);
    const decodedHistory = decodePixels(historyColorBits);
    const decodedCurrentNormals = decodePixels(currentNormalBits);
    const decodedHistoryNormals = decodePixels(historyNormalBits);
    const cpuResults = Array.from({ length: width }, (_, pixel) => {
      const neighborhood = Array.from({ length: 3 }, () =>
        [-1, 0, 1].map((offset) => {
          const sample = decodedCurrent[Math.max(0, Math.min(width - 1, pixel + offset))] as
            TemporalTaaRgba | undefined;
          if (sample === undefined) throw new Error('Missing Current Color sample.');
          return [sample[0], sample[1], sample[2]] as const;
        }),
      ).flat() as unknown as TemporalTaaNeighborhood;
      return resolveTemporalTaa({
        currentColor: decodedCurrent[pixel] as TemporalTaaRgba,
        currentDepth: currentDepths[pixel] as number,
        currentNormal: decodeNormal(decodedCurrentNormals[pixel] as TemporalTaaRgba),
        historyColor: decodedHistory[pixel] as TemporalTaaRgba,
        historyDepth: historyDepths[pixel] as number,
        historyNormal: decodeNormal(decodedHistoryNormals[pixel] as TemporalTaaRgba),
        historyValid: true,
        neighborhood,
        responsiveMask: 0.5,
      });
    });
    const expectedPixels = cpuResults.map(({ outputColor }) => outputColor);
    const gpuPixels = decodePixels(gpuResult.pixelBits);
    const absoluteDifferences = gpuPixels.map((pixel, pixelIndex) =>
      pixel.map((value, channel) =>
        Math.abs(value - (expectedPixels[pixelIndex]?.[channel] as number)),
      ),
    );

    expect(gpuResult.compilationMessages.filter((message) => message.type === 'error')).toEqual([]);
    expect(cpuResults.map(({ rejectionReason }) => rejectionReason)).toEqual([
      null,
      'depth',
      'normal',
    ]);
    absoluteDifferences.flat().forEach((difference) => {
      expect(difference).toBeLessThanOrEqual(sampledResolveAbsoluteTolerance);
    });

    const runtimeDirectory = path.resolve('test-results/phase-04/runtime');
    await mkdir(runtimeDirectory, { recursive: true });
    await writeFile(
      path.join(runtimeDirectory, 'taa-resolve-gpu.json'),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          phase: '04',
          checkpoint: 'P4-07',
          cases: ['accepted', 'depth-rejected', 'normal-rejected'],
          formats: {
            color: 'rgba16float',
            depth: 'depth32float',
            normal: 'rgba16float encoded minus-one through one',
          },
          cpuPixels: expectedPixels,
          gpuPixels,
          absoluteDifferences,
          maximumAbsoluteDifference: Math.max(...absoluteDifferences.flat()),
          absoluteTolerance: sampledResolveAbsoluteTolerance,
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
        const { DynamicTaaGpuHistory, DynamicTaaResolvePass } = (await import(
          /* @vite-ignore */ rendererUrl
        )) as typeof import('../../packages/renderer/src/index.js');
        const backend = createWebGpuBackend({ label: 'phase-04-offscreen-gate' });
        const history = new DynamicTaaGpuHistory({
          height: 2,
          ownerId: 'phase-04-offscreen-gate',
          width: 3,
        });
        const resolve = new DynamicTaaResolvePass({ ownerId: 'phase-04-offscreen-gate' });
        const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] as const;
        let shader: ReturnType<typeof backend.createShaderModule> | undefined;
        let pipeline: Awaited<ReturnType<typeof backend.createRenderPipeline>> | undefined;
        try {
          await backend.initialize();
          history.initialize(backend);
          await resolve.initialize(backend);
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
          const firstResolveStats = resolve.execute({
            currentInverseViewProjection: identity,
            frame: first,
            previousViewProjection: identity,
            responsiveMask: 0.5,
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
          const resizedResolveStats = resolve.execute({
            currentInverseViewProjection: identity,
            frame: third,
            previousViewProjection: identity,
            responsiveMask: 0.5,
          });
          await backend.waitForIdle();
          const resizedCommitted = history.commitFrame();
          const resolveDiagnostics = resolve.getDiagnostics();
          const resourcesBeforeResolveDispose = backend.getResourceStatistics();
          resolve.dispose();
          const resourcesBeforeHistoryDispose = backend.getResourceStatistics();
          history.dispose();
          const resourcesAfterHistoryDispose = backend.getResourceStatistics();

          return {
            checkpoint: 'P4-07',
            compilationMessages: compilation.messages,
            first: {
              historyValid: first.historyValid,
              resolveStatistics: firstResolveStats,
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
              resolveStatistics: resizedResolveStats,
              statistics: resizedStats,
            },
            resolveDiagnostics,
            resourcesAfterHistoryDispose,
            resourcesBeforeResolveDispose,
            resourcesBeforeHistoryDispose,
            status: 'PASS',
          };
        } finally {
          resolve.dispose();
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
      resolveStatistics: { drawCalls: 1, instances: 1, triangles: 1, vertices: 3 },
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
      resolveStatistics: { drawCalls: 1, instances: 1, triangles: 1, vertices: 3 },
      statistics: { drawCalls: 1, instances: 1, triangles: 1, vertices: 3 },
    });
    expect(result.resolveDiagnostics).toEqual({
      activeBindGroupCount: 1,
      executionCount: 2,
      ownerId: 'phase-04-offscreen-gate',
      resourceGeneration: 1,
      state: 'ready',
    });
    expect(result.resourcesBeforeResolveDispose).toMatchObject({
      activeCount: 14,
      byKind: {
        'bind-group': { activeCount: 1 },
        buffer: { activeCount: 1 },
        pipeline: { activeCount: 2 },
        sampler: { activeCount: 1 },
        'shader-module': { activeCount: 2 },
        texture: { activeCount: 7, activeEstimatedBytes: 960 },
      },
      createdTotal: 27,
      destroyedTotal: 13,
    });
    expect(result.resourcesBeforeHistoryDispose).toMatchObject({
      activeCount: 10,
      byKind: {
        pipeline: { activeCount: 1 },
        sampler: { activeCount: 1 },
        'shader-module': { activeCount: 1 },
        texture: { activeCount: 7, activeEstimatedBytes: 960 },
      },
      createdTotal: 27,
      destroyedTotal: 17,
    });
    expect(result.resourcesAfterHistoryDispose).toMatchObject({
      activeCount: 2,
      byKind: { sampler: { activeCount: 0 }, texture: { activeCount: 0 } },
      createdTotal: 27,
      destroyedTotal: 25,
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
