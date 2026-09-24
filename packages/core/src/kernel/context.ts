import type { Database } from '@jave/database';
import type { Actor } from '../permissions/actor';
import { TtlCache } from './cache';
import { type Clock, systemClock } from './clock';
import { newRequestId } from './ids';
import { type Logger, silentLogger } from './logger';

/** Deployment-level configuration the domain layer needs. No secrets beyond what a service must use. */
export interface CoreConfig {
  /** Discord IDs granted FOUNDER on first contact (bootstrap). */
  founderDiscordIds: readonly string[];
  guildId?: string;
  /** Base URL of the dashboard, for links in notifications. */
  publicUrl?: string;
  /** 32-byte base64 key for secrets at rest. */
  encryptionKey?: string;
}

/** Side effects enqueued during a unit of work (shared across nested contexts). */
export interface EffectTracker {
  jobIds: number[];
}

/**
 * Everything a service function needs. Passed explicitly — there is no global
 * state. Bot interactions, dashboard requests and jobs each build their own.
 */
export interface ServiceContext {
  /** Current executor. Inside withTransaction this is the transaction. */
  db: Database;
  /** Always the non-transactional handle (for writes that must survive a rollback). */
  rootDb: Database;
  actor: Actor;
  clock: Clock;
  logger: Logger;
  requestId: string;
  effects: EffectTracker;
  cache: TtlCache;
  config: CoreConfig;
}

export interface CreateContextOptions {
  db: Database;
  actor: Actor;
  clock?: Clock;
  logger?: Logger;
  requestId?: string;
  cache?: TtlCache;
  config?: Partial<CoreConfig>;
}

export function createContext(options: CreateContextOptions): ServiceContext {
  const requestId = options.requestId ?? newRequestId();
  return {
    db: options.db,
    rootDb: options.db,
    actor: options.actor,
    clock: options.clock ?? systemClock,
    logger: (options.logger ?? silentLogger).child({ requestId }),
    requestId,
    effects: { jobIds: [] },
    cache: options.cache ?? new TtlCache(),
    config: { founderDiscordIds: [], ...options.config },
  };
}

/** Same request, different actor (e.g. system follow-up work inside a user action). */
export function withActor(ctx: ServiceContext, actor: Actor): ServiceContext {
  return { ...ctx, actor };
}

/**
 * Run `fn` in a database transaction. Nested calls become savepoints.
 * Jobs enqueued inside are only visible to workers after commit.
 */
export async function withTransaction<T>(
  ctx: ServiceContext,
  fn: (tx: ServiceContext) => Promise<T>,
): Promise<T> {
  return ctx.db.transaction(async (tx) => fn({ ...ctx, db: tx as unknown as Database }));
}
