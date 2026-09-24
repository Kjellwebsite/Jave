import 'server-only';
import { type DashboardEnv, dashboardEnvSchema, parseEnv } from '@jave/config';
import { type CoreConfig, createLogger, type Logger, TtlCache } from '@jave/core';
import { createDatabase, type DatabaseHandle } from '@jave/database';

/** Process-wide singletons. Built once, lazily, on first use (never at build time). */
export interface DashboardRuntime {
  env: DashboardEnv;
  database: DatabaseHandle;
  logger: Logger;
  cache: TtlCache;
  coreConfig: CoreConfig;
}

const RUNTIME_KEY = Symbol.for('jave.dashboard.runtime');

type RuntimeHost = typeof globalThis & { [RUNTIME_KEY]?: DashboardRuntime };

function createRuntime(): DashboardRuntime {
  const env = parseEnv(dashboardEnvSchema);
  return {
    env,
    database: createDatabase(env.DATABASE_URL, {
      max: env.DATABASE_POOL_MAX,
      applicationName: 'jave-dashboard',
    }),
    logger: createLogger({ name: 'dashboard', level: env.LOG_LEVEL }),
    cache: new TtlCache(),
    coreConfig: {
      founderDiscordIds: env.JAVE_FOUNDER_DISCORD_IDS,
      guildId: env.DISCORD_GUILD_ID,
      publicUrl: env.JAVE_PUBLIC_URL,
      encryptionKey: env.JAVE_ENCRYPTION_KEY,
    },
  };
}

/**
 * Stored on globalThis so `next dev` module reloads reuse one connection pool
 * instead of leaking a new one per edit.
 */
export function getRuntime(): DashboardRuntime {
  const host = globalThis as RuntimeHost;
  host[RUNTIME_KEY] ??= createRuntime();
  return host[RUNTIME_KEY];
}
