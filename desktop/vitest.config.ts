import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Mock Electron modules that are unavailable in test
    alias: {
      electron: new URL('./src/__mocks__/electron.ts', import.meta.url)
        .pathname,
    },
  },
});
