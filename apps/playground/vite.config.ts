import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, '.', '');
  return {
    base: environment['PLAYGROUND_BASE_PATH'] ?? '/',
    build: {
      manifest: true,
    },
  };
});
