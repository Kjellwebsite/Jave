import { and, eq, gte, inArray, lt, or, sql } from 'drizzle-orm';
import { aiRequests } from '@jave/database';
import { DAY } from '../kernel/clock';
import { type ServiceContext, withTransaction } from '../kernel/context';
import { RateLimitedError } from '../kernel/errors';
import {
  ABANDONED_REQUEST_CODE,
  AI_LEDGER_LOCK_NAMESPACE,
  type AiFeature,
  COUNTED_ERROR_CODES,
  COUNTED_REQUEST_STATUSES,
  STALE_PENDING_REQUEST_MS,
} from './constants';

/**
 * The `ai_requests` ledger: one row per attempt, prompt hash only (never the
 * prompt), token accounting, and the basis of the per-user daily limit.
 */

type LedgerStatus = (typeof aiRequests.$inferSelect)['status'];

export interface LedgerEntry {
  userId: string;
  feature: AiFeature;
  surface: string;
  provider: string;
  model: string;
  promptHash?: string;
}

export interface LedgerOutcome {
  status: Exclude<LedgerStatus, 'pending'>;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  errorCode?: string;
}

const MAX_MODEL_LENGTH = 64;
const MAX_ERROR_CODE_LENGTH = 64;

export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function nextUtcMidnight(now: Date): Date {
  return new Date(startOfUtcDay(now).getTime() + DAY);
}

/**
 * Requests that count against today's limit (UTC day): answered, refused or
 * in-flight requests, and failures the provider probably billed.
 */
export async function countToday(ctx: ServiceContext, userId: string): Promise<number> {
  const [row] = await ctx.db
    .select({ used: sql<number>`count(*)::int` })
    .from(aiRequests)
    .where(
      and(
        eq(aiRequests.userId, userId),
        gte(aiRequests.createdAt, startOfUtcDay(ctx.clock.now())),
        or(
          inArray(aiRequests.status, [...COUNTED_REQUEST_STATUSES]),
          and(
            eq(aiRequests.status, 'error'),
            inArray(aiRequests.errorCode, [...COUNTED_ERROR_CODES]),
          ),
        ),
      ),
    );
  return row?.used ?? 0;
}

/** Record a request that never reached the provider (disabled, over the limit). */
export async function recordDenied(
  ctx: ServiceContext,
  entry: LedgerEntry,
  status: 'disabled' | 'rate_limited',
  errorCode: string,
): Promise<void> {
  await ctx.rootDb.insert(aiRequests).values({
    ...entry,
    model: entry.model.slice(0, MAX_MODEL_LENGTH),
    status,
    errorCode,
    createdAt: ctx.clock.now(),
  });
}

/**
 * Reserve a ledger row before calling the provider. Serialized per user with
 * an advisory lock so concurrent requests cannot overshoot the daily limit.
 * Throws RateLimitedError (and records it) when the limit is reached.
 */
export async function reserveRequest(
  ctx: ServiceContext,
  entry: LedgerEntry,
  dailyLimit: number,
): Promise<{ id: string; used: number }> {
  const now = ctx.clock.now();
  const decision = await withTransaction({ ...ctx, db: ctx.rootDb }, async (tx) => {
    await tx.db.execute(
      sql`select pg_advisory_xact_lock(${AI_LEDGER_LOCK_NAMESPACE}::int, hashtext(${entry.userId}))`,
    );
    const used = await countToday(tx, entry.userId);
    if (used >= dailyLimit) return { allowed: false as const, used };
    const [row] = await tx.db
      .insert(aiRequests)
      .values({
        ...entry,
        model: entry.model.slice(0, MAX_MODEL_LENGTH),
        status: 'pending',
        createdAt: now,
      })
      .returning({ id: aiRequests.id });
    return { allowed: true as const, id: row!.id, used: used + 1 };
  });
  if (!decision.allowed) {
    await recordDenied(ctx, entry, 'rate_limited', 'daily_limit');
    const retryAfter = Math.ceil((nextUtcMidnight(now).getTime() - now.getTime()) / 1000);
    throw new RateLimitedError(
      retryAfter,
      `Daily AI limit reached — ${dailyLimit} requests per day. Resets at 00:00 UTC.`,
    );
  }
  return { id: decision.id, used: decision.used };
}

export async function finalizeRequest(
  ctx: ServiceContext,
  id: string,
  outcome: LedgerOutcome,
): Promise<void> {
  await ctx.rootDb
    .update(aiRequests)
    .set({
      status: outcome.status,
      ...(outcome.model && { model: outcome.model.slice(0, MAX_MODEL_LENGTH) }),
      inputTokens: outcome.inputTokens ?? 0,
      outputTokens: outcome.outputTokens ?? 0,
      latencyMs: outcome.latencyMs ?? 0,
      errorCode: outcome.errorCode?.slice(0, MAX_ERROR_CODE_LENGTH) ?? null,
    })
    .where(eq(aiRequests.id, id));
}

/** Close ledger rows left `pending` by a crashed process. */
export async function abandonStaleRequests(ctx: ServiceContext): Promise<number> {
  const cutoff = new Date(ctx.clock.now().getTime() - STALE_PENDING_REQUEST_MS);
  const rows = await ctx.db
    .update(aiRequests)
    .set({ status: 'error', errorCode: ABANDONED_REQUEST_CODE })
    .where(and(eq(aiRequests.status, 'pending'), lt(aiRequests.createdAt, cutoff)))
    .returning({ id: aiRequests.id });
  return rows.length;
}
