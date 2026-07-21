import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from '@playwright/test';

const runtimeDirectory = path.resolve('test-results/phase-02/runtime');

async function writeRuntimeJson(filename: string, value: unknown): Promise<void> {
  await mkdir(runtimeDirectory, { recursive: true });
  await writeFile(path.join(runtimeDirectory, filename), `${JSON.stringify(value, null, 2)}\n`);
}

test.describe('Phase 2 Scene Playground', () => {
  test('renders hierarchy, culling, transparent ordering, and camera interactions', async ({
    page,
  }) => {
    const runtimeErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') runtimeErrors.push(message.text());
    });
    page.on('pageerror', (error) => runtimeErrors.push(error.message));

    await page.setViewportSize({ height: 1000, width: 1440 });
    await page.goto('/acceptance/phase-02');
    await expect(page.getByTestId('phase-02-acceptance')).toBeVisible();
    await expect(page.getByTestId('backend-type')).toHaveText('webgpu', { timeout: 20_000 });
    await expect(page.getByTestId('renderer-state')).toHaveText('ready');
    await expect(page.getByTestId('shader-status')).toHaveText('pass');
    await expect(page.getByTestId('render-mode')).toHaveText('sleeping');
    await expect(page.getByTestId('fps')).toHaveText('0 · sleeping');
    await expect(page.getByTestId('backend-type')).toHaveAttribute('data-timestamp-query', 'true');
    await expect(page.getByTestId('gpu-frame-time')).toHaveText('unavailable · timestamp-query');
    const visibleCpuFrameTime = Number(
      await page.getByTestId('cpu-frame-time').getAttribute('data-milliseconds'),
    );
    expect(visibleCpuFrameTime).toBeGreaterThanOrEqual(0);
    expect(visibleCpuFrameTime).toBeLessThan(16.7);
    await expect(page.getByTestId('draw-calls')).toHaveText('6');
    await expect(page.getByTestId('triangles')).toHaveText('690');
    await expect(page.getByTestId('vertices')).toHaveText('2070');
    await expect(page.getByTestId('visible-count')).toHaveText('6');
    await expect(page.getByTestId('opaque-count')).toHaveText('4');
    await expect(page.getByTestId('transparent-count')).toHaveText('2');
    await expect(page.getByTestId('disabled-count')).toHaveText('1');
    await expect(page.getByTestId('hidden-count')).toHaveText('1');
    await expect(page.getByTestId('layer-culled-count')).toHaveText('1');
    await expect(page.getByTestId('frustum-culled-count')).toHaveText('1');
    await expect(page.getByTestId('gpu-mesh-count')).toHaveText('4');
    await expect(page.getByTestId('object-binding-count')).toHaveText('6');
    await expect(page.getByTestId('pipeline-count')).toHaveText('2');
    await expect(page.getByTestId('material-count')).toHaveText('4');
    await expect(page.getByTestId('resource-count')).toHaveText('25');
    await expect(page.getByTestId('buffer-memory')).toHaveAttribute('data-bytes', '6948');
    await expect(page.getByTestId('texture-memory')).toHaveAttribute('data-bytes', '2271360');
    await expect(page.getByTestId('hierarchy')).toHaveText('Root → Child');
    await expect(page.getByTestId('geometry-contract')).toHaveText(
      'Plane · Cube · Sphere · Custom',
    );
    await expect(page.getByTestId('entity-count')).toHaveText('10');

    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.fonts.check('400 16px "Kyxos Inter"'))).toBe(true);
    await page.addStyleTag({
      content: `
        *, *::before, *::after {
          animation: none !important;
          caret-color: transparent !important;
          transition: none !important;
        }

        .event-log time {
          visibility: hidden !important;
        }

        .dynamic-metric {
          visibility: hidden !important;
        }
      `,
    });
    const current = await page.screenshot({ animations: 'disabled', fullPage: true });
    const scene = await page.locator('[data-canvas="scene"]').screenshot({
      animations: 'disabled',
    });
    const visualDirectory = path.join(runtimeDirectory, 'visual');
    await mkdir(visualDirectory, { recursive: true });
    await Promise.all([
      writeFile(path.join(visualDirectory, 'current.png'), current),
      writeFile(path.join(visualDirectory, 'scene.png'), scene),
    ]);
    expect(scene).toMatchSnapshot('scene.png', { maxDiffPixels: 0, threshold: 0.2 });
    expect(current).toMatchSnapshot('reference.png', { maxDiffPixels: 0, threshold: 0.2 });

    const performanceMetrics = await page.evaluate(async () => {
      const wakeButton = document.querySelector<HTMLButtonElement>('[data-action="wake"]');
      const frameIndex = document.querySelector<HTMLElement>('[data-testid="frame-index"]');
      const renderMode = document.querySelector<HTMLElement>('[data-testid="render-mode"]');
      if (wakeButton === null || frameIndex === null || renderMode === null) {
        throw new Error('Phase 2 benchmark controls are unavailable.');
      }

      const dirtyToSleepSamples = [];
      const cpuFrameSamples = [];
      for (let sample = 0; sample < 10; sample += 1) {
        const previousFrame = frameIndex.textContent;
        const startedAt = performance.now();
        const frameCompleted = new Promise<void>((resolve, reject) => {
          const observer = new MutationObserver(() => {
            if (frameIndex.textContent !== previousFrame) {
              observer.disconnect();
              clearTimeout(timeout);
              resolve();
            }
          });
          const timeout = window.setTimeout(() => {
            observer.disconnect();
            reject(new Error('Phase 2 dirty-only frame did not complete within 1 second.'));
          }, 1_000);
          observer.observe(frameIndex, { characterData: true, childList: true, subtree: true });
        });

        wakeButton.click();
        await frameCompleted;
        dirtyToSleepSamples.push(performance.now() - startedAt);
        cpuFrameSamples.push(Number(frameIndex.dataset['cpuFrameTimeMs'] ?? Number.NaN));
        if (renderMode.textContent !== 'sleeping') {
          throw new Error('Phase 2 Renderer did not sleep after a dirty-only frame.');
        }
      }

      const round = (value: number) => Math.round(value * 1_000) / 1_000;
      const summarize = (values: number[]) => {
        if (values.some((value) => !Number.isFinite(value) || value < 0)) {
          throw new Error('Phase 2 Renderer reported an invalid timing sample.');
        }
        const sorted = [...values].sort((left, right) => left - right);
        return {
          maxMs: round(sorted.at(-1) ?? 0),
          medianMs: round(sorted[Math.floor(sorted.length / 2)] ?? 0),
          minMs: round(sorted[0] ?? 0),
          p95Ms: round(sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0),
          sampleCount: sorted.length,
        };
      };
      return {
        cpuFrameTimeMs: { budgetMs: 16.7, ...summarize(cpuFrameSamples) },
        dirtyToSleepMs: { budgetMs: 250, ...summarize(dirtyToSleepSamples) },
      };
    });
    expect(performanceMetrics.cpuFrameTimeMs.maxMs).toBeLessThan(
      performanceMetrics.cpuFrameTimeMs.budgetMs,
    );
    expect(performanceMetrics.dirtyToSleepMs.maxMs).toBeLessThan(
      performanceMetrics.dirtyToSleepMs.budgetMs,
    );
    await writeRuntimeJson('render-metrics.json', {
      schemaVersion: 1,
      phase: '02',
      route: '/acceptance/phase-02',
      environment: {
        backend: await page.getByTestId('backend-type').textContent(),
        devicePixelRatio: await page.evaluate(() => window.devicePixelRatio),
        viewport: await page.evaluate(() => ({
          height: window.innerHeight,
          width: window.innerWidth,
        })),
      },
      geometry: {
        contract: await page.getByTestId('geometry-contract').textContent(),
        customMesh: 'custom-tetrahedron',
      },
      scene: {
        entityCount: Number(await page.getByTestId('entity-count').textContent()),
        hierarchy: await page.getByTestId('hierarchy').textContent(),
      },
      submission: {
        drawCalls: Number(await page.getByTestId('draw-calls').textContent()),
        opaqueCount: Number(await page.getByTestId('opaque-count').textContent()),
        submittedVertices: Number(await page.getByTestId('vertices').textContent()),
        transparentCount: Number(await page.getByTestId('transparent-count').textContent()),
        transparentOrder: await page.getByTestId('transparent-order').textContent(),
        triangles: Number(await page.getByTestId('triangles').textContent()),
        visibleCount: Number(await page.getByTestId('visible-count').textContent()),
      },
      culling: {
        disabledCount: Number(await page.getByTestId('disabled-count').textContent()),
        frustumCulledCount: Number(await page.getByTestId('frustum-culled-count').textContent()),
        hiddenCount: Number(await page.getByTestId('hidden-count').textContent()),
        layerCulledCount: Number(await page.getByTestId('layer-culled-count').textContent()),
      },
      resources: {
        activeCount: Number(await page.getByTestId('resource-count').textContent()),
        activeEstimatedBufferBytes: Number(
          await page.getByTestId('buffer-memory').getAttribute('data-bytes'),
        ),
        gpuMeshCount: Number(await page.getByTestId('gpu-mesh-count').textContent()),
        objectBindingCount: Number(await page.getByTestId('object-binding-count').textContent()),
        materialCount: Number(await page.getByTestId('material-count').textContent()),
        pipelineCount: Number(await page.getByTestId('pipeline-count').textContent()),
        activeEstimatedTextureBytes: Number(
          await page.getByTestId('texture-memory').getAttribute('data-bytes'),
        ),
      },
      performance: {
        ...performanceMetrics,
        gpuFrameTimeMs: {
          capabilityAvailable:
            (await page.getByTestId('backend-type').getAttribute('data-timestamp-query')) ===
            'true',
          reason:
            'GPU timestamp instrumentation is not exposed through the Phase 2 public diagnostics contract.',
          status: 'NOT_AVAILABLE',
        },
      },
      shaderCompilation: await page.getByTestId('shader-status').textContent(),
    });

    for (const [focus, triangles] of [
      ['Plane', '2'],
      ['Cube', '12'],
      ['Sphere', '224'],
      ['Custom', '4'],
    ] as const) {
      await page.locator('[data-action="cycle-geometry"]').click();
      await expect(page.getByTestId('geometry-focus')).toHaveText(focus);
      await expect(page.getByTestId('visible-count')).toHaveText('1');
      await expect(page.getByTestId('draw-calls')).toHaveText('1');
      await expect(page.getByTestId('triangles')).toHaveText(triangles);
    }
    await page.locator('[data-action="cycle-geometry"]').click();
    await expect(page.getByTestId('geometry-focus')).toHaveText('All');
    await expect(page.getByTestId('visible-count')).toHaveText('6');
    await expect(page.getByTestId('draw-calls')).toHaveText('6');
    await expect(page.getByTestId('triangles')).toHaveText('690');

    await page.locator('[data-action="move-hierarchy"]').click();
    await expect(page.getByTestId('visible-count')).toHaveText('4');
    await expect(page.getByTestId('draw-calls')).toHaveText('4');
    await expect(page.getByTestId('frustum-culled-count')).toHaveText('3');
    await page.locator('[data-action="move-hierarchy"]').click();
    await expect(page.getByTestId('visible-count')).toHaveText('6');
    await expect(page.getByTestId('frustum-culled-count')).toHaveText('1');

    const initialOrder = await page.getByTestId('transparent-order').textContent();
    expect(initialOrder).toContain('Glass Far');
    expect(initialOrder).toContain('Glass Near');
    await page.locator('[data-action="swap-transparent"]').click();
    await expect(page.getByTestId('transparent-order')).not.toHaveText(initialOrder ?? '');

    const initialOrbit = await page.getByTestId('orbit-angle').textContent();
    await page.locator('[data-action="orbit-right"]').click();
    await expect(page.getByTestId('orbit-angle')).not.toHaveText(initialOrbit ?? '');
    await expect(page.getByTestId('render-mode')).toHaveText('sleeping');
    const initialDistance = await page.getByTestId('orbit-distance').textContent();
    await page.locator('[data-action="dolly-in"]').click();
    await expect(page.getByTestId('orbit-distance')).not.toHaveText(initialDistance ?? '');
    await expect(page.getByTestId('render-mode')).toHaveText('sleeping');

    const canvas = page.locator('[data-canvas="scene"]');
    await canvas.scrollIntoViewIfNeeded();
    const bounds = await canvas.boundingBox();
    if (bounds === null) throw new Error('The Phase 2 Scene Canvas has no bounds.');
    const pointerOrbit = await page.getByTestId('orbit-angle').textContent();
    await page.mouse.move(bounds.x + bounds.width * 0.5, bounds.y + bounds.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width * 0.62, bounds.y + bounds.height * 0.43, {
      steps: 4,
    });
    await page.mouse.up();
    await expect(page.getByTestId('orbit-angle')).not.toHaveText(pointerOrbit ?? '');
    const wheelDistance = await page.getByTestId('orbit-distance').textContent();
    await page.mouse.wheel(0, -160);
    await expect(page.getByTestId('orbit-distance')).not.toHaveText(wheelDistance ?? '');
    await expect(page.getByTestId('render-mode')).toHaveText('sleeping');

    await page.locator('[data-action="toggle-culling"]').click();
    await expect(page.getByTestId('culling-mode')).toHaveText('FRUSTUM OFF');
    await expect(page.getByTestId('frustum-culled-count')).toHaveText('0');
    await expect(page.getByTestId('visible-count')).toHaveText('7');
    await expect(page.getByTestId('draw-calls')).toHaveText('7');
    await expect(page.getByTestId('resource-count')).toHaveText('27');

    await page.locator('[data-action="toggle-layers"]').click();
    await expect(page.getByTestId('layer-culled-count')).toHaveText('0');
    await expect(page.getByTestId('visible-count')).toHaveText('8');
    await expect(page.getByTestId('draw-calls')).toHaveText('8');
    await expect(page.getByTestId('resource-count')).toHaveText('29');

    const beforeRotation = Number(await page.getByTestId('frame-index').textContent());
    await page.locator('[data-action="rotate-parent"]').click();
    await expect(page.getByTestId('frame-index')).toHaveText(String(beforeRotation + 1));
    await page.locator('[data-action="frame"]').click();
    await expect(page.getByTestId('render-mode')).toHaveText('sleeping');

    await page.locator('[data-action="hide"]').click();
    await expect(page.getByTestId('surface-size')).toHaveText('suspended');
    await expect(page.getByTestId('draw-calls')).toHaveText('0');
    await page.locator('[data-action="restore"]').click();
    await expect(page.getByTestId('surface-size')).toContainText('×');
    await expect(page.getByTestId('draw-calls')).toHaveText('8');
    expect(runtimeErrors).toEqual([]);
  });

  test('releases and recreates every Scene resource across Device Lost and disposal', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      colorScheme: 'dark',
      deviceScaleFactor: 2,
      viewport: { height: 900, width: 1280 },
    });
    const page = await context.newPage();
    const runtimeErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') runtimeErrors.push(message.text());
    });
    page.on('pageerror', (error) => runtimeErrors.push(error.message));
    const estimatedGpuBytes = async () =>
      Number(await page.getByTestId('buffer-memory').getAttribute('data-bytes')) +
      Number(await page.getByTestId('texture-memory').getAttribute('data-bytes'));

    try {
      await page.goto('/acceptance/phase-02');
      await expect(page.getByTestId('renderer-state')).toHaveText('ready', { timeout: 20_000 });
      await expect(page.getByTestId('dpr')).toHaveText('2.00');
      await expect(page.getByTestId('resource-count')).toHaveText('25');
      const initialSurface = await page.getByTestId('surface-size').textContent();
      const estimatedBytesReady = await estimatedGpuBytes();

      await page.locator('[data-action="lose"]').click();
      await expect(page.getByTestId('renderer-state')).toHaveText('lost');
      await expect(page.getByTestId('resource-count')).toHaveText('0');
      const resourcesAfterDeviceLoss = Number(
        await page.getByTestId('resource-count').textContent(),
      );
      const estimatedBytesAfterDeviceLoss = await estimatedGpuBytes();

      await page.locator('[data-action="recover"]').click();
      await expect(page.getByTestId('renderer-state')).toHaveText('ready');
      await expect(page.getByTestId('resource-count')).toHaveText('25');
      await expect(page.getByTestId('draw-calls')).toHaveText('6');
      const resourcesAfterRecovery = Number(await page.getByTestId('resource-count').textContent());
      const estimatedBytesAfterRecovery = await estimatedGpuBytes();

      await page.locator('[data-action="dispose"]').click();
      await expect(page.getByTestId('renderer-state')).toHaveText('disposed');
      await expect(page.getByTestId('resource-count')).toHaveText('0');
      const resourcesAfterDispose = Number(await page.getByTestId('resource-count').textContent());
      const estimatedBytesAfterDispose = await estimatedGpuBytes();

      await page.locator('[data-action="recreate"]').click();
      await expect(page.getByTestId('renderer-state')).toHaveText('ready');
      await expect(page.getByTestId('resource-count')).toHaveText('25');
      const resourcesAfterRecreate = Number(await page.getByTestId('resource-count').textContent());
      const estimatedBytesAfterRecreate = await estimatedGpuBytes();
      await page.locator('[data-action="dispose"]').click();
      await expect(page.getByTestId('resource-count')).toHaveText('0');
      const resourcesAfterFinalDispose = Number(
        await page.getByTestId('resource-count').textContent(),
      );
      const estimatedBytesAfterFinalDispose = await estimatedGpuBytes();
      expect(estimatedBytesReady).toBeGreaterThan(0);
      expect(estimatedBytesAfterDeviceLoss).toBe(0);
      expect(estimatedBytesAfterRecovery).toBe(estimatedBytesReady);
      expect(estimatedBytesAfterDispose).toBe(0);
      expect(estimatedBytesAfterRecreate).toBe(estimatedBytesReady);
      expect(estimatedBytesAfterFinalDispose).toBe(0);
      expect(runtimeErrors).toEqual([]);
      await writeRuntimeJson('lifecycle-metrics.json', {
        schemaVersion: 1,
        phase: '02',
        devicePixelRatio: 2,
        estimatedBytesAfterDeviceLoss,
        estimatedBytesAfterDispose,
        estimatedBytesAfterFinalDispose,
        estimatedBytesAfterRecovery,
        estimatedBytesAfterRecreate,
        estimatedBytesReady,
        initialSurface,
        resourceBaseline: 25,
        resourcesAfterDeviceLoss,
        resourcesAfterDispose,
        resourcesAfterFinalDispose,
        resourcesAfterRecovery,
        resourcesAfterRecreate,
        status:
          resourcesAfterDeviceLoss === 0 &&
          estimatedBytesAfterDeviceLoss === 0 &&
          resourcesAfterDispose === 0 &&
          estimatedBytesAfterDispose === 0 &&
          resourcesAfterFinalDispose === 0 &&
          estimatedBytesAfterFinalDispose === 0 &&
          resourcesAfterRecovery === 25 &&
          resourcesAfterRecreate === 25 &&
          estimatedBytesAfterRecovery === estimatedBytesReady &&
          estimatedBytesAfterRecreate === estimatedBytesReady
            ? 'PASS'
            : 'FAIL',
      });
    } finally {
      await context.close();
    }
  });

  test('fits without horizontal overflow at a compact viewport', async ({ page }) => {
    await page.setViewportSize({ height: 844, width: 390 });
    await page.goto('/acceptance/phase-02');
    await expect(page.getByTestId('renderer-state')).toHaveText('ready', { timeout: 20_000 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
