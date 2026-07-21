import { expect, test } from '@playwright/test';

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
});
