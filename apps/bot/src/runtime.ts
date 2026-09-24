import type { Database } from '@jave/database';
import type { Clock, CoreConfig, HealthReport, Logger, TtlCache } from '@jave/core';
import type { DiscordGateway } from './discord/gateway';

/**
 * Process-wide dependencies shared by every interaction, gateway event and
 * job handler. Built once in main.ts (and by the test harness).
 */
export interface BotServices {
  db: Database;
  clock: Clock;
  logger: Logger;
  cache: TtlCache;
  config: CoreConfig;
  discord: { clientId: string; guildId: string };
  gateway: DiscordGateway;
  /** Execute specific queued jobs now (the side effects of a just-committed interaction). */
  runJobsNow(jobIds: readonly number[]): Promise<void>;
  health(): Promise<HealthReport>;
}
