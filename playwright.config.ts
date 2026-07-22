import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const chromiumExecutablePath = process.env['PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH'];
const webGpuLaunchArguments = [
  '--disable-vulkan-surface',
  '--enable-features=Vulkan',
  '--enable-unsafe-swiftshader',
  '--enable-unsafe-webgpu',
  '--use-angle=swiftshader',
  '--use-gpu-in-tests',
  '--use-vulkan=swiftshader',
  '--use-webgpu-adapter=swiftshader',
];
const chromiumUse = {
  ...devices['Desktop Chrome'],
  launchOptions: {
    args: webGpuLaunchArguments,
    ...(chromiumExecutablePath === undefined ? {} : { executablePath: chromiumExecutablePath }),
  },
};

export default defineConfig({
  expect: {
    timeout: 5_000,
  },
  fullyParallel: false,
  outputDir: 'test-results/phase-00/runtime/playwright',
  projects: [
    {
      name: 'chromium',
      snapshotPathTemplate: '{testDir}/../../visual-baselines/phase-00/{arg}{ext}',
      testMatch: /phase-00\.spec\.ts/,
      use: chromiumUse,
    },
    {
      name: 'chromium-webgpu',
      snapshotPathTemplate: '{testDir}/../../visual-baselines/phase-01/{arg}{ext}',
      testMatch: /phase-01\.spec\.ts/,
      use: chromiumUse,
    },
    {
      name: 'chromium-scene',
      snapshotPathTemplate: '{testDir}/../../visual-baselines/phase-02/{arg}{ext}',
      testMatch: /phase-02\.spec\.ts/,
      use: chromiumUse,
    },
    {
      name: 'chromium-pbr',
      snapshotPathTemplate: '{testDir}/../../visual-baselines/phase-03/{arg}{ext}',
      testMatch: /phase-03-(?:brdf|environment|gallery|ibl)\.spec\.ts/,
      use: chromiumUse,
    },
  ],
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  retries: process.env['CI'] === undefined ? 0 : 1,
  testDir: './tests/e2e',
  timeout: 30_000,
  use: {
    baseURL: BASE_URL,
    colorScheme: 'dark',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'off',
  },
  webServer: {
    command: `pnpm --dir apps/playground exec vite --host 127.0.0.1 --port ${PORT}`,
    reuseExistingServer: process.env['CI'] === undefined,
    stderr: 'pipe',
    stdout: 'pipe',
    timeout: 120_000,
    url: BASE_URL,
  },
  workers: 1,
});
