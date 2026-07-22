import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from '@playwright/test';

const runtimeDirectory = path.resolve('test-results/phase-03/runtime');

async function writeRuntimeJson(filename: string, value: unknown): Promise<void> {
  await mkdir(runtimeDirectory, { recursive: true });
  await writeFile(path.join(runtimeDirectory, filename), `${JSON.stringify(value, null, 2)}\n`);
}

async function readyResourceCount(page: import('@playwright/test').Page): Promise<number> {
  await expect(page.getByTestId('renderer-state')).toHaveText('ready', { timeout: 20_000 });
  await expect(page.getByTestId('resource-verdict')).toHaveText('stable');
  return Number(await page.getByTestId('resource-count').textContent());
}

test.describe('Phase 3 fixed PBR material gallery', () => {
  test('renders the fixed matrix and keeps interactive material controls resource-stable', async ({
    page,
  }) => {
    const runtimeErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') runtimeErrors.push(message.text());
    });
    page.on('pageerror', (error) => runtimeErrors.push(error.message));
    await page.setViewportSize({ height: 1100, width: 1440 });
    await page.goto('/acceptance/phase-03');
    await expect(page.getByTestId('phase-03-acceptance')).toBeVisible();
    const resourceBaseline = await readyResourceCount(page);

    await expect(page.getByTestId('backend-type')).toHaveText('webgpu');
    await expect(page.getByTestId('shader-status')).toHaveText('pass');
    await expect(page.getByTestId('render-mode')).toHaveText('sleeping');
    await expect(page.getByTestId('draw-calls')).toHaveText('20');
    await expect(page.getByTestId('triangles')).toHaveText('10560');
    await expect(page.getByTestId('visible-count')).toHaveText('20');
    await expect(page.getByTestId('gpu-mesh-count')).toHaveText('1');
    await expect(page.getByTestId('object-binding-count')).toHaveText('20');
    await expect(page.getByTestId('pipeline-count')).toHaveText('12');
    await expect(page.getByTestId('material-count')).toHaveText('20');
    await expect(page.getByTestId('texture-count')).toHaveText('6');
    await expect(page.getByTestId('environment-identity')).toHaveText('fixed-studio');
    expect(resourceBaseline).toBeGreaterThan(0);
    expect(Number(await page.getByTestId('gpu-bytes').getAttribute('data-bytes'))).toBeGreaterThan(
      0,
    );

    await page.evaluate(() => document.fonts.ready);
    await page.addStyleTag({
      content: `
        *, *::before, *::after {
          animation: none !important;
          caret-color: transparent !important;
          transition: none !important;
        }
        [data-testid="commit-sha"],
        [data-testid="cpu-frame-time"],
        [data-testid="frame-index"] {
          visibility: hidden !important;
        }
      `,
    });
    const current = await page.screenshot({ animations: 'disabled', fullPage: true });
    const gallery = await page.locator('[data-canvas="pbr"]').screenshot({
      animations: 'disabled',
    });
    const visualDirectory = path.join(runtimeDirectory, 'gallery-visual');
    await mkdir(visualDirectory, { recursive: true });
    await Promise.all([
      writeFile(path.join(visualDirectory, 'current.png'), current),
      writeFile(path.join(visualDirectory, 'gallery.png'), gallery),
    ]);

    const frameIndex = page.getByTestId('frame-index');
    const changeRange = async (control: string, value: string) => {
      const previous = Number(await frameIndex.textContent());
      await page.locator(`[data-control="${control}"]`).fill(value);
      await expect(frameIndex).toHaveText(String(previous + 1));
      await expect(page.getByTestId('render-mode')).toHaveText('sleeping');
      await expect(page.getByTestId('resource-count')).toHaveText(String(resourceBaseline));
    };
    await changeRange('metallic', '0.85');
    await changeRange('roughness', '0.2');
    await changeRange('exposure', '1');
    await expect(page.getByTestId('exposure-value')).toHaveText('1.00');
    await changeRange('rotation', '90');
    await expect(page.getByTestId('rotation-value')).toHaveText('90°');

    for (const [action, testId, value] of [
      ['normal', 'normal-direction', 'Y-down'],
      ['ao', 'ao-state', 'off'],
      ['tone-map', 'tone-map-mode', 'clamp'],
    ] as const) {
      const previous = Number(await frameIndex.textContent());
      await page.locator(`[data-action="${action}"]`).click();
      await expect(page.getByTestId(testId)).toHaveText(value);
      await expect(frameIndex).toHaveText(String(previous + 1));
      await expect(page.getByTestId('resource-count')).toHaveText(String(resourceBaseline));
    }

    const performanceMetrics = await page.evaluate(async () => {
      const wake = document.querySelector<HTMLButtonElement>('[data-action="wake"]');
      const frame = document.querySelector<HTMLElement>('[data-testid="frame-index"]');
      const mode = document.querySelector<HTMLElement>('[data-testid="render-mode"]');
      const cpu = document.querySelector<HTMLElement>('[data-testid="cpu-frame-time"]');
      if (wake === null || frame === null || mode === null || cpu === null) {
        throw new Error('Phase 3 benchmark controls are unavailable.');
      }
      const cpuMs: number[] = [];
      const dirtyToSleepMs: number[] = [];
      for (let sample = 0; sample < 10; sample += 1) {
        const previous = frame.textContent;
        const startedAt = performance.now();
        await new Promise<void>((resolve, reject) => {
          const observer = new MutationObserver(() => {
            if (frame.textContent !== previous && mode.textContent === 'sleeping') {
              observer.disconnect();
              clearTimeout(timeout);
              resolve();
            }
          });
          const timeout = window.setTimeout(() => {
            observer.disconnect();
            reject(new Error('Phase 3 dirty-only frame did not sleep within one second.'));
          }, 1_000);
          observer.observe(document.body, { characterData: true, childList: true, subtree: true });
          wake.click();
        });
        dirtyToSleepMs.push(performance.now() - startedAt);
        cpuMs.push(Number(cpu.dataset['milliseconds'] ?? Number.NaN));
      }
      const summarize = (values: number[]) => {
        if (values.some((value) => !Number.isFinite(value) || value < 0)) {
          throw new Error('Phase 3 Renderer reported an invalid timing sample.');
        }
        const sorted = [...values].sort((left, right) => left - right);
        const round = (value: number) => Math.round(value * 1_000) / 1_000;
        return {
          maxMs: round(sorted.at(-1) ?? 0),
          medianMs: round(sorted[Math.floor(sorted.length / 2)] ?? 0),
          minMs: round(sorted[0] ?? 0),
          p95Ms: round(sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0),
          sampleCount: sorted.length,
        };
      };
      return {
        cpuFrameTimeMs: { budgetMs: 16.7, ...summarize(cpuMs) },
        dirtyToSleepMs: { budgetMs: 250, ...summarize(dirtyToSleepMs) },
      };
    });
    expect(performanceMetrics.cpuFrameTimeMs.maxMs).toBeLessThan(
      performanceMetrics.cpuFrameTimeMs.budgetMs,
    );
    expect(performanceMetrics.dirtyToSleepMs.maxMs).toBeLessThan(
      performanceMetrics.dirtyToSleepMs.budgetMs,
    );
    expect(runtimeErrors).toEqual([]);

    await writeRuntimeJson('pbr-gallery.json', {
      schemaVersion: 1,
      phase: '03',
      route: '/acceptance/phase-03',
      gallery: {
        drawCalls: 20,
        materialCount: 20,
        metallicSteps: [0, 0.25, 0.5, 0.75, 1],
        roughnessSteps: [0.05, 0.25, 0.5, 0.75, 1],
        triangles: 10_560,
      },
      controls: {
        ao: await page.getByTestId('ao-state').textContent(),
        exposure: Number(await page.getByTestId('exposure-value').textContent()),
        normalY: await page.getByTestId('normal-direction').textContent(),
        rotationDegrees: Number(
          (await page.getByTestId('rotation-value').textContent())?.replace('°', ''),
        ),
        toneMapping: await page.getByTestId('tone-map-mode').textContent(),
      },
      performance: performanceMetrics,
      resources: {
        activeCount: resourceBaseline,
        activeEstimatedBytes: Number(
          await page.getByTestId('gpu-bytes').getAttribute('data-bytes'),
        ),
        stableAfterControls:
          Number(await page.getByTestId('resource-count').textContent()) === resourceBaseline,
      },
      shaderCompilation: await page.getByTestId('shader-status').textContent(),
      status: 'PASS',
    });
  });

  test('releases and reconstructs the complete PBR gallery across Device Lost and disposal', async ({
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
      await page.goto('/acceptance/phase-03');
      const baseline = await readyResourceCount(page);
      const bytesReady = Number(await page.getByTestId('gpu-bytes').getAttribute('data-bytes'));

      await page.locator('[data-action="lose"]').click();
      await expect(page.getByTestId('renderer-state')).toHaveText('lost');
      await expect(page.getByTestId('resource-count')).toHaveText('0');
      const bytesLost = Number(await page.getByTestId('gpu-bytes').getAttribute('data-bytes'));

      await page.locator('[data-action="recover"]').click();
      await expect(page.getByTestId('renderer-state')).toHaveText('ready');
      await expect(page.getByTestId('resource-count')).toHaveText(String(baseline));
      await expect(page.getByTestId('draw-calls')).toHaveText('20');
      const bytesRecovered = Number(await page.getByTestId('gpu-bytes').getAttribute('data-bytes'));

      await page.locator('[data-action="dispose"]').click();
      await expect(page.getByTestId('renderer-state')).toHaveText('disposed');
      await expect(page.getByTestId('resource-count')).toHaveText('0');
      const bytesDisposed = Number(await page.getByTestId('gpu-bytes').getAttribute('data-bytes'));

      await page.locator('[data-action="recreate"]').click();
      const recreated = await readyResourceCount(page);
      const bytesRecreated = Number(await page.getByTestId('gpu-bytes').getAttribute('data-bytes'));
      await page.locator('[data-action="dispose"]').click();
      await expect(page.getByTestId('resource-count')).toHaveText('0');
      const bytesFinal = Number(await page.getByTestId('gpu-bytes').getAttribute('data-bytes'));

      expect(bytesReady).toBeGreaterThan(0);
      expect(bytesLost).toBe(0);
      expect(bytesRecovered).toBe(bytesReady);
      expect(bytesDisposed).toBe(0);
      expect(recreated).toBe(baseline);
      expect(bytesRecreated).toBe(bytesReady);
      expect(bytesFinal).toBe(0);
      expect(runtimeErrors).toEqual([]);
      await writeRuntimeJson('pbr-gallery-lifecycle.json', {
        schemaVersion: 1,
        phase: '03',
        baseline,
        bytesDisposed,
        bytesFinal,
        bytesLost,
        bytesReady,
        bytesRecovered,
        bytesRecreated,
        recreated,
        status: 'PASS',
      });
    } finally {
      await context.close();
    }
  });

  test('fits without horizontal overflow at a compact viewport', async ({ page }) => {
    await page.setViewportSize({ height: 844, width: 390 });
    await page.goto('/acceptance/phase-03');
    await readyResourceCount(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
