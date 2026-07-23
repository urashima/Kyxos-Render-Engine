from pathlib import Path

path = Path('tests/e2e/phase-04-acceptance.spec.ts')
source = path.read_text(encoding='utf-8')
old = """    await page.getByRole('button', { name: 'Reset scene' }).click();
    await page.getByRole('button', { name: 'Default TAA' }).click();
    await waitForSleeping(page);"""
new = """    await page.getByRole('button', { name: 'Reset scene' }).click();
    await waitForSleeping(page);"""
if old not in source:
    raise SystemExit('Frozen visual sequence source was not found.')
path.write_text(source.replace(old, new, 1), encoding='utf-8')
