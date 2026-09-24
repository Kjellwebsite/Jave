import { sql } from 'drizzle-orm';
import { rateLimitBuckets } from '@jave/database';
import type { ServiceContext } from '../kernel/context';
import { RateLimitedError } from '../kernel/errors';

/**
 * Shared fixed-window rate limit backed by Postgres, so limits hold across
 * the bot and dashboard processes. Throws RateLimitedError when exceeded.
 */
export async function consumeRateLimit(
  ctx: ServiceContext,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<{ remaining: number }> {
  const now = ctx.clock.now();
  const windowStartCutoff = new Date(now.getTime() - windowSeconds * 1000);
  const [row] = await ctx.rootDb
    .insert(rateLimitBuckets)
    .values({ key, windowStart: now, count: 1 })
    .onConflictDoUpdate({
      target: rateLimitBuckets.key,
      set: {
        count: sql`case when ${rateLimitBuckets.windowStart} < ${windowStartCutoff} then 1 else least(${rateLimitBuckets.count} + 1, 32000) end`,
        windowStart: sql`case when ${rateLimitBuckets.windowStart} < ${windowStartCutoff} then ${now} else ${rateLimitBuckets.windowStart} end`,
      },
    })
    .returning({ count: rateLimitBuckets.count, windowStart: rateLimitBuckets.windowStart });
  const used = row?.count ?? 1;
  if (used > limit) {
    const resetAt = (row?.windowStart ?? now).getTime() + windowSeconds * 1000;
    throw new RateLimitedError(Math.max(1, Math.ceil((resetAt - now.getTime()) / 1000)));
  }
  return { remaining: limit - used };
}

/**
 * In-memory sliding window for hot paths (per-message automod, command spam).
 * Per process by design: it guards a single gateway connection.
 */
export class SlidingWindowCounter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly windowMs: number,
    private readonly maxKeys = 50_000,
  ) {}

  /** Record a hit and return the number of hits inside the window (including this one). */
  hit(key: string, nowMs: number): number {
    const cutoff = nowMs - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    list.push(nowMs);
    this.hits.set(key, list);
    if (this.hits.size > this.maxKeys) this.prune(nowMs);
    return list.length;
  }

  count(key: string, nowMs: number): number {
    const cutoff = nowMs - this.windowMs;
    return (this.hits.get(key) ?? []).filter((t) => t > cutoff).length;
  }

  reset(key: string): void {
    this.hits.delete(key);
  }

  private prune(nowMs: number): void {
    const cutoff = nowMs - this.windowMs;
    for (const [key, list] of this.hits) {
      if (!list.some((t) => t > cutoff)) this.hits.delete(key);
    }
  }
}
