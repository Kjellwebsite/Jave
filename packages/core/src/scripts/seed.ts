/**
 * `pnpm db:seed [--reset]` — DEVELOPMENT DATA ONLY.
 *
 * Seeds an empty, migrated database with the development organization
 * (see `src/seed`). Refuses under NODE_ENV=production, against URLs that
 * name production, and on a database that already has members. `--reset`
 * first empties every JAVE table (local databases only), then seeds.
 *
 * Lives in @jave/core rather than @jave/database because the seed runs the
 * real core services, and the database package cannot depend on core.
 */
import { baseEnvSchema, databaseEnvSchema, EnvError, parseEnv } from '@jave/config';
import { createDatabase } from '@jave/database';
import {
  existingMemberCount,
  resetDatabase,
  SeedRefusedError,
  seedDevelopmentData,
  seedRefusal,
} from '../seed';

const USAGE = 'usage: pnpm db:seed [--reset]';
const RESET_FLAG = '--reset';
const HELP_FLAGS = new Set(['--help', '-h']);
/** pnpm forwards a literal `--` separator on some versions. */
const ARGUMENT_SEPARATOR = '--';
const MS_PER_SECOND = 1000;
const COUNT_LABEL_WIDTH = 24;
/** Postgres "undefined_table": the schema was never migrated. */
const UNDEFINED_TABLE = '42P01';

interface CliArgs {
  reset: boolean;
  help: boolean;
}

class UsageError extends Error {}

function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = { reset: false, help: false };
  for (const arg of argv) {
    if (arg === RESET_FLAG) args.reset = true;
    else if (HELP_FLAGS.has(arg)) args.help = true;
    else if (arg !== ARGUMENT_SEPARATOR)
      throw new UsageError(`unknown argument "${arg}"\n${USAGE}`);
  }
  return args;
}

function isUndefinedTable(error: unknown): boolean {
  const withCode = error as { code?: unknown; cause?: { code?: unknown } } | null;
  return withCode?.code === UNDEFINED_TABLE || withCode?.cause?.code === UNDEFINED_TABLE;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return;
  }
  const env = parseEnv(baseEnvSchema.extend(databaseEnvSchema.shape));
  const refusal = seedRefusal({
    nodeEnv: env.NODE_ENV,
    databaseUrl: env.DATABASE_URL,
    reset: args.reset,
  });
  if (refusal) throw new SeedRefusedError(refusal);

  const handle = createDatabase(env.DATABASE_URL, { applicationName: 'jave-seed' });
  try {
    let members: number;
    try {
      members = await existingMemberCount(handle.db);
    } catch (error) {
      if (isUndefinedTable(error)) {
        throw new SeedRefusedError('the database is not migrated. Run `pnpm db:migrate` first.');
      }
      throw error;
    }
    if (members > 0 && !args.reset) {
      throw new SeedRefusedError(
        `the database already holds ${members} members. Refusing to seed twice; pass ${RESET_FLAG} to replace them (local databases only).`,
      );
    }
    if (args.reset) {
      const tables = await resetDatabase(handle.db);
      console.log(`reset: emptied ${tables} tables and restored the reference data`);
    }

    const started = Date.now();
    console.log('seeding the development organization…');
    const report = await seedDevelopmentData(handle.db);
    const seconds = ((Date.now() - started) / MS_PER_SECOND).toFixed(1);
    console.log(
      `seeded in ${seconds}s — the organization's "now" is ${report.anchor.toISOString()}`,
    );
    for (const [table, count] of Object.entries(report.counts)) {
      console.log(`  ${table.padEnd(COUNT_LABEL_WIDTH)}${count}`);
    }
    console.log(`  ${'jobs scheduled ahead'.padEnd(COUNT_LABEL_WIDTH)}${report.pendingJobs}`);
    if (report.jobFailures.length > 0) {
      console.warn(`warning: ${report.jobFailures.length} background jobs failed during the seed:`);
      for (const failure of report.jobFailures) {
        console.warn(`  ${failure.type}: ${failure.error ?? failure.status}`);
      }
    }
    console.log('Sign in with a dev persona (JAVE_DEV_AUTH=true) to explore it.');
  } finally {
    await handle.close();
  }
}

main().catch((error: unknown) => {
  const known =
    error instanceof SeedRefusedError || error instanceof EnvError || error instanceof UsageError;
  if (known) console.error(error.message);
  else console.error('seed failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
