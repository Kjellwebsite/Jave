import 'server-only';
import { consumeRateLimit, type ServiceContext } from '@jave/core';

/**
 * Request budgets per caller (fixed windows in the shared rate-limit table,
 * so they hold across dashboard instances). Polling runs at 1 Hz per player;
 * the budgets leave room for reconnect bursts and nothing more.
 */
export const ACTIVITY_RATE_LIMITS = {
  /**
   * Code exchanges sent to Discord, per client IP. Inside Discord every
   * request arrives through Discord's proxy, so this is in effect one budget
   * shared by every member: a circuit breaker that keeps a flood of junk
   * codes from reaching Discord under JAVELIN's credentials, sized so a whole
   * event launching at once stays far below it. Even held open for ten
   * minutes it stays under Discord's invalid-request limit (10,000 per ten
   * minutes per IP), which would otherwise lock out the bot sharing that IP.
   * Only well-formed requests that are about to call Discord spend it; the
   * per-account budget below does the fine-grained work.
   */
  token: { limit: 600, windowSeconds: 60 },
  /** Code exchanges per Discord account (checked once Discord named the user). */
  tokenUser: { limit: 10, windowSeconds: 60 },
  /** MOCK / DEVELOPMENT ONLY — dev-persona sign-ins, per client IP. */
  devToken: { limit: 60, windowSeconds: 60 },
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

/**
 * Throws RateLimitedError (HTTP 429 with Retry-After) when the budget is
 * spent. The request that uses the last unit of a window is logged once, so
 * an exhausted budget (a flood, or a legitimate burst outgrowing it) is
 * visible to operators without a log line per refused request. The caller key
 * is a user id or a keyed hash of the client IP, never a raw address.
 */
export async function spendActivityBudget(
  ctx: ServiceContext,
  kind: ActivityRateLimit,
  callerKey: string,
): Promise<void> {
  const { limit, windowSeconds } = ACTIVITY_RATE_LIMITS[kind];
  const caller = callerKey.slice(0, MAX_KEY_PART_LENGTH);
  const { remaining } = await consumeRateLimit(
    ctx,
    `activity:${kind}:${caller}`,
    limit,
    windowSeconds,
  );
  if (remaining === 0) {
    ctx.logger.warn({ budget: kind, caller, limit, windowSeconds }, 'activity budget exhausted');
  }
}

/** Upper bounds on request bodies, in bytes. */
export const BODY_LIMITS = {
  token: 2048,
  session: 1024,
  move: 512,
} as const;
