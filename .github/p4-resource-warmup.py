from pathlib import Path


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    source = path.read_text(encoding='utf-8')
    if old not in source:
        raise SystemExit(f'{label} source was not found in {path}.')
    path.write_text(source.replace(old, new, 1), encoding='utf-8')


playground = Path('apps/playground/src/acceptance/phase-04/index.ts')
replace_once(
    playground,
    """  taa: TemporalTaaSettings;\n  textureAlternate: boolean;""",
    """  taa: TemporalTaaSettings;\n  taaResourceWarmupComplete: boolean;\n  taaResourceWarmupPending: boolean;\n  textureAlternate: boolean;""",
    'runtime TAA warmup fields',
)
replace_once(
    playground,
    """  const next = createTemporalTaaSettings(descriptor, base);\n  runtime.taa = runtime.renderer?.setTemporalTaaSettings(taaSettingsDescriptor(next)) ?? next;\n  syncTaaPanel(root, runtime.taa);""",
    """  const next = createTemporalTaaSettings(descriptor, base);\n  if (runtime.renderer !== undefined && !runtime.taaResourceWarmupComplete) {\n    runtime.taaResourceWarmupPending = true;\n  }\n  runtime.taa = runtime.renderer?.setTemporalTaaSettings(taaSettingsDescriptor(next)) ?? next;\n  syncTaaPanel(root, runtime.taa);""",
    'TAA warmup scheduling',
)
replace_once(
    playground,
    """    runtime.baselineResources ??= renderer.getDiagnostics().backend.resources.activeCount;\n    updateDiagnostics(root, runtime);""",
    """    const activeResources = renderer.getDiagnostics().backend.resources.activeCount;\n    if (runtime.taaResourceWarmupPending) {\n      runtime.baselineResources = activeResources;\n      runtime.taaResourceWarmupPending = false;\n      runtime.taaResourceWarmupComplete = true;\n    } else {\n      runtime.baselineResources ??= activeResources;\n    }\n    updateDiagnostics(root, runtime);""",
    'sleep resource baseline lock',
)
replace_once(
    playground,
    """  runtime.baselineResources = undefined;\n  runtime.disposedResources = undefined;""",
    """  runtime.baselineResources = undefined;\n  runtime.taaResourceWarmupComplete = false;\n  runtime.taaResourceWarmupPending = false;\n  runtime.disposedResources = undefined;""",
    'renderer warmup reset',
)
replace_once(
    playground,
    """    taa: TEMPORAL_TAA_DEFAULT_SETTINGS,\n    textureAlternate: false,""",
    """    taa: TEMPORAL_TAA_DEFAULT_SETTINGS,\n    taaResourceWarmupComplete: false,\n    taaResourceWarmupPending: false,\n    textureAlternate: false,""",
    'runtime warmup initialization',
)

local_test = Path('tests/e2e/phase-04-acceptance.spec.ts')
replace_once(
    local_test,
    """    await waitForSleeping(page);\n    await expect(page.getByTestId('resource-count')).toHaveText(String(initialResources));\n    await page.getByRole('button', { name: 'Default TAA' }).click();\n    await expect(page.getByTestId('taa-current-jitter')).toHaveText('1.00');\n    await waitForSleeping(page);""",
    """    await waitForSleeping(page);\n    const taaWarmedResources = await numericText(page, 'resource-count');\n    expect(taaWarmedResources).toBeGreaterThanOrEqual(initialResources);\n    expect(taaWarmedResources).toBeLessThanOrEqual(initialResources + 2);\n    await expect(page.getByTestId('resource-baseline')).toHaveText(String(taaWarmedResources));\n    await expect(page.getByTestId('resource-verdict')).toHaveText('stable');\n    await page.getByRole('button', { name: 'Default TAA' }).click();\n    await expect(page.getByTestId('taa-current-jitter')).toHaveText('1.00');\n    await waitForSleeping(page);\n    await expect(page.getByTestId('resource-count')).toHaveText(String(taaWarmedResources));""",
    'local TAA warmup assertion',
)
replace_once(
    local_test,
    """    expect(resourcesAfterTextureWarm).toBeGreaterThanOrEqual(initialResources);\n    expect(resourcesAfterTextureWarm).toBeLessThanOrEqual(initialResources + 2);""",
    """    expect(resourcesAfterTextureWarm).toBeGreaterThanOrEqual(taaWarmedResources);\n    expect(resourcesAfterTextureWarm).toBeLessThanOrEqual(taaWarmedResources + 2);""",
    'local texture warm bounds',
)
replace_once(
    local_test,
    """    expect(resourcesAfterTextureReuse).toBeGreaterThanOrEqual(initialResources);\n    expect(resourcesAfterTextureReuse).toBeLessThanOrEqual(initialResources + 2);""",
    """    expect(resourcesAfterTextureReuse).toBeGreaterThanOrEqual(taaWarmedResources);\n    expect(resourcesAfterTextureReuse).toBeLessThanOrEqual(taaWarmedResources + 2);""",
    'local texture reuse bounds',
)

online_test = Path('tests/e2e/online-pages.spec.ts')
replace_once(
    online_test,
    """    await exerciseReset(\n      () => page.locator('[data-taa-control=\"jitterScale\"][type=\"number\"]').fill('0.35'),\n      resourceBaseline,\n    );\n    await expect(page.getByTestId('taa-current-jitter')).toHaveText('0.35');\n    await exerciseReset(\n      () => page.getByRole('button', { name: 'Default TAA' }).click(),\n      resourceBaseline,\n    );\n    await expect(page.getByTestId('taa-current-jitter')).toHaveText('1.00');\n\n    let activeResources = await exerciseReset(() =>\n      page.locator('[data-action=\"orbit-right\"]').click(),\n    );""",
    """    const taaWarmedResources = await exerciseReset(() =>\n      page.locator('[data-taa-control=\"jitterScale\"][type=\"number\"]').fill('0.35'),\n    );\n    expect(taaWarmedResources).toBeGreaterThanOrEqual(resourceBaseline);\n    expect(taaWarmedResources).toBeLessThanOrEqual(resourceBaseline + 2);\n    await expect(page.getByTestId('resource-baseline')).toHaveText(String(taaWarmedResources));\n    await expect(page.getByTestId('resource-verdict')).toHaveText('stable');\n    await expect(page.getByTestId('taa-current-jitter')).toHaveText('0.35');\n    await exerciseReset(\n      () => page.getByRole('button', { name: 'Default TAA' }).click(),\n      taaWarmedResources,\n    );\n    await expect(page.getByTestId('taa-current-jitter')).toHaveText('1.00');\n\n    let activeResources = await exerciseReset(\n      () => page.locator('[data-action=\"orbit-right\"]').click(),\n      taaWarmedResources,\n    );""",
    'online TAA warmup assertion',
)
