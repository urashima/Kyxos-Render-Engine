import { expect, test } from '@playwright/test';

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
    await expect(page.getByTestId('draw-calls')).toHaveText('5');
    await expect(page.getByTestId('triangles')).toHaveText('686');
    await expect(page.getByTestId('vertices')).toHaveText('2058');
    await expect(page.getByTestId('visible-count')).toHaveText('5');
    await expect(page.getByTestId('opaque-count')).toHaveText('3');
    await expect(page.getByTestId('transparent-count')).toHaveText('2');
    await expect(page.getByTestId('disabled-count')).toHaveText('1');
    await expect(page.getByTestId('hidden-count')).toHaveText('1');
    await expect(page.getByTestId('layer-culled-count')).toHaveText('1');
    await expect(page.getByTestId('frustum-culled-count')).toHaveText('1');
    await expect(page.getByTestId('gpu-mesh-count')).toHaveText('3');
    await expect(page.getByTestId('object-binding-count')).toHaveText('5');
    await expect(page.getByTestId('pipeline-count')).toHaveText('2');
    await expect(page.getByTestId('resource-count')).toHaveText('21');
    await expect(page.getByTestId('buffer-memory')).toHaveAttribute('data-bytes', '6492');
    await expect(page.getByTestId('hierarchy')).toHaveText('Root → Child');
    await expect(page.getByTestId('entity-count')).toHaveText('9');

    const initialOrder = await page.getByTestId('transparent-order').textContent();
    expect(initialOrder).toContain('Glass Far');
    expect(initialOrder).toContain('Glass Near');
    await page.locator('[data-action="swap-transparent"]').click();
    await expect(page.getByTestId('transparent-order')).not.toHaveText(initialOrder ?? '');

    const initialOrbit = await page.getByTestId('orbit-angle').textContent();
    await page.locator('[data-action="orbit-right"]').click();
    await expect(page.getByTestId('orbit-angle')).not.toHaveText(initialOrbit ?? '');
    await expect(page.getByTestId('render-mode')).toHaveText('sleeping');

    await page.locator('[data-action="toggle-culling"]').click();
    await expect(page.getByTestId('culling-mode')).toHaveText('FRUSTUM OFF');
    await expect(page.getByTestId('frustum-culled-count')).toHaveText('0');
    await expect(page.getByTestId('visible-count')).toHaveText('6');
    await expect(page.getByTestId('draw-calls')).toHaveText('6');
    await expect(page.getByTestId('resource-count')).toHaveText('23');

    await page.locator('[data-action="toggle-layers"]').click();
    await expect(page.getByTestId('layer-culled-count')).toHaveText('0');
    await expect(page.getByTestId('visible-count')).toHaveText('7');
    await expect(page.getByTestId('draw-calls')).toHaveText('7');
    await expect(page.getByTestId('resource-count')).toHaveText('25');

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
    await expect(page.getByTestId('draw-calls')).toHaveText('7');
    expect(runtimeErrors).toEqual([]);
  });

  test('releases and recreates every Scene resource across Device Lost and disposal', async ({
    page,
  }) => {
    const runtimeErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') runtimeErrors.push(message.text());
    });
    page.on('pageerror', (error) => runtimeErrors.push(error.message));

    await page.goto('/acceptance/phase-02');
    await expect(page.getByTestId('renderer-state')).toHaveText('ready', { timeout: 20_000 });
    await expect(page.getByTestId('resource-count')).toHaveText('21');

    await page.locator('[data-action="lose"]').click();
    await expect(page.getByTestId('renderer-state')).toHaveText('lost');
    await expect(page.getByTestId('resource-count')).toHaveText('0');

    await page.locator('[data-action="recover"]').click();
    await expect(page.getByTestId('renderer-state')).toHaveText('ready');
    await expect(page.getByTestId('resource-count')).toHaveText('21');
    await expect(page.getByTestId('draw-calls')).toHaveText('5');

    await page.locator('[data-action="dispose"]').click();
    await expect(page.getByTestId('renderer-state')).toHaveText('disposed');
    await expect(page.getByTestId('resource-count')).toHaveText('0');

    await page.locator('[data-action="recreate"]').click();
    await expect(page.getByTestId('renderer-state')).toHaveText('ready');
    await expect(page.getByTestId('resource-count')).toHaveText('21');
    await page.locator('[data-action="dispose"]').click();
    await expect(page.getByTestId('resource-count')).toHaveText('0');
    expect(runtimeErrors).toEqual([]);
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
