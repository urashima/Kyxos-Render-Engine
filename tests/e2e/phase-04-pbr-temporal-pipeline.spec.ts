import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from '@playwright/test';

const backendModuleUrl = `/@fs${path.resolve('packages/backend-webgpu/src/index.ts')}`;
const sdkModuleUrl = `/@fs${path.resolve('packages/sdk/src/index.ts')}`;
const temporalPbrModuleUrl = `/@fs${path.resolve('packages/sdk/src/temporal-pbr.ts')}`;
const testingModuleUrl = `/@fs${path.resolve('packages/testing/src/index.ts')}`;

test.describe('Phase 4 native PBR temporal pipeline', () => {
  test('runs scheduler-driven PBR MRT, Dynamic TAA, Static Accumulation, Present, and Sleep', async ({
    page,
  }) => {
    const runtimeErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') runtimeErrors.push(message.text());
    });
    page.on('pageerror', (error) => runtimeErrors.push(error.message));
    await page.goto('/acceptance/phase-01');

    const result = await page.evaluate(
      async ({ backendUrl, sdkUrl, temporalPbrUrl, testingUrl }) => {
        const { createWebGpuBackend } = (await import(
          /* @vite-ignore */ backendUrl
        )) as typeof import('../../packages/backend-webgpu/src/index.js');
        const { MeshRendererStore, PerspectiveCamera, Scene, createCubeGeometry } = (await import(
          /* @vite-ignore */ sdkUrl
        )) as typeof import('../../packages/sdk/src/index.js');
        const { TemporalFrameScheduler, TemporalPbrRenderFeature } = (await import(
          /* @vite-ignore */ temporalPbrUrl
        )) as typeof import('../../packages/sdk/src/temporal-pbr.js');
        const { ManualFrameDriver } = (await import(
          /* @vite-ignore */ testingUrl
        )) as typeof import('../../packages/testing/src/index.js');

        const backend = createWebGpuBackend({ label: 'phase-04-native-temporal-pbr' });
        const scene = new Scene();
        const camera = new PerspectiveCamera({ aspect: 1 });
        const meshRenderers = new MeshRendererStore(scene);
        meshRenderers.attach(scene.createEntity(), { mesh: createCubeGeometry() });
        const canvas = document.createElement('canvas');
        canvas.dataset['testid'] = 'phase-04-native-temporal-pbr';
        document.body.append(canvas);
        const feature = new TemporalPbrRenderFeature({
          camera,
          frustumCulling: false,
          height: 64,
          meshRenderers,
          output: { exposure: 0, toneMapping: 'khronos-pbr-neutral' },
          ownerId: 'phase-04-native-temporal-pbr',
          scene,
          signature: () => ({
            camera: camera.revision,
            device: 1,
            environment: 1,
            geometry: scene.revision,
            lighting: 1,
            materials: 1,
            postProcess: 1,
            scene: scene.revision,
            viewport: 1,
          }),
          surface: {
            cssHeight: 64,
            cssWidth: 64,
            devicePixelRatio: 1,
            target: canvas,
          },
          targetSamples: 2,
          width: 64,
        });
        const driver = new ManualFrameDriver();
        const frames: {
          dirtyFlags: readonly string[];
          mode: string;
          sampleIndex: number;
          statistics: ReturnType<typeof feature.render>;
        }[] = [];
        let frameIndex = 0;
        const scheduler = new TemporalFrameScheduler({
          convergence: { targetSamples: 2 },
          driver,
          onFrame: (frame) => {
            const statistics = feature.render({
              backend,
              dirtyFlags: frame.dirtyFlags,
              frameIndex,
              temporal: frame.temporal,
              timestamp: frame.timestamp,
            });
            frameIndex += 1;
            if (frame.temporal.mode === 'accumulating') scheduler.reportConvergence(0);
            frames.push({
              dirtyFlags: frame.dirtyFlags,
              mode: frame.temporal.mode,
              sampleIndex: frame.temporal.sampleIndex,
              statistics,
            });
          },
          stabilizationMs: 0,
        });

        try {
          await backend.initialize();
          await feature.initialize({ backend });
          scheduler.invalidate('camera');
          let timestamp = 0;
          let flushCount = 0;
          while (driver.pendingCount > 0 && flushCount < 8) {
            driver.flush(timestamp);
            timestamp += 1;
            flushCount += 1;
          }
          await backend.waitForIdle();

          const schedulerDiagnostics = scheduler.getDiagnostics();
          const featureDiagnostics = feature.getDiagnostics();
          const resourcesBeforeDispose = backend.getResourceStatistics();
          const canvasSize = { height: canvas.height, width: canvas.width };

          scheduler.dispose();
          feature.dispose();
          const resourcesAfterFeatureDispose = backend.getResourceStatistics();
          meshRenderers.dispose();
          camera.dispose();
          scene.dispose();
          canvas.remove();
          backend.dispose();

          return {
            canvasSize,
            feature: {
              pbr: featureDiagnostics.pbr,
              pipeline: {
                dynamicSamples: featureDiagnostics.pipeline.dynamicHistory.history.sampleCount,
                presentExecutions: featureDiagnostics.pipeline.present.executionCount,
                state: featureDiagnostics.pipeline.state,
                staticConvergence: featureDiagnostics.pipeline.staticHistory.convergence,
                staticSamples: featureDiagnostics.pipeline.staticHistory.history.sampleCount,
              },
            },
            flushCount,
            frames,
            resourcesAfterFeatureDispose,
            resourcesBeforeDispose,
            scheduler: schedulerDiagnostics,
          };
        } finally {
          scheduler.dispose();
          feature.dispose();
          meshRenderers.dispose();
          camera.dispose();
          scene.dispose();
          canvas.remove();
          backend.dispose();
        }
      },
      {
        backendUrl: backendModuleUrl,
        sdkUrl: sdkModuleUrl,
        temporalPbrUrl: temporalPbrModuleUrl,
        testingUrl: testingModuleUrl,
      },
    );

    expect(result.flushCount).toBe(4);
    expect(result.canvasSize).toEqual({ height: 64, width: 64 });
    expect(result.frames.map(({ mode, sampleIndex }) => ({ mode, sampleIndex }))).toEqual([
      { mode: 'interactive', sampleIndex: 0 },
      { mode: 'stabilizing', sampleIndex: 0 },
      { mode: 'accumulating', sampleIndex: 1 },
      { mode: 'accumulating', sampleIndex: 2 },
    ]);
    expect(result.frames.map(({ statistics }) => statistics)).toEqual([
      { drawCalls: 3, instances: 3, triangles: 14, vertices: 42 },
      { drawCalls: 3, instances: 3, triangles: 14, vertices: 42 },
      { drawCalls: 4, instances: 4, triangles: 15, vertices: 45 },
      { drawCalls: 4, instances: 4, triangles: 15, vertices: 45 },
    ]);
    expect(result.scheduler).toMatchObject({
      convergence: { converged: true, reason: 'sample-limit', sampleCount: 2 },
      mode: 'sleeping',
      pending: false,
    });
    expect(result.feature).toMatchObject({
      pbr: { outputTarget: 'dynamic-taa', pipelineCount: 12 },
      pipeline: {
        dynamicSamples: 4,
        presentExecutions: 4,
        state: 'ready',
        staticConvergence: { converged: true, reason: 'sample-limit', sampleCount: 2 },
        staticSamples: 2,
      },
    });
    expect(result.resourcesBeforeDispose.byKind).toMatchObject({
      surface: { activeCount: 1 },
    });
    expect(result.resourcesAfterFeatureDispose.activeCount).toBe(0);
    expect(runtimeErrors).toEqual([]);

    const runtimeDirectory = path.resolve('test-results/phase-04/runtime');
    await mkdir(runtimeDirectory, { recursive: true });
    await writeFile(
      path.join(runtimeDirectory, 'pbr-temporal-pipeline.json'),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          phase: '04',
          checkpoint: 'P4-11',
          ...result,
          status: 'PASS',
        },
        null,
        2,
      )}\n`,
    );
  });
});
