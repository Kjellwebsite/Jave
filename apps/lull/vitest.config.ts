import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
      // `server-only` throws outside the React Server Components graph; tests run in plain Node.
      'server-only': fileURLToPath(new URL('./lib/testing/server-only.ts', import.meta.url)),
    },
  },
  test: {
    name: 'lull',
    environment: 'node',
    include: ['{lib,components,app}/**/*.test.{ts,tsx}'],
  },
});
