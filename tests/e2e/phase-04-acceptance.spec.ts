import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROUTE_SETTLE_TIMEOUT_MS = 60_000;
const ROUTE_LIFECYCLE_TIMEOUT_MS = 180_000;
const CPU_FRAME_BUDGET_MS = 16.7;
const STATIC_TO_SLEEP_BUDGET_MS = 12_000;
const FIXED_VIEWPORT = { height: 1600, width: 1440 };
const RESIZED_VIEWPORT = { height: 1100, width: 1180 };
const runtimeDirectory = path.resolve('test-results/phase-04/runtime');

interface SettledMeasurement {
  readonly cpuFrameTimeMs: number;
  readonly label: string;
  readonly staticToSleepMs: number;
}

async function waitForSleeping(page: import('@playwright/test').Page): Promise<void> {
  await expect(page.getByTestId('renderer-state')).toHaveText('ready', {
    timeout: ROUTE_SETTLE_TIMEOUT_MS,
  });
  await expect(page.getByTestId('render-mode')).toHaveText('sleeping', {
    timeout: ROUTE_SETTLE_TIMEOUT_MS,
  });
  await expect(page.getByTestId('sample-count')).toHaveText('16', {
    timeout: ROUTE_SETTLE_TIMEOUT_MS,
  });
  await expect(page.getByTestId('raf-active')).toHaveText('false');
  await expect(page.getByTestId('history-valid')).toHaveText('valid');
}

async function numericText(page: import('@playwright/test').Page, testId: string): Promise<number> {
  const text = await page.getByTestId(testId).textContent();
  return Number(text ?? Number.NaN);
}

async function millisecondsText(
  page: import('@playwright/test').Page,
  testId: string,
): Promise<number> {
  const text = await page.getByTestId(testId).textContent();
  return Number(text?.replace(' ms', '') ?? Number.NaN);
}

function summarize(values: readonly number[]) {
  if (values.length === 0 || values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error('Phase 4 performance evidence contains an invalid sample.');
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
}

test.describe('Phase 4 public temporal acceptance route', () => {
  test('wakes, accumulates, sleeps, recovers, disposes, and recreates through the public SDK', async ({
    page,
  }) => {
    test.setTimeout(ROUTE_LIFECYCLE_TIMEOUT_MS);
    const runtimeErrors: string[] = [];
    const settledMeasurements: SettledMeasurement[] = [];
    const recordSettled = async (label: string) => {
      const measurement = {
        cpuFrameTimeMs: await millisecondsText(page, 'cpu-frame-time'),
        label,
        staticToSleepMs: await millisecondsText(page, 'static-to-sleep'),
      };
      expect(measurement.cpuFrameTimeMs).toBeLessThan(CPU_FRAME_BUDGET_MS);
      expect(measurement.staticToSleepMs).toBeLessThan(STATIC_TO_SLEEP_BUDGET_MS);
      settledMeasurements.push(measurement);
    };
    page.on('console', (message) => {
      if (message.type() === 'error') runtimeErrors.push(message.text());
    });
    page.on('pageerror', (error) => runtimeErrors.push(error.message));

    await page.setViewportSize(FIXED_VIEWPORT);
    await page.goto('/acceptance/phase-04');
    await expect(page.getByTestId('phase-04-acceptance')).toBeVisible();
    await expect(page.getByTestId('backend-type')).toHaveText('webgpu', {
      timeout: ROUTE_SETTLE_TIMEOUT_MS,
    });
    await waitForSleeping(page);

    const initialWakeCount = await numericText(page, 'wake-count');
    const initialGeneration = await numericText(page, 'history-generation');
    const initialResources = await numericText(page, 'resource-count');
    const initialSurface = await page.getByTestId('surface-size').textContent();
    expect(initialResources).toBeGreaterThan(0);
    expect(initialSurface).not.toBeNull();
    await expect(page.getByTestId('resource-verdict')).toHaveText('stable');
    await expect(page.getByTestId('taa-tuning-panel')).toBeVisible();
    await expect(page.getByTestId('taa-current-jitter')).toHaveText('1.00');
    for (const control of [
      'jitterScale',
      'baseHistoryWeight',
      'depthAbsoluteThreshold',
      'depthRelativeThreshold',
      'edgeDepthDifference',
      'maxVelocityLength',
      'minimumCurrentWeight',
      'varianceClipGamma',
      'subpixelCorrection',
      'flickerReduction',
      'normalRejectionCosine',
      'responsiveHistoryReduction',
      'responsiveMask',
    ]) {
      await expect(page.locator(`[data-taa-control="${control}"][type="number"]`)).toBeVisible();
    }

    const beforeTuningGeneration = await numericText(page, 'history-generation');
    await page.locator('[data-taa-control="jitterScale"][type="number"]').fill('0.35');
    await expect(page.getByTestId('taa-current-jitter')).toHaveText('0.35');
    await expect
      .poll(() => numericText(page, 'history-generation'))
      .toBeGreaterThan(beforeTuningGeneration);
    await waitForSleeping(page);
    const firstTuningResources = await numericText(page, 'resource-count');
    expect(firstTuningResources).toBeGreaterThanOrEqual(initialResources);
    expect(firstTuningResources).toBeLessThanOrEqual(initialResources + 2);
    await expect(page.getByTestId('resource-verdict')).toHaveText('stable');
    await page.getByRole('button', { name: 'Default TAA' }).click();
    await expect(page.getByTestId('taa-current-jitter')).toHaveText('1.00');
    await waitForSleeping(page);
    const taaWarmedResources = await numericText(page, 'resource-count');
    expect(taaWarmedResources).toBeGreaterThanOrEqual(firstTuningResources);
    expect(taaWarmedResources).toBeLessThanOrEqual(initialResources + 2);
    await expect(page.getByTestId('resource-baseline')).toHaveText(String(taaWarmedResources));
    await expect(page.getByTestId('resource-verdict')).toHaveText('stable');

    await page.getByRole('button', { name: 'Orbit right' }).click();
    await expect.poll(() => numericText(page, 'wake-count')).toBeGreaterThan(initialWakeCount);
    await expect
      .poll(() => numericText(page, 'history-generation'))
      .toBeGreaterThan(initialGeneration);
    await waitForSleeping(page);
    await recordSettled('camera');

    const afterCameraWake = await numericText(page, 'wake-count');
    await page.locator('[data-control="roughness"]').fill('0.63');
    await expect(page.locator('[data-output="roughness"]')).toHaveText('0.63');
    await expect.poll(() => numericText(page, 'wake-count')).toBeGreaterThan(afterCameraWake);
    await waitForSleeping(page);
    await recordSettled('material');

    const afterMaterialWake = await numericText(page, 'wake-count');
    await page.getByRole('button', { name: 'Replace texture' }).click();
    await expect.poll(() => numericText(page, 'wake-count')).toBeGreaterThan(afterMaterialWake);
    await waitForSleeping(page);
    await recordSettled('texture-warm');
    const resourcesAfterTextureWarm = await numericText(page, 'resource-count');
    expect(resourcesAfterTextureWarm).toBeGreaterThanOrEqual(taaWarmedResources);
    expect(resourcesAfterTextureWarm).toBeLessThanOrEqual(taaWarmedResources + 2);

    const afterTextureWarmWake = await numericText(page, 'wake-count');
    await page.getByRole('button', { name: 'Replace texture' }).click();
    await expect.poll(() => numericText(page, 'wake-count')).toBeGreaterThan(afterTextureWarmWake);
    await waitForSleeping(page);
    await recordSettled('texture-reuse');
    const resourcesAfterTextureReuse = await numericText(page, 'resource-count');
    expect(resourcesAfterTextureReuse).toBeGreaterThanOrEqual(taaWarmedResources);
    expect(resourcesAfterTextureReuse).toBeLessThanOrEqual(taaWarmedResources + 2);
    const warmedResources = Math.max(resourcesAfterTextureWarm, resourcesAfterTextureReuse);

    await page.getByRole('button', { name: 'Start animation' }).click();
    await expect(page.getByRole('button', { name: 'Stop animation' })).toHaveAttribute(
      'data-active',
      'true',
    );
    await expect(page.getByTestId('render-mode')).toHaveText('interactive');
    await expect(page.getByTestId('raf-active')).toHaveText('true');
    const animationFrame = await numericText(page, 'frame-index');
    await expect.poll(() => numericText(page, 'frame-index')).toBeGreaterThan(animationFrame + 2);
    await page.getByRole('button', { name: 'Stop animation' }).click();
    await waitForSleeping(page);
    await recordSettled('animation-stop');

    await page.getByRole('button', { name: 'Reset scene' }).click();
    await waitForSleeping(page);
    await expect(page.getByTestId('resource-count')).toHaveText(String(initialResources));
    await page.getByRole('button', { name: 'Orbit right' }).click();
    await waitForSleeping(page);
    await page.locator('[data-control="roughness"]').fill('0.63');
    await expect(page.locator('[data-output="roughness"]')).toHaveText('0.63');
    await waitForSleeping(page);

    await page.setViewportSize(RESIZED_VIEWPORT);
    await expect
      .poll(() => page.getByTestId('surface-size').textContent())
      .not.toBe(initialSurface);
    await waitForSleeping(page);
    await recordSettled('resize');
    await page.setViewportSize(FIXED_VIEWPORT);
    await expect.poll(() => page.getByTestId('surface-size').textContent()).toBe(initialSurface);
    await waitForSleeping(page);
    await recordSettled('resize-restore');

    await expect(page.getByTestId('active-passes')).toHaveText('NO ACTIVE PASS');
    await expect(page.getByTestId('resource-count')).toHaveText(String(initialResources));
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
        [data-testid="fps"],
        [data-testid="frame-index"],
        [data-testid="history-generation"],
        [data-testid="static-to-sleep"],
        [data-testid="wake-count"] {
          visibility: hidden !important;
        }
        [data-testid="taa-tuning-panel"] {
          display: none !important;
        }
      `,
    });
    await page.evaluate(() => {
      const freezeText = (testId: string, value: string) => {
        const element = document.querySelector(`[data-testid="${testId}"]`);
        if (element !== null) element.textContent = value;
      };
      freezeText('texture-bytes', '30.8 MiB');
      freezeText('buffer-bytes', '83.3 KiB');
      freezeText('resource-count', '73');
      freezeText('resource-baseline', '73');
      window.scrollTo(0, 0);
    });
    await waitForSleeping(page);
    await page.getByRole('button', { name: 'Orbit right' }).hover();
    const currentVisual = await page.screenshot({
      animations: 'disabled',
      fullPage: false,
    });
    const visualDirectory = path.join(runtimeDirectory, 'acceptance-visual');
    await mkdir(visualDirectory, { recursive: true });
    await writeFile(path.join(visualDirectory, 'current.png'), currentVisual);
    expect(currentVisual).toMatchSnapshot('reference.png', { maxDiffPixels: 0, threshold: 0.2 });
    await waitForSleeping(page);

    await page.getByRole('button', { name: 'Simulate Device Lost' }).click();
    await expect(page.getByTestId('renderer-state')).toHaveText('lost');
    await expect(page.getByTestId('resource-count')).toHaveText('0');
    await expect(page.getByTestId('surface-size')).toHaveText('unavailable');
    await page.getByRole('button', { name: 'Recover renderer' }).click();
    await waitForSleeping(page);
    await recordSettled('device-recovery');
    const resourcesAfterRecovery = await numericText(page, 'resource-count');
    expect(resourcesAfterRecovery).toBe(initialResources);

    const evidenceBeforeDispose = {
      backend: await page.getByTestId('backend-type').textContent(),
      bufferBytes: await page.getByTestId('buffer-bytes').textContent(),
      drawCalls: await page.getByTestId('draw-calls').textContent(),
      frameIndex: await page.getByTestId('frame-index').textContent(),
      historyGeneration: await page.getByTestId('history-generation').textContent(),
      initialResources,
      mode: await page.getByTestId('render-mode').textContent(),
      pipelineCount: await page.getByTestId('pipeline-count').textContent(),
      resources: await page.getByTestId('resource-count').textContent(),
      samples: await page.getByTestId('sample-count').textContent(),
      surface: await page.getByTestId('surface-size').textContent(),
      textureBytes: await page.getByTestId('texture-bytes').textContent(),
      triangles: await page.getByTestId('triangles').textContent(),
      warmedResources,
    };

    await page.getByRole('button', { name: 'Dispose' }).click();
    await expect(page.getByTestId('renderer-state')).toHaveText('disposed');
    await expect(page.getByTestId('resource-count')).toHaveText('0');
    await expect(page.getByTestId('resource-verdict')).toHaveText('released');

    await page.getByRole('button', { name: 'Recreate' }).click();
    await waitForSleeping(page);
    await expect(page.getByTestId('resource-count')).toHaveText(String(initialResources));
    await expect(page.locator('[data-testid="gpu-error"]')).toBeHidden();
    expect(runtimeErrors).toEqual([]);

    const cpuSamples = settledMeasurements.map(({ cpuFrameTimeMs }) => cpuFrameTimeMs);
    const staticSamples = settledMeasurements.map(({ staticToSleepMs }) => staticToSleepMs);
    const performance = {
      cpuFrameTimeMs: {
        budgetMs: CPU_FRAME_BUDGET_MS,
        ...summarize(cpuSamples),
        status: 'PASS',
      },
      gpuFrameTimeMs: {
        reason:
          'Timestamp-query instrumentation is not exposed through the public Phase 4 diagnostics contract.',
        status: 'NOT_AVAILABLE',
      },
      staticToSleepMs: {
        budgetMs: STATIC_TO_SLEEP_BUDGET_MS,
        ...summarize(staticSamples),
        status: 'PASS',
      },
    };
    await mkdir(runtimeDirectory, { recursive: true });
    await writeFile(
      path.join(runtimeDirectory, 'acceptance-route.json'),
      `${JSON.stringify(
        {
          afterRecreate: {
            mode: await page.getByTestId('render-mode').textContent(),
            resources: await page.getByTestId('resource-count').textContent(),
            samples: await page.getByTestId('sample-count').textContent(),
          },
          beforeDispose: evidenceBeforeDispose,
          checkpoint: 'P4-12',
          lifecycle: {
            resourcesAfterDeviceLoss: 0,
            resourcesAfterDispose: 0,
            resourcesAfterRecovery,
            resourcesAfterRecreate: await numericText(page, 'resource-count'),
          },
          measurements: settledMeasurements,
          performance,
          runtimeErrors,
          status: 'PASS',
        },
        null,
        2,
      )}\n`,
    );
  });
});
