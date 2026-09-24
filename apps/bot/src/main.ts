import { EnvError, fullBotEnvSchema, parseEnv } from '@jave/config';
import { createLogger, systemClock, TtlCache } from '@jave/core';
import { createDatabase } from '@jave/database';
import { createBotApp } from './app';
import { createDiscordClient, wireClient } from './discord/client';
import { DiscordJsGateway } from './discord/discord-gateway';
import { allFeatures } from './features';
import { startHealthServer } from './health/server';

const SHUTDOWN_TIMEOUT_MS = 10_000;

async function main(): Promise<void> {
  let env;
  try {
    env = parseEnv(fullBotEnvSchema);
  } catch (error) {
    if (error instanceof EnvError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  const logger = createLogger({ name: 'jave-bot', level: env.LOG_LEVEL });
  const database = createDatabase(env.DATABASE_URL, {
    max: env.DATABASE_POOL_MAX,
    applicationName: 'jave-bot',
  });
  const client = createDiscordClient();
  const gateway = new DiscordJsGateway(client, env.DISCORD_GUILD_ID);
  const app = createBotApp({
    db: database.db,
    clock: systemClock,
    logger,
    cache: new TtlCache(),
    config: {
      founderDiscordIds: env.JAVE_FOUNDER_DISCORD_IDS,
      guildId: env.DISCORD_GUILD_ID,
      publicUrl: env.JAVE_PUBLIC_URL,
      encryptionKey: env.JAVE_ENCRYPTION_KEY,
    },
    discord: { clientId: env.DISCORD_CLIENT_ID, guildId: env.DISCORD_GUILD_ID },
    gateway,
    features: allFeatures(),
    worker: { concurrency: env.JAVE_WORKER_CONCURRENCY, pollMs: env.JAVE_WORKER_POLL_MS },
  });

  wireClient(client, app, env.DISCORD_GUILD_ID, logger);
  const health = startHealthServer({
    port: env.BOT_HEALTH_PORT,
    logger,
    report: () => app.services.health(),
  });

  try {
    const latency = await database.ping();
    logger.info({ latency }, 'database reachable');
  } catch (error) {
    logger.fatal({ err: error }, 'database unreachable — refusing to start');
    process.exit(1);
  }

  app.worker.start();
  logger.info(
    {
      commands: app.commands.length,
      features: app.features.length,
      jobTypes: app.worker.handlerTypes.length,
    },
    'jave starting',
  );

  let shuttingDown = false;
  const shutdown = (signal: string, exitCode = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    const force = setTimeout(() => {
      logger.error('forced shutdown after timeout');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    force.unref();
    void (async () => {
      await app.worker.stop();
      await client.destroy();
      health.close();
      await database.close();
      logger.info('shutdown complete');
      process.exit(exitCode);
    })();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) =>
    logger.error({ err: reason }, 'unhandled rejection'),
  );
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'uncaught exception');
    shutdown('uncaughtException', 1);
  });

  // discord.js reconnects on its own after the first successful login.
  await client.login(env.DISCORD_TOKEN).catch((error: unknown) => {
    logger.fatal({ err: error }, 'discord login failed');
    shutdown('login-failed', 1);
  });
}

void main();
