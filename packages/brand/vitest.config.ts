import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'brand',
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    testTimeout: 60_000,
  },
});
