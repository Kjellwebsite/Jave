import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Every package/app with its own vitest config is a project; apps without one
    // (e.g. Playwright-only suites) are never picked up by accident.
    projects: ['packages/*/vitest.config.ts', 'apps/*/vitest.config.ts'],
  },
});
