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
