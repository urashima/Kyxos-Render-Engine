import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from '@playwright/test';

const visualSnapshots = {
  canonical: 'reference.png',
  'sandbox-chromium-149': 'reference-sandbox-chromium-149.png',
} as const;

function resolveVisualProfile() {
  const profile = process.env['PLAYWRIGHT_VISUAL_PROFILE'] ?? 'canonical';
  if (!(profile in visualSnapshots)) {
    throw new Error(
      `Unknown PLAYWRIGHT_VISUAL_PROFILE "${profile}". Expected one of: ${Object.keys(visualSnapshots).join(', ')}.`,
    );
  }
  return {
    name: profile,
    snapshot: visualSnapshots[profile as keyof typeof visualSnapshots],
  };
}

test.describe('Phase 0 independent Playground', () => {
  test('runs the SDK, resource, scheduler, loss, recovery, and disposal acceptance flow', async ({
    page,
  }) => {
    const runtimeErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') {
        runtimeErrors.push(message.text());
      }
    });
    page.on('pageerror', (error) => runtimeErrors.push(error.message));

    await page.goto('/acceptance/phase-00');
    await expect(page.getByTestId('phase-00-acceptance')).toBeVisible();
    await expect(page.getByTestId('backend-type')).toHaveText('mock');
    await expect(page.getByTestId('renderer-state')).toHaveText('ready');
    await expect(page.getByTestId('render-mode')).toHaveText('sleeping');
    await expect(page.getByTestId('resource-count')).toHaveText('0');

    await page.locator('[data-action="allocate"]').click();
    await expect(page.getByTestId('resource-count')).toHaveText('1');
    await expect(page.getByTestId('texture-memory')).toHaveText('1.0 MiB');

    await page.locator('[data-action="wake"]').click();
    await expect(page.getByTestId('frame-index')).toHaveText('1');
    await expect(page.getByTestId('render-mode')).toHaveText('sleeping');

    await page.locator('[data-action="release"]').click();
    await expect(page.getByTestId('resource-count')).toHaveText('0');
    await expect(page.getByTestId('texture-memory')).toHaveText('0 B');

    await page.locator('[data-action="allocate"]').click();
    await page.locator('[data-action="lose"]').click();
    await expect(page.getByTestId('renderer-state')).toHaveText('lost');
    await expect(page.getByTestId('resource-count')).toHaveText('0');

    await page.locator('[data-action="recover"]').click();
    await expect(page.getByTestId('renderer-state')).toHaveText('ready');

    await page.locator('[data-action="dispose"]').click();
    await expect(page.getByTestId('renderer-state')).toHaveText('disposed');
    await expect(page.getByTestId('resource-count')).toHaveText('0');
    expect(runtimeErrors).toEqual([]);
  });

  test('keeps the acceptance surface within a compact viewport', async ({ page }) => {
    await page.setViewportSize({ height: 844, width: 390 });
    await page.goto('/acceptance/phase-00');
    await expect(page.getByTestId('phase-00-acceptance')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('survives refresh and reports resize and DPR changes', async ({ browser }) => {
    const context = await browser.newContext({
      colorScheme: 'dark',
      deviceScaleFactor: 2,
      viewport: { height: 600, width: 800 },
    });
    const page = await context.newPage();
    const runtimeErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') runtimeErrors.push(message.text());
    });
    page.on('pageerror', (error) => runtimeErrors.push(error.message));

    try {
      await page.goto('/acceptance/phase-00');
      await expect(page.getByTestId('renderer-state')).toHaveText('ready');
      await expect(page.getByTestId('viewport')).toHaveText('800 × 600');
      await expect(page.getByTestId('dpr')).toHaveText('2.00');

      await page.reload();
      await expect(page.getByTestId('renderer-state')).toHaveText('ready');
      await expect(page.getByTestId('dpr')).toHaveText('2.00');

      await page.setViewportSize({ height: 768, width: 1024 });
      await expect(page.getByTestId('viewport')).toHaveText('1024 × 768');
      expect(runtimeErrors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test('matches the deterministic Phase 0 visual baseline', async ({ page }) => {
    await page.setViewportSize({ height: 1000, width: 1440 });
    await page.goto('/acceptance/phase-00');
    await expect(page.getByTestId('phase-00-acceptance')).toBeVisible();
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

    const screenshot = await page.screenshot({ animations: 'disabled', fullPage: true });
    const runtimeDirectory = path.resolve('test-results/phase-00/runtime/visual');
    await mkdir(runtimeDirectory, { recursive: true });
    await writeFile(path.join(runtimeDirectory, 'current.png'), screenshot);

    const visualProfile = resolveVisualProfile();
    if (
      process.env['UPDATE_ACCEPTANCE_EVIDENCE'] === 'true' &&
      visualProfile.name === 'canonical'
    ) {
      const evidenceDirectory = path.resolve('visual-baselines/phase-00');
      await mkdir(evidenceDirectory, { recursive: true });
      await writeFile(path.join(evidenceDirectory, 'current.png'), screenshot);
    }

    expect(screenshot).toMatchSnapshot(visualProfile.snapshot, {
      maxDiffPixels: 0,
      threshold: 0.2,
    });
  });

  test('returns dirty-only frames to sleep within the Phase 0 budget', async ({ page }) => {
    await page.goto('/acceptance/phase-00');
    await expect(page.getByTestId('renderer-state')).toHaveText('ready');

    const measurement = await page.evaluate(async () => {
      const wakeButton = document.querySelector<HTMLButtonElement>('[data-action="wake"]');
      const frameIndex = document.querySelector<HTMLElement>('[data-testid="frame-index"]');
      const renderMode = document.querySelector<HTMLElement>('[data-testid="render-mode"]');
      if (wakeButton === null || frameIndex === null || renderMode === null) {
        throw new Error('Phase 0 benchmark controls are unavailable.');
      }

      const samples = [];
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
            reject(new Error('Dirty-only frame did not complete within 1 second.'));
          }, 1_000);
          observer.observe(frameIndex, { characterData: true, childList: true, subtree: true });
        });

        wakeButton.click();
        await frameCompleted;
        samples.push(performance.now() - startedAt);
        if (renderMode.textContent !== 'sleeping') {
          throw new Error('Renderer did not return to sleeping after a dirty-only frame.');
        }
      }

      const sorted = [...samples].sort((left, right) => left - right);
      const round = (value: number) => Math.round(value * 1_000) / 1_000;
      return {
        budgetMs: 250,
        maxMs: round(sorted.at(-1) ?? 0),
        medianMs: round(sorted[Math.floor(sorted.length / 2)] ?? 0),
        minMs: round(sorted[0] ?? 0),
        p95Ms: round(sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0),
        sampleCount: sorted.length,
      };
    });

    expect(measurement.maxMs).toBeLessThan(measurement.budgetMs);
    const runtimeDirectory = path.resolve('test-results/phase-00/runtime');
    await mkdir(runtimeDirectory, { recursive: true });
    await writeFile(
      path.join(runtimeDirectory, 'static-to-sleep.json'),
      `${JSON.stringify(measurement, null, 2)}\n`,
    );

    if (process.env['UPDATE_ACCEPTANCE_EVIDENCE'] === 'true') {
      const benchmarkDirectory = path.resolve('benchmarks/phase-00');
      await mkdir(benchmarkDirectory, { recursive: true });
      await writeFile(
        path.join(benchmarkDirectory, 'static-to-sleep.json'),
        `${JSON.stringify(measurement, null, 2)}\n`,
      );
    }
  });
});
