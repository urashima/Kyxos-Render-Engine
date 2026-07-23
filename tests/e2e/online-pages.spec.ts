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
    expect(Number(await page.getByTestId('draw-calls').textContent())).toBeGreaterThan(0);
  }
  if (phase > 0 && phase < 4) {
    await expect(page.getByTestId('shader-status')).toHaveText('pass');
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
  if (phase === 3) {
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

    const resourceBaseline = Number(await page.getByTestId('resource-count').textContent());
    expect(resourceBaseline).toBeGreaterThan(0);
    const frameIndex = page.getByTestId('frame-index');
    const changeRange = async (control: string, value: string) => {
      const previousFrame = await frameIndex.textContent();
      await page.locator(`[data-control="${control}"]`).fill(value);
      await expect(frameIndex).not.toHaveText(previousFrame ?? '');
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
      const previousFrame = await frameIndex.textContent();
      await page.locator(`[data-action="${action}"]`).click();
      await expect(page.getByTestId(testId)).toHaveText(value);
      await expect(frameIndex).not.toHaveText(previousFrame ?? '');
      await expect(page.getByTestId('resource-count')).toHaveText(String(resourceBaseline));
    }

    for (const action of ['orbit-left', 'orbit-right']) {
      const previousFrame = await frameIndex.textContent();
      await page.locator(`[data-action="${action}"]`).click();
      await expect(frameIndex).not.toHaveText(previousFrame ?? '');
      await expect(page.getByTestId('render-mode')).toHaveText('sleeping');
    }

    await page.locator('[data-action="lose"]').click();
    await expect(page.getByTestId('renderer-state')).toHaveText('lost');
    await expect(page.getByTestId('resource-count')).toHaveText('0');
    await page.locator('[data-action="recover"]').click();
    await expect(page.getByTestId('renderer-state')).toHaveText('ready');
    await expect(page.getByTestId('resource-count')).toHaveText(String(resourceBaseline));
    await page.locator('[data-action="dispose"]').click();
    await expect(page.getByTestId('renderer-state')).toHaveText('disposed');
    await expect(page.getByTestId('resource-count')).toHaveText('0');
    await page.locator('[data-action="recreate"]').click();
    await expect(page.getByTestId('renderer-state')).toHaveText('ready');
    await expect(page.getByTestId('resource-count')).toHaveText(String(resourceBaseline));
  }
  if (phase === 4) {
    const waitForSleeping = async () => {
      await expect(page.getByTestId('renderer-state')).toHaveText('ready', {
        timeout: 60_000,
      });
      await expect(page.getByTestId('render-mode')).toHaveText('sleeping', {
        timeout: 60_000,
      });
      await expect(page.getByTestId('sample-count')).toHaveText('16', {
        timeout: 60_000,
      });
      await expect(page.getByTestId('raf-active')).toHaveText('false');
      await expect(page.getByTestId('history-valid')).toHaveText('valid');
    };
    await waitForSleeping();
    const resourceBaseline = Number(await page.getByTestId('resource-count').textContent());
    expect(resourceBaseline).toBeGreaterThan(0);
    await expect(page.getByTestId('resource-verdict')).toHaveText('stable');

    const wakeCount = page.getByTestId('wake-count');
    const historyGeneration = page.getByTestId('history-generation');
    const exerciseReset = async (action: () => Promise<void>) => {
      const previousWake = Number(await wakeCount.textContent());
      const previousGeneration = Number(await historyGeneration.textContent());
      await action();
      await expect
        .poll(async () => Number(await wakeCount.textContent()))
        .toBeGreaterThan(previousWake);
      await expect
        .poll(async () => Number(await historyGeneration.textContent()))
        .toBeGreaterThan(previousGeneration);
      await waitForSleeping();
      await expect(page.getByTestId('resource-count')).toHaveText(String(resourceBaseline));
    };

    await exerciseReset(() => page.locator('[data-action="orbit-right"]').click());
    await exerciseReset(() => page.locator('[data-control="roughness"]').fill('0.63'));
    await exerciseReset(() => page.locator('[data-action="texture"]').click());
    await exerciseReset(() => page.locator('[data-action="reset-history"]').click());

    await page.locator('[data-action="animation"]').click();
    await expect(page.getByTestId('render-mode')).toHaveText('interactive');
    await expect(page.getByTestId('raf-active')).toHaveText('true');
    const animatedFrame = Number(await page.getByTestId('frame-index').textContent());
    await expect
      .poll(async () => Number(await page.getByTestId('frame-index').textContent()))
      .toBeGreaterThan(animatedFrame + 2);
    await page.locator('[data-action="animation"]').click();
    await waitForSleeping();

    await page.locator('[data-action="lose"]').click();
    await expect(page.getByTestId('renderer-state')).toHaveText('lost');
    await expect(page.getByTestId('resource-count')).toHaveText('0');
    await expect(page.getByTestId('surface-size')).toHaveText('unavailable');
    await page.locator('[data-action="recover"]').click();
    await waitForSleeping();
    await expect(page.getByTestId('resource-count')).toHaveText(String(resourceBaseline));
    await page.locator('[data-action="dispose"]').click();
    await expect(page.getByTestId('renderer-state')).toHaveText('disposed');
    await expect(page.getByTestId('resource-count')).toHaveText('0');
    await page.locator('[data-action="recreate"]').click();
    await waitForSleeping();
    await expect(page.getByTestId('resource-count')).toHaveText(String(resourceBaseline));
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
