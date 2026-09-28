import { defineConfig } from 'vitest/config';

/** Unit tests only (pure modules, node environment). Playwright covers the UI end to end. */
export default defineConfig({
  test: {
    name: 'activity',
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
