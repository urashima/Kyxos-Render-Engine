import { expect, test } from '@playwright/test';

test.describe('Phase 1 WebGPU Playground', () => {
  test('compiles WGSL and renders distinct triangle and sphere frames', async ({ page }) => {
    const runtimeErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') runtimeErrors.push(message.text());
    });
    page.on('pageerror', (error) => runtimeErrors.push(error.message));

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

    await page.locator('[data-action="sphere"]').click();
    await expect(page.getByTestId('primitive')).toHaveText('SPHERE');
    await expect(page.getByTestId('triangles')).toHaveText('1024');
    await expect(page.getByTestId('vertices')).toHaveText('3072');
    await expect(page.getByTestId('render-mode')).toHaveText('sleeping');
    const sphere = await page.locator('[data-canvas="a"]').screenshot();

    expect(sphere.equals(triangle)).toBe(false);
    expect(runtimeErrors).toEqual([]);
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

      await page.locator('[data-action="recover"]').click();
      await expect(page.getByTestId('renderer-state')).toHaveText('ready');
      await expect(page.getByTestId('resource-count')).toHaveText('6');
      await expect(page.getByTestId('draw-calls')).toHaveText('1');

      await page.locator('[data-action="dispose"]').click();
      await expect(page.getByTestId('renderer-state')).toHaveText('disposed');
      await expect(page.getByTestId('resource-count')).toHaveText('0');

      await page.locator('[data-action="recreate"]').click();
      await expect(page.getByTestId('renderer-state')).toHaveText('ready');
      await expect(page.getByTestId('resource-count')).toHaveText('6');
      expect(runtimeErrors).toEqual([]);
    } finally {
      await context.close();
    }
  });
});
