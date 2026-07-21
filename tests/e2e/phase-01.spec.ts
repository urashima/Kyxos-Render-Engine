import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from '@playwright/test';

const runtimeDirectory = path.resolve('test-results/phase-01/runtime');

async function writeRuntimeJson(filename: string, value: unknown): Promise<void> {
  await mkdir(runtimeDirectory, { recursive: true });
  await writeFile(path.join(runtimeDirectory, filename), `${JSON.stringify(value, null, 2)}\n`);
}

test.describe('Phase 1 WebGPU Playground', () => {
  test('compiles WGSL and renders distinct triangle and sphere frames', async ({ page }) => {
    const runtimeErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') runtimeErrors.push(message.text());
    });
    page.on('pageerror', (error) => runtimeErrors.push(error.message));

    await page.setViewportSize({ height: 1000, width: 1440 });
    await page.goto('/acceptance/phase-01');
    await expect(page.getByTestId('phase-01-acceptance')).toBeVisible();
    await expect(page.getByTestId('backend-type')).toHaveText('webgpu', { timeout: 20_000 });
    await expect(page.getByTestId('renderer-state')).toHaveText('ready');
    await expect(page.getByTestId('shader-status')).toHaveText('pass');
    await expect(page.getByTestId('resource-count')).toHaveText('6');
    await expect(page.getByTestId('pipeline-count')).toHaveText('1');
    await expect(page.getByTestId('draw-calls')).toHaveText('1');
    await expect(page.getByTestId('triangles')).toHaveText('1');
    await expect(page.getByTestId('render-mode')).toHaveText('sleeping');
    const triangle = await page.locator('[data-canvas="a"]').screenshot();
    const triangleMetrics = {
      drawCalls: Number(await page.getByTestId('draw-calls').textContent()),
      submittedVertices: Number(await page.getByTestId('vertices').textContent()),
      triangles: Number(await page.getByTestId('triangles').textContent()),
    };

    await page.locator('[data-action="sphere"]').click();
    await expect(page.getByTestId('primitive')).toHaveText('SPHERE');
    await expect(page.getByTestId('triangles')).toHaveText('1024');
    await expect(page.getByTestId('vertices')).toHaveText('3072');
    await expect(page.getByTestId('render-mode')).toHaveText('sleeping');
    const sphere = await page.locator('[data-canvas="a"]').screenshot();
    const sphereMetrics = {
      drawCalls: Number(await page.getByTestId('draw-calls').textContent()),
      submittedVertices: Number(await page.getByTestId('vertices').textContent()),
      triangles: Number(await page.getByTestId('triangles').textContent()),
    };

    expect(sphere.equals(triangle)).toBe(false);
    expect(runtimeErrors).toEqual([]);

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
      `,
    });
    const current = await page.screenshot({ animations: 'disabled', fullPage: true });
    const visualDirectory = path.join(runtimeDirectory, 'visual');
    await mkdir(visualDirectory, { recursive: true });
    await Promise.all([
      writeFile(path.join(visualDirectory, 'current.png'), current),
      writeFile(path.join(visualDirectory, 'sphere.png'), sphere),
      writeFile(path.join(visualDirectory, 'triangle.png'), triangle),
    ]);
    expect(triangle).toMatchSnapshot('triangle.png', { maxDiffPixels: 0, threshold: 0.2 });
    expect(sphere).toMatchSnapshot('sphere.png', { maxDiffPixels: 0, threshold: 0.2 });
    expect(current).toMatchSnapshot('reference.png', { maxDiffPixels: 0, threshold: 0.2 });

    const staticToSleep = await page.evaluate(async () => {
      const wakeButton = document.querySelector<HTMLButtonElement>('[data-action="wake"]');
      const frameIndex = document.querySelector<HTMLElement>('[data-testid="frame-index"]');
      const renderMode = document.querySelector<HTMLElement>('[data-testid="render-mode"]');
      if (wakeButton === null || frameIndex === null || renderMode === null) {
        throw new Error('Phase 1 benchmark controls are unavailable.');
      }

      const samples = [];
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
            reject(new Error('WebGPU dirty-only frame did not complete within 1 second.'));
          }, 1_000);
          observer.observe(frameIndex, { characterData: true, childList: true, subtree: true });
        });

        wakeButton.click();
        await frameCompleted;
        samples.push(performance.now() - startedAt);
        cpuFrameSamples.push(Number(frameIndex.dataset['cpuFrameTimeMs'] ?? Number.NaN));
        if (renderMode.textContent !== 'sleeping') {
          throw new Error('WebGPU Renderer did not return to sleeping after a dirty-only frame.');
        }
      }

      const round = (value: number) => Math.round(value * 1_000) / 1_000;
      const summarize = (values: number[]) => {
        if (values.some((value) => !Number.isFinite(value) || value < 0)) {
          throw new Error('Renderer reported an invalid CPU frame time.');
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
        budgetMs: 250,
        ...summarize(samples),
        cpuFrameTimeMs: {
          budgetMs: 16.7,
          ...summarize(cpuFrameSamples),
        },
      };
    });
    expect(staticToSleep.maxMs).toBeLessThan(staticToSleep.budgetMs);
    expect(staticToSleep.cpuFrameTimeMs.maxMs).toBeLessThan(staticToSleep.cpuFrameTimeMs.budgetMs);

    const bufferMemory = page.getByTestId('buffer-memory');
    await expect(bufferMemory).toHaveAttribute('data-bytes', '26448');
    const timestampQueryAvailable =
      (await page.getByTestId('backend-type').getAttribute('data-timestamp-query')) === 'true';
    const renderMetrics = {
      schemaVersion: 1,
      phase: '01',
      route: '/acceptance/phase-01',
      environment: {
        backend: await page.getByTestId('backend-type').textContent(),
        devicePixelRatio: await page.evaluate(() => window.devicePixelRatio),
        viewport: await page.evaluate(() => ({
          height: window.innerHeight,
          width: window.innerWidth,
        })),
      },
      shaderCompilation: await page.getByTestId('shader-status').textContent(),
      geometry: { sphere: sphereMetrics, triangle: triangleMetrics },
      resources: {
        activeCount: Number(await page.getByTestId('resource-count').textContent()),
        activeEstimatedBufferBytes: Number(await bufferMemory.getAttribute('data-bytes')),
        pipelineCount: Number(await page.getByTestId('pipeline-count').textContent()),
      },
      performance: {
        cpuDirtyToSleepMs: {
          budgetMs: staticToSleep.budgetMs,
          maxMs: staticToSleep.maxMs,
          medianMs: staticToSleep.medianMs,
          minMs: staticToSleep.minMs,
          p95Ms: staticToSleep.p95Ms,
          sampleCount: staticToSleep.sampleCount,
        },
        cpuFrameTimeMs: staticToSleep.cpuFrameTimeMs,
        gpuFrameTimeMs: {
          capabilityAvailable: timestampQueryAvailable,
          status: 'NOT_AVAILABLE',
          reason:
            'GPU timestamp instrumentation is not exposed through the Phase 1 public diagnostics contract.',
        },
      },
    };
    await Promise.all([
      writeRuntimeJson('render-metrics.json', renderMetrics),
      writeRuntimeJson('static-to-sleep.json', staticToSleep),
    ]);
  });

  test('handles Resize, suspension, Canvas switching, Device Lost, recovery, and disposal', async ({
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

    try {
      await page.goto('/acceptance/phase-01');
      await expect(page.getByTestId('renderer-state')).toHaveText('ready', { timeout: 20_000 });
      await expect(page.getByTestId('dpr')).toHaveText('2.00');
      await expect(page.getByTestId('surface-size')).toContainText('×');
      const initialSurface = await page.getByTestId('surface-size').textContent();

      await page.locator('[data-action="hide"]').click();
      await expect(page.getByTestId('surface-size')).toHaveText('suspended');
      await expect(page.getByTestId('canvas-status')).toHaveText('A · suspended');
      await expect(page.getByTestId('draw-calls')).toHaveText('0');

      await page.locator('[data-action="restore"]').click();
      await expect(page.getByTestId('surface-size')).toContainText('×');
      await expect(page.getByTestId('draw-calls')).toHaveText('1');

      await page.locator('[data-action="switch"]').click();
      await expect(page.getByTestId('active-canvas')).toHaveText('B');
      await expect(page.getByTestId('renderer-state')).toHaveText('ready');
      await expect(page.getByTestId('resource-count')).toHaveText('6');

      await page.locator('[data-action="lose"]').click();
      await expect(page.getByTestId('renderer-state')).toHaveText('lost');
      await expect(page.getByTestId('resource-count')).toHaveText('0');
      const resourcesAfterDeviceLoss = Number(
        await page.getByTestId('resource-count').textContent(),
      );

      await page.locator('[data-action="recover"]').click();
      await expect(page.getByTestId('renderer-state')).toHaveText('ready');
      await expect(page.getByTestId('resource-count')).toHaveText('6');
      await expect(page.getByTestId('draw-calls')).toHaveText('1');

      await page.locator('[data-action="dispose"]').click();
      await expect(page.getByTestId('renderer-state')).toHaveText('disposed');
      await expect(page.getByTestId('resource-count')).toHaveText('0');
      const resourcesAfterDispose = Number(await page.getByTestId('resource-count').textContent());

      await page.locator('[data-action="recreate"]').click();
      await expect(page.getByTestId('renderer-state')).toHaveText('ready');
      await expect(page.getByTestId('resource-count')).toHaveText('6');
      const resourcesAfterRecreate = Number(await page.getByTestId('resource-count').textContent());
      await page.locator('[data-action="dispose"]').click();
      await expect(page.getByTestId('resource-count')).toHaveText('0');
      const resourcesAfterFinalDispose = Number(
        await page.getByTestId('resource-count').textContent(),
      );
      expect(runtimeErrors).toEqual([]);

      await writeRuntimeJson('lifecycle-metrics.json', {
        schemaVersion: 1,
        phase: '01',
        devicePixelRatio: 2,
        initialSurface,
        resourceBaseline: 6,
        resourcesAfterDeviceLoss,
        resourcesAfterDispose,
        resourcesAfterFinalDispose,
        resourcesAfterRecreate,
        status:
          resourcesAfterDeviceLoss === 0 &&
          resourcesAfterDispose === 0 &&
          resourcesAfterFinalDispose === 0 &&
          resourcesAfterRecreate === 6
            ? 'PASS'
            : 'FAIL',
      });
    } finally {
      await context.close();
    }
  });
});
