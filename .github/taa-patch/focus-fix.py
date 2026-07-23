from pathlib import Path

path = Path('tests/e2e/phase-04-acceptance.spec.ts')
source = path.read_text(encoding='utf-8')
old_reset = """    await page.getByRole('button', { name: 'Reset scene' }).click();
    await page.getByRole('button', { name: 'Default TAA' }).click();
    await waitForSleeping(page);"""
new_reset = """    await page.getByRole('button', { name: 'Reset scene' }).click();
    await waitForSleeping(page);"""
if old_reset not in source:
    raise SystemExit('Frozen visual reset sequence source was not found.')
source = source.replace(old_reset, new_reset, 1)
old_focus = """    await expect(page.getByTestId('resource-count')).toHaveText(String(initialResources));
    await page.evaluate(() => document.fonts.ready);"""
new_focus = """    await expect(page.getByTestId('resource-count')).toHaveText(String(initialResources));
    await page.getByRole('button', { name: 'Orbit right' }).focus();
    await page.evaluate(() => document.fonts.ready);"""
if old_focus not in source:
    raise SystemExit('Frozen visual focus insertion point was not found.')
path.write_text(source.replace(old_focus, new_focus, 1), encoding='utf-8')
