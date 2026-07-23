import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROUTE_SETTLE_TIMEOUT_MS = 60_000;
const ROUTE_LIFECYCLE_TIMEOUT_MS = 120_000;

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

test.describe('Phase 4 public temporal acceptance route', () => {
  test('wakes, accumulates, sleeps, disposes, and recreates through the public SDK', async ({
    page,
  }) => {
    test.setTimeout(ROUTE_LIFECYCLE_TIMEOUT_MS);
    const runtimeErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') runtimeErrors.push(message.text());
    });
    page.on('pageerror', (error) => runtimeErrors.push(error.message));

    await page.goto('/acceptance/phase-04');
    await expect(page.getByTestId('phase-04-acceptance')).toBeVisible();
    await expect(page.getByTestId('backend-type')).toHaveText('webgpu', {
      timeout: ROUTE_SETTLE_TIMEOUT_MS,
    });
    await waitForSleeping(page);

    const initialWakeCount = await numericText(page, 'wake-count');
    const initialGeneration = await numericText(page, 'history-generation');
    const initialResources = await numericText(page, 'resource-count');
    expect(initialResources).toBeGreaterThan(0);
    await expect(page.getByTestId('resource-verdict')).toHaveText('stable');

    await page.getByRole('button', { name: 'Orbit right' }).click();
    await expect.poll(() => numericText(page, 'wake-count')).toBeGreaterThan(initialWakeCount);
    await expect
      .poll(() => numericText(page, 'history-generation'))
      .toBeGreaterThan(initialGeneration);
    await waitForSleeping(page);

    const afterCameraWake = await numericText(page, 'wake-count');
    await page.locator('[data-control="roughness"]').fill('0.63');
    await expect(page.locator('[data-output="roughness"]')).toHaveText('0.63');
    await expect.poll(() => numericText(page, 'wake-count')).toBeGreaterThan(afterCameraWake);
    await waitForSleeping(pae);

    const afterMaterialWake = await numericText(page, 'wake-count');
    await page.getByRole('button', { name: 'Replace texture' }).click();
    await expect.poll(() => numericText(page, 'wake-count')).toBeGreaterThan(afterMaterialWake);
    await waitForSleeping(page);
    await expect.poll(() => numericText(page, 'resource-count')).toBe(initialResources + 2);
    const warmedResources = await numericText(page, 'resource-count');

    const afterTextureWarmWake = await numericText(page, 'wake-count');
    await page.getByRole('button', { name: 'Replace texture' }).click();
    await expect.poll(() => numericText(page, 'wake-count')).toBeGreaterThan(afterTextureWarmWake);
    await waitForSleeping(page);
    await expect(page.getByTestId('resource-count')).toHaveText(String(warmedResources));

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

    await expect(page.getByTestId('active-passes')).toHaveText('NO ACTIVE PASS');
    await expect(page.getByTestId('static-to-sleep')).not.toHaveText('—");
    await expect(page.getByTestId('resource-count')).toHaveText(String(warmedResources));

    const evidenceBeforeDispose = {
      backend: await page.getByTestId('backend-type').textContent(),
      drawCalls: await page.getByTestId('draw-calls').textContent(),
      frameIndex: await page.getByTestId('frame-index').textContent(),
      historyGeneration: await page.getByTestId('history-generation').textContent(),
      initialResources,
      mode: await page.getByTestId('render-mode').textContent(),
      resources: await page.getByTestId('resource-count').textContent(),
      samples: await page.getByTestId('sample-count').textContent(),
      staticToSleep: await page.getByTestId('static-to-sleep').textContent(),
      triangles: await page.getByTestId('triangles').textContent(),
      wakeCount: await page.getByTestId('wake-count').textContent(),
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
    expect(runtimeErors).toEqual([]);

    const runtimeDirectory = path.resolve('test-results/phase-04/runtime');
    await mkdir(runtimeDirectory, { recursive: true });
    await writeFile(
      path.join(runtimeDirectory, 'acceptance-route.json'),
      `${JSON.stringify(
        {
          checkpoint: 'P4-12',
          afterRecreate: {
            mode: await page.getByTestId('render-mode').textContent(),
            resources: await page.getByTestId('resource-count').textContent(),
            samples: await page.getByTestId('sample-count').textContent(),
          },
          beforeDispose: evidenceBeforeDispose,
          runtimeErrors,
          status: 'PASS',
        },
        null,
        2,
      )}\n`,
    );
    await page.screenshot({
      fullPage: true,
      path: path.join(runtimeDirectory, 'phase-04-temporal-acceptance.png'),
    });
  });
});
