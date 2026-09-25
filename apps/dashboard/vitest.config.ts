import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
      // `server-only` throws outside the React Server Components graph; tests run in plain Node.
      'server-only': fileURLToPath(new URL('./test/server-only.ts', import.meta.url)),
    },
  },
  test: {
    name: 'dashboard',
    environment: 'node',
    include: ['{lib,server,components}/**/*.test.{ts,tsx}'],
    // Database tests run on PGlite (Postgres in WASM); generous limits for shared machines.
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
