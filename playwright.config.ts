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

export default defineConfig({
  expect: {
    timeout: 5_000,
  },
  fullyParallel: false,
  outputDir: 'test-results/phase-00/runtime/playwright',
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: webGpuLaunchArguments,
          ...(chromiumExecutablePath === undefined
            ? {}
            : { executablePath: chromiumExecutablePath }),
        },
      },
    },
  ],
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  retries: process.env['CI'] === undefined ? 0 : 1,
  snapshotPathTemplate: '{testDir}/../../visual-baselines/phase-00/{arg}{ext}',
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
