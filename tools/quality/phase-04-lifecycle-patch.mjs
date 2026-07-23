import { readFile, writeFile } from 'node:fs/promises';

async function replaceExactly(path, pattern, replacement, label) {
  const source = await readFile(path, 'utf8');
  const matches = source.match(pattern);
  if (matches === null) throw new Error(`Expected ${label} was not found in ${path}.`);
  const next = source.replace(pattern, replacement);
  if (next === source) throw new Error(`${label} replacement did not change ${path}.`);
  await writeFile(path, next);
}

await replaceExactly(
  'packages/backend-webgpu/src/backend.ts',
  /  debugSimulateDeviceLoss\(\): void \{\n\s+this\.#requireDevice\('simulate Device Lost for diagnostics'\)\.destroy\(\);\n  \}/u,
  `  debugSimulateDeviceLoss(): void {
    const device = this.#requireDevice('simulate Device Lost for diagnostics');
    const generation = this.#deviceGeneration;
    device.destroy();
    this.#handleDeviceLost(
      generation,
      Object.freeze({
        message: 'WebGPU Device Lost was simulated for diagnostics.',
        reason: 'destroyed',
        recoverable: true,
      }),
    );
  }`,
  'diagnostic Device Lost method',
);

await replaceExactly(
  'packages/backend-webgpu/src/backend.ts',
  /    if \(this\.#state === 'disposed' \|\| generation !== this\.#deviceGeneration\) \{\n\s+return;\n    \}/u,
  `    if (
      this.#state === 'disposed' ||
      this.#state === 'lost' ||
      generation !== this.#deviceGeneration
    ) {
      return;
    }`,
  'Device Lost idempotency guard',
);

const backendTestPath = 'packages/backend-webgpu/test/webgpu-backend.test.ts';
const backendTest = await readFile(backendTestPath, 'utf8');
const backendTestStartMarker =
  "  it('simulates Device Lost for diagnostics without exposing the native device'";
const backendTestStart = backendTest.indexOf(backendTestStartMarker);
const backendTestEnd = backendTest.indexOf('\n  it(', backendTestStart + backendTestStartMarker.length);
if (backendTestStart < 0 || backendTestEnd < 0) {
  throw new Error('Expected diagnostic Device Lost test boundaries were not found.');
}
const backendTestReplacement = `  it('simulates Device Lost synchronously and ignores the later native loss resolution', async () => {
    const device = new FakeDevice();
    const backend = createWebGpuBackendForPlatform(
      {},
      new FakePlatform(true, [new FakeAdapter([], [device])]),
    );
    const onLost = vi.fn();
    backend.on('lost', onLost);
    await backend.initialize();
    backend.createBuffer({ size: 64, usage: ['vertex'] });

    backend.debugSimulateDeviceLoss();

    expect(device.destroy).toHaveBeenCalledTimes(1);
    expect(backend.state).toBe('lost');
    expect(backend.getResourceStatistics().activeCount).toBe(0);
    expect(onLost).toHaveBeenCalledExactlyOnceWith({
      message: 'WebGPU Device Lost was simulated for diagnostics.',
      reason: 'destroyed',
      recoverable: true,
    });

    device.lose({ message: 'native destroyed', reason: 'destroyed', recoverable: true });
    await Promise.resolve();
    expect(onLost).toHaveBeenCalledTimes(1);
  });
`;
await writeFile(
  backendTestPath,
  backendTest.slice(0, backendTestStart) + backendTestReplacement + backendTest.slice(backendTestEnd),
);

await replaceExactly(
  'apps/playground/src/acceptance/phase-04/index.ts',
  /  const surface = renderer\.getSurfaceInfo\(\);\n  requireElement\(root, '\[data-testid="surface-size"\]'\)\.textContent = surface\.size\.suspended\n    \? 'suspended'\n    : `\$\{surface\.size\.physicalWidth\}×\$\{surface\.size\.physicalHeight\}`;\n  requireElement\(root, '\[data-testid="surface-dpr"\]'\)\.textContent =\n    surface\.size\.devicePixelRatio\.toFixed\(2\);/u,
  `  if (base.state === 'ready') {
    const surface = renderer.getSurfaceInfo();
    requireElement(root, '[data-testid="surface-size"]').textContent = surface.size.suspended
      ? 'suspended'
      : \`\${surface.size.physicalWidth}×\${surface.size.physicalHeight}\`;
    requireElement(root, '[data-testid="surface-dpr"]').textContent =
      surface.size.devicePixelRatio.toFixed(2);
  } else {
    requireElement(root, '[data-testid="surface-size"]').textContent = 'unavailable';
    requireElement(root, '[data-testid="surface-dpr"]').textContent = '—';
  }`,
  'lost-safe Surface diagnostics block',
);

await replaceExactly(
  'tests/e2e/phase-04-acceptance.spec.ts',
  /const FIXED_VIEWPORT = \{ height: 1400, width: 1440 \};/u,
  'const FIXED_VIEWPORT = { height: 1600, width: 1440 };',
  'fixed visual viewport',
);

await replaceExactly(
  'tests/e2e/phase-04-acceptance.spec.ts',
  /    const currentVisual = await page\.getByTestId\('phase-04-acceptance'\)\.screenshot\(\{\n      animations: 'disabled',\n    \}\);/u,
  `    await page.evaluate(() => window.scrollTo(0, 0));
    await waitForSleeping(page);
    const currentVisual = await page.screenshot({
      animations: 'disabled',
      fullPage: false,
    });`,
  'fixed viewport visual capture',
);

await replaceExactly(
  'tests/e2e/phase-04-acceptance.spec.ts',
  /    await expect\(page\.getByTestId\('renderer-state'\)\)\.toHaveText\('lost'\);\n    await expect\(page\.getByTestId\('resource-count'\)\)\.toHaveText\('0'\);/u,
  `    await expect(page.getByTestId('renderer-state')).toHaveText('lost');
    await expect(page.getByTestId('resource-count')).toHaveText('0');
    await expect(page.getByTestId('surface-size')).toHaveText('unavailable');`,
  'lost Surface diagnostics assertion',
);

process.stdout.write('Phase 4 lifecycle patch generated: backend, test, route, acceptance.\n');
