import 'server-only';
import { sql } from 'drizzle-orm';
import type { ServiceContext } from '@jave/core';
import { rateLimitBuckets } from '@jave/database';

/** Sign-in attempts per client per window. Generous for humans, tight for scripts. */
export const AUTH_RATE_LIMITS = {
  login: { limit: 10, windowSeconds: 60 },
  callback: { limit: 20, windowSeconds: 60 },
  devLogin: { limit: 30, windowSeconds: 60 },
} as const;

export type AuthRateLimit = keyof typeof AUTH_RATE_LIMITS;

const MAX_BUCKET_COUNT = 32_000;
const MS_PER_SECOND = 1000;
const MAX_CLIENT_KEY_LENGTH = 64;

/**
 * Fixed-window counter in the shared `rate_limit_buckets` table (same
 * semantics as core's consumeRateLimit). Timestamps are bound through the
 * column encoder: a raw Date inside a `sql` template is not serializable by
 * the postgres-js driver, which is why this does not call the core helper.
 */
async function consumeFixedWindow(
  ctx: Pick<ServiceContext, 'rootDb' | 'clock'>,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  const now = ctx.clock.now();
  const cutoff = sql.param(
    new Date(now.getTime() - windowSeconds * MS_PER_SECOND),
    rateLimitBuckets.windowStart,
  );
  const start = sql.param(now, rateLimitBuckets.windowStart);
  const [row] = await ctx.rootDb
    .insert(rateLimitBuckets)
    .values({ key, windowStart: now, count: 1 })
    .onConflictDoUpdate({
      target: rateLimitBuckets.key,
      set: {
        count: sql`case when ${rateLimitBuckets.windowStart} < ${cutoff} then 1 else least(${rateLimitBuckets.count} + 1, ${MAX_BUCKET_COUNT}) end`,
        windowStart: sql`case when ${rateLimitBuckets.windowStart} < ${cutoff} then ${start} else ${rateLimitBuckets.windowStart} end`,
      },
    })
    .returning({ count: rateLimitBuckets.count });
  return (row?.count ?? 1) <= limit;
}

/** True when the attempt is allowed; false when the client is over the limit. */
export async function allowAuthAttempt(
  ctx: Pick<ServiceContext, 'rootDb' | 'clock'>,
  kind: AuthRateLimit,
  clientKey: string,
): Promise<boolean> {
  const { limit, windowSeconds } = AUTH_RATE_LIMITS[kind];
  return consumeFixedWindow(
    ctx,
    `auth:${kind}:${clientKey.slice(0, MAX_CLIENT_KEY_LENGTH)}`,
    limit,
    windowSeconds,
  );
}
