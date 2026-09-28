import 'server-only';
import { consumeRateLimit, type ServiceContext } from '@jave/core';

/**
 * Request budgets per caller (fixed windows in the shared rate-limit table,
 * so they hold across dashboard instances). Polling runs at 1 Hz per player;
 * the budgets leave room for reconnect bursts and nothing more.
 */
export const ACTIVITY_RATE_LIMITS = {
  /**
   * Code exchange and dev tokens, per client IP. Inside Discord every request
   * arrives through Discord's proxy, so this is close to a global budget:
   * generous, with the per-user budget below doing the fine-grained work.
   */
  token: { limit: 60, windowSeconds: 60 },
  /** Code exchanges per Discord account (checked once Discord named the user). */
  tokenUser: { limit: 10, windowSeconds: 60 },
  /** Mission Control refreshes, per user. */
  me: { limit: 30, windowSeconds: 60 },
  /** Arena state polls and timer nudges, per user. */
  poll: { limit: 150, windowSeconds: 60 },
  /** Answers, per user. */
  move: { limit: 40, windowSeconds: 60 },
  /** Open / join / start / leave, per user. */
  lobby: { limit: 20, windowSeconds: 60 },
  /** All-time board reads (on launch and after each game), per user. */
  board: { limit: 20, windowSeconds: 60 },
} as const;

export type ActivityRateLimit = keyof typeof ACTIVITY_RATE_LIMITS;

const MAX_KEY_PART_LENGTH = 64;

/** Throws RateLimitedError (HTTP 429 with Retry-After) when the budget is spent. */
export async function spendActivityBudget(
  ctx: ServiceContext,
  kind: ActivityRateLimit,
  callerKey: string,
): Promise<void> {
  const { limit, windowSeconds } = ACTIVITY_RATE_LIMITS[kind];
  await consumeRateLimit(
    ctx,
    `activity:${kind}:${callerKey.slice(0, MAX_KEY_PART_LENGTH)}`,
    limit,
    windowSeconds,
  );
}

/** Upper bounds on request bodies, in bytes. */
export const BODY_LIMITS = {
  token: 2048,
  session: 1024,
  move: 512,
} as const;
