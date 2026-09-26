import type { Database } from '@jave/database';
import type { ai, Clock, CoreConfig, HealthReport, Logger, TtlCache } from '@jave/core';
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
  /**
   * AI provider (built once from the environment by main.ts; the test harness
   * uses the MOCK / DEVELOPMENT ONLY MockProvider) and the deployment's daily
   * request ceiling. Pass it to every `ai.*` feature and to `ai.ticketSummarizer`.
   */
  ai: ai.AiDeps;
  /** Execute specific queued jobs now (the side effects of a just-committed interaction). */
  runJobsNow(jobIds: readonly number[]): Promise<void>;
  health(): Promise<HealthReport>;
}
