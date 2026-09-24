/**
 * Resets, migrates and seeds the end-to-end database. Refuses any database
 * whose name does not contain "e2e", so it can never wipe real data.
 */
import { spawnSync } from 'node:child_process';
import postgres from 'postgres';
import { databaseEnvSchema, parseEnv } from '@jave/config';
import { seedDashboardFixtures } from './seed';

const E2E_DATABASE_NAME = /e2e/i;

async function main(): Promise<void> {
  const { DATABASE_URL } = parseEnv(databaseEnvSchema);
  const name = decodeURIComponent(new URL(DATABASE_URL).pathname.slice(1));
  if (!E2E_DATABASE_NAME.test(name)) {
    throw new Error(
      `refusing to reset "${name}": end-to-end databases must contain "e2e" in their name`,
    );
  }
  const sql = postgres(DATABASE_URL, { max: 1, onnotice: () => undefined });
  try {
    await sql.unsafe(
      'drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;',
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
  const migrate = spawnSync('pnpm', ['--filter', '@jave/database', 'migrate'], {
    stdio: 'inherit',
  });
  if (migrate.status !== 0) throw new Error('migration failed');
  await seedDashboardFixtures(DATABASE_URL);
  console.log(`e2e database "${name}" ready`);
}

main().catch((error: unknown) => {
  console.error('e2e database preparation failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
