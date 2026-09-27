/**
 * `pnpm db:seed [--reset]` — DEVELOPMENT DATA ONLY.
 *
 * Seeds an empty, migrated database with the development organization.
 * Refuses under NODE_ENV=production, against URLs that name production, and
 * on a database that already has members. `--reset` first deletes every row
 * (local databases only), then seeds.
 */
import { baseEnvSchema, databaseEnvSchema, EnvError, parseEnv } from '@jave/config';
import { createDatabase } from '@jave/database';
import {
  existingMemberCount,
  resetDatabase,
  SeedRefusedError,
  seedDevelopmentData,
  seedRefusal,
} from './index';

const USAGE = 'usage: pnpm db:seed [--reset]';
const RESET_FLAG = '--reset';
const HELP_FLAGS = new Set(['--help', '-h']);
const MS_PER_SECOND = 1000;
const MIGRATION_HINT = 'Run `pnpm db:migrate` first.';

interface CliArgs {
  reset: boolean;
  help: boolean;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = { reset: false, help: false };
  for (const arg of argv) {
    if (arg === RESET_FLAG) args.reset = true;
    else if (HELP_FLAGS.has(arg)) args.help = true;
    else if (arg !== '--') throw new Error(`unknown argument "${arg}"\n${USAGE}`);
  }
  return args;
}

/** Postgres "relation does not exist": the schema was never migrated. */
function isMissingRelation(error: unknown): boolean {
  const code = (error as { code?: unknown; cause?: { code?: unknown } } | null)?.code;
  const causeCode = (error as { cause?: { code?: unknown } } | null)?.cause?.code;
  return code === '42P01' || causeCode === '42P01';
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return;
  }
  const refusal = seedRefusal({
    nodeEnv: process.env.NODE_ENV,
    databaseUrl: process.env.DATABASE_URL,
    reset: args.reset,
  });
  if (refusal) throw new SeedRefusedError(refusal);
  const env = parseEnv(baseEnvSchema.extend(databaseEnvSchema.shape));

  const handle = createDatabase(env.DATABASE_URL, { applicationName: 'jave-seed' });
  try {
    let members: number;
    try {
      members = await existingMemberCount(handle.db);
    } catch (error) {
      if (isMissingRelation(error)) throw new SeedRefusedError(`the database is not migrated. ${MIGRATION_HINT}`);
      throw error;
    }
    if (members > 0 && !args.reset) {
      throw new SeedRefusedError(
        `the database already holds ${members} members. Refusing to seed twice; pass ${RESET_FLAG} to replace them (local databases only).`,
      );
    }
    if (args.reset) {
      const tables = await resetDatabase(handle.db);
      console.log(`reset: emptied ${tables} tables and restored reference data`);
    }

    const started = Date.now();
    console.log('seeding the development organization…');
    const report = await seedDevelopmentData(handle.db);
    const seconds = ((Date.now() - started) / MS_PER_SECOND).toFixed(1);
    console.log(`seeded the development organization in ${seconds}s (anchor ${report.anchor.toISOString()})`);
    for (const [table, count] of Object.entries(report.counts)) {
      console.log(`  ${table.padEnd(24)}${count}`);
    }
    console.log(`  ${'jobs scheduled ahead'.padEnd(24)}${report.pendingJobs}`);
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
  const known = error instanceof SeedRefusedError || error instanceof EnvError;
  console.error(known ? error.message : 'seed failed:', known ? '' : error);
  process.exit(1);
});
