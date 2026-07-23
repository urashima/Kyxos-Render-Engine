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
old_capture = """    await page.evaluate(() => window.scrollTo(0, 0));
    await waitForSleeping(page);
    const currentVisual = await page.screenshot({"""
new_capture = """    await page.evaluate(() => window.scrollTo(0, 0));
    await waitForSleeping(page);
    await page.getByRole('button', { name: 'Orbit right' }).hover();
    const currentVisual = await page.screenshot({"""
if old_capture not in source:
    raise SystemExit('Frozen visual capture insertion point was not found.')
path.write_text(source.replace(old_capture, new_capture, 1), encoding='utf-8')
