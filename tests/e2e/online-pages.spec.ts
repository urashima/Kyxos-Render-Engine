import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

function requireEnvironmentVariable(name: string): string {
  const value = process.env[name];
  if (value === undefined) throw new Error(`${name} is required for online Pages verification.`);
  return value;
}

const publicPlaygroundUrl = requireEnvironmentVariable('PUBLIC_PLAYGROUND_URL');
const phases = (process.env['PAGES_PHASES'] ?? '')
  .split(',')
  .filter((value) => /^\d{1,2}$/.test(value))
  .map(Number);
const latestPhase = Number(process.env['PAGES_LATEST_PHASE']);
const expectedCommitSha = requireEnvironmentVariable('EXPECTED_COMMIT_SHA');
if (phases.length === 0 || !phases.includes(latestPhase)) {
  throw new Error('Online Pages verification received an invalid deployment manifest.');
}

function publicUrl(path: string): string {
  return new URL(path, publicPlaygroundUrl).toString();
}

async function verifyPhase(page: Page, phase: number, route: string): Promise<void> {
  const runtimeErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(message.text());
  });
  page.on('pageerror', (error) => runtimeErrors.push(error.message));

  await page.goto(publicUrl(route), { waitUntil: 'networkidle' });
  await expect(
    page.getByTestId(`phase-${String(phase).padStart(2, '0')}-acceptance`),
  ).toBeVisible();
  await expect(page.getByTestId('commit-sha')).toHaveText(expectedCommitSha);
  await expect(page.getByTestId('renderer-state')).toHaveText('ready', { timeout: 20_000 });

  const previousFrame = await page.getByTestId('frame-index').textContent();
  await page.locator('[data-action="wake"]').click();
  await expect(page.getByTestId('frame-index')).not.toHaveText(previousFrame ?? '');
  await expect(page.getByTestId('render-mode')).toHaveText('sleeping');

  if (phase > 0) {
    await expect(page.getByTestId('backend-type')).toHaveText('webgpu');
    await expect(page.getByTestId('shader-status')).toHaveText('pass');
    expect(Number(await page.getByTestId('draw-calls').textContent())).toBeGreaterThan(0);
  }
  if (phase === 2) {
    await expect(page.getByTestId('fps')).toHaveText('0 · sleeping');
    await expect(page.getByTestId('cpu-frame-time')).toHaveAttribute('data-milliseconds', /\d+/u);
    await expect(page.getByTestId('gpu-frame-time')).toContainText('unavailable');

    for (const focus of ['Plane', 'Cube', 'Sphere', 'Custom', 'All']) {
      await page.locator('[data-action="cycle-geometry"]').click();
      await expect(page.getByTestId('geometry-focus')).toHaveText(focus);
    }
    await expect(page.getByTestId('draw-calls')).toHaveText('6');
    await page.locator('[data-action="move-hierarchy"]').click();
    await expect(page.getByTestId('frustum-culled-count')).toHaveText('3');
    await page.locator('[data-action="move-hierarchy"]').click();
    await expect(page.getByTestId('frustum-culled-count')).toHaveText('1');

    const initialOrder = await page.getByTestId('transparent-order').textContent();
    await page.locator('[data-action="swap-transparent"]').click();
    await expect(page.getByTestId('transparent-order')).not.toHaveText(initialOrder ?? '');

    const canvas = page.locator('[data-canvas="scene"]');
    await canvas.scrollIntoViewIfNeeded();
    const bounds = await canvas.boundingBox();
    if (bounds === null) throw new Error('The public Phase 2 Scene Canvas has no bounds.');
    const initialOrbit = await page.getByTestId('orbit-angle').textContent();
    await page.mouse.move(bounds.x + bounds.width * 0.5, bounds.y + bounds.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width * 0.62, bounds.y + bounds.height * 0.43, {
      steps: 4,
    });
    await page.mouse.up();
    await expect(page.getByTestId('orbit-angle')).not.toHaveText(initialOrbit ?? '');

    const initialDistance = await page.getByTestId('orbit-distance').textContent();
    await page.mouse.wheel(0, -160);
    await expect(page.getByTestId('orbit-distance')).not.toHaveText(initialDistance ?? '');

    const previousFrame = Number(await page.getByTestId('frame-index').textContent());
    await page.locator('[data-action="rotate-parent"]').click();
    await expect(page.getByTestId('frame-index')).toHaveText(String(previousFrame + 1));
    await page.locator('[data-action="frame"]').click();
    await expect(page.getByTestId('render-mode')).toHaveText('sleeping');

    await page.locator('[data-action="toggle-culling"]').click();
    await expect(page.getByTestId('frustum-culled-count')).toHaveText('0');
    await expect(page.getByTestId('draw-calls')).toHaveText('7');
    await page.locator('[data-action="toggle-layers"]').click();
    await expect(page.getByTestId('layer-culled-count')).toHaveText('0');
    await expect(page.getByTestId('draw-calls')).toHaveText('8');
  }
  expect(runtimeErrors).toEqual([]);
}

test.describe('public GitHub Pages Playground', () => {
  test.describe.configure({ mode: 'serial' });

  for (const phase of phases) {
    test(`serves and operates historical Phase ${String(phase)}`, async ({ page }) => {
      await verifyPhase(page, phase, `phase-${String(phase)}/`);
    });
  }

  test(`latest resolves to accepted Phase ${String(latestPhase)}`, async ({ page }) => {
    await verifyPhase(page, latestPhase, 'latest/');
  });
});
