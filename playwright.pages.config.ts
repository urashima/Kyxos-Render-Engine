import { defineConfig, devices } from '@playwright/test';

const publicPlaygroundUrl = process.env['PUBLIC_PLAYGROUND_URL'];
if (publicPlaygroundUrl === undefined) {
  throw new Error('PUBLIC_PLAYGROUND_URL is required for online Pages verification.');
}

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
  expect: { timeout: 10_000 },
  fullyParallel: false,
  outputDir: 'test-results/pages/runtime/playwright',
  projects: [
    {
      name: 'chromium-pages-online',
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
  reporter: [['list']],
  retries: 1,
  testDir: './tests/e2e',
  testMatch: /online-pages\.spec\.ts/,
  timeout: 30_000,
  use: {
    baseURL: publicPlaygroundUrl,
    colorScheme: 'dark',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'off',
  },
  workers: 1,
});
