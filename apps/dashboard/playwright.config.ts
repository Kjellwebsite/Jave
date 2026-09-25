import { randomBytes } from 'node:crypto';
import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against a production build (`next build` runs first via
 * `pnpm test:e2e`) and a real PostgreSQL database that is reset, migrated and
 * seeded before the server starts. Dev login (MOCK / DEVELOPMENT ONLY) is
 * enabled by running `next start` with NODE_ENV=test.
 */
const PORT = 3107;
const BASE_URL = `http://localhost:${PORT}`;
const DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgres://jave:jave@localhost:5432/jave_e2e_dash';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  outputDir: './test-results',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: `pnpm exec tsx e2e/prepare-db.ts && pnpm exec next start -p ${PORT}`,
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'warn',
      DATABASE_URL,
      DISCORD_CLIENT_ID: '200000000000000001',
      DISCORD_GUILD_ID: '300000000000000001',
      JAVE_PUBLIC_URL: BASE_URL,
      JAVE_SESSION_SECRET: randomBytes(32).toString('hex'),
      JAVE_DEV_AUTH: 'true',
    },
  },
});
