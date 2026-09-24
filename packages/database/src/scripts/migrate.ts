import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import type { Database } from '../client';
import { applyReferenceData } from '../reference-data';
import * as schema from '../schema';

/**
 * Applies pending migrations and reference data. Safe to run repeatedly;
 * intended as the release/pre-deploy step of every deployment.
 */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }
  const client = postgres(url, { max: 1, onnotice: () => undefined });
  const db = drizzle(client, { schema });
  // Bundled deployments (the bot container) point this at the copied migrations folder.
  const migrationsFolder =
    process.env.JAVE_MIGRATIONS_DIR ??
    join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'drizzle');
  const started = Date.now();
  try {
    await migrate(db, { migrationsFolder });
    await applyReferenceData(db as unknown as Database);
    console.log(`migrations applied in ${Date.now() - started}ms`);
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error('migration failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
