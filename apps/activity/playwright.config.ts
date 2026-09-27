import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests of the Activity in its standalone dev mode (MOCK /
 * DEVELOPMENT ONLY): the Vite dev server in front of a running dashboard
 * (`next dev`, dev auth on) and a real PostgreSQL database that is reset,
 * migrated and seeded before the dashboard starts.
 *
 *   pnpm --filter @jave/activity test:e2e
 *   JAVE_SCREENSHOTS=1 pnpm --filter @jave/activity test:e2e   # refresh docs/screenshots
 */
const DASHBOARD_PORT = Number(process.env.E2E_DASHBOARD_PORT ?? 3127);
const ACTIVITY_PORT = Number(process.env.E2E_ACTIVITY_PORT ?? 5187);
const DASHBOARD_URL = `http://localhost:${DASHBOARD_PORT}`;
const ACTIVITY_URL = `http://localhost:${ACTIVITY_PORT}`;
const DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgres://jave:jave@localhost:5432/jave_e2e_activity';
/** E2E_REUSE=1 runs against servers that are already up (local iteration only). */
const REUSE = process.env.E2E_REUSE === '1';
const DASHBOARD_DIR = fileURLToPath(new URL('../dashboard/', import.meta.url));
const SERVER_START_TIMEOUT_MS = 240_000;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 240_000,
  expect: { timeout: 30_000 },
  reporter: [['list']],
  outputDir: './test-results',
  use: {
    baseURL: ACTIVITY_URL,
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: [
    {
      command: `pnpm exec tsx ../activity/e2e/prepare-db.ts && pnpm exec next dev -p ${DASHBOARD_PORT}`,
      cwd: DASHBOARD_DIR,
      url: `${DASHBOARD_URL}/api/health`,
      reuseExistingServer: REUSE,
      timeout: SERVER_START_TIMEOUT_MS,
      stdout: 'ignore',
      stderr: 'pipe',
      env: {
        NODE_ENV: 'development',
        LOG_LEVEL: 'warn',
        DATABASE_URL,
        DISCORD_CLIENT_ID: '200000000000000001',
        DISCORD_GUILD_ID: '300000000000000001',
        JAVE_PUBLIC_URL: DASHBOARD_URL,
        JAVE_SESSION_SECRET: randomBytes(32).toString('hex'),
        JAVE_DEV_AUTH: 'true',
      },
    },
    {
      command: `pnpm exec vite --port ${ACTIVITY_PORT} --strictPort`,
      url: ACTIVITY_URL,
      reuseExistingServer: REUSE,
      timeout: SERVER_START_TIMEOUT_MS,
      stdout: 'ignore',
      stderr: 'pipe',
      env: {
        JAVE_ACTIVITY_API_TARGET: DASHBOARD_URL,
        JAVE_ACTIVITY_PORT: String(ACTIVITY_PORT),
      },
    },
  ],
});
