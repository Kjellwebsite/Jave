import { and, desc, eq, gte, inArray, or, type SQL, sql } from 'drizzle-orm';
import { z } from 'zod';
import { aiRequests, aiRequestStatus, members } from '@jave/database';
import type { ServiceContext } from '../kernel/context';
import type { Page } from '../kernel/pagination';
import { pageSchema } from '../kernel/pagination';
import { parseInput } from '../kernel/validation';
import { authorize, requireUser } from '../permissions/authorize';
import { AI_FEATURES, COUNTED_ERROR_CODES, COUNTED_REQUEST_STATUSES } from './constants';
import { startOfUtcDay } from './ledger';

/**
 * Read models over the `ai_requests` ledger. The ledger never stores prompts
 * or answers; these views expose metadata only. Your own requests are yours
 * to see; everyone's requests (with who made them) are audit data.
 */

/** Characters of the prompt fingerprint shown to auditors (enough to spot repeats). */
export const FINGERPRINT_DISPLAY_LENGTH = 12;
export const MAX_USAGE_ROWS = 100;
const DEFAULT_USAGE_ROWS = 25;

export const listAiRequestsSchema = pageSchema.extend({
  scope: z.enum(['mine', 'all']).default('mine'),
  feature: z.enum(AI_FEATURES).optional(),
  status: z.enum(aiRequestStatus.enumValues).optional(),
});

export interface AiRequestView {
  id: string;
  createdAt: Date;
  feature: string;
  surface: string | null;
  provider: string;
  model: string;
  status: (typeof aiRequestStatus.enumValues)[number];
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  errorCode: string | null;
  /** Who asked — only in the `all` scope (auditors). */
  requester: { userId: string; displayName: string | null } | null;
  /** Leading characters of the prompt fingerprint — only in the `all` scope. */
  fingerprint: string | null;
}

/** Rows that count toward the daily limit (mirrors the reservation rule). */
const COUNTED = or(
  inArray(aiRequests.status, [...COUNTED_REQUEST_STATUSES]),
  and(eq(aiRequests.status, 'error'), inArray(aiRequests.errorCode, [...COUNTED_ERROR_CODES])),
)!;

/**
 * The AI request ledger, newest first. `mine`: any signed-in user, own rows
 * only. `all`: `canViewAuditLogs`, with the requester and a short prompt
 * fingerprint. Never prompts or answers.
 */
export async function listAiRequests(
  ctx: ServiceContext,
  input: z.input<typeof listAiRequestsSchema> = {},
): Promise<Page<AiRequestView>> {
  const actor = requireUser(ctx);
  const q = parseInput(listAiRequestsSchema, input);
  const everyone = q.scope === 'all';
  if (everyone) await authorize(ctx, 'canViewAuditLogs', { type: 'ai_requests' });
  const filters: SQL[] = [];
  if (!everyone) filters.push(eq(aiRequests.userId, actor.userId));
  if (q.feature) filters.push(eq(aiRequests.feature, q.feature));
  if (q.status) filters.push(eq(aiRequests.status, q.status));
  const where = filters.length > 0 ? and(...filters) : undefined;
  const [rows, [count]] = await Promise.all([
    ctx.db
      .select({ request: aiRequests, displayName: members.displayName })
      .from(aiRequests)
      .leftJoin(members, eq(members.userId, aiRequests.userId))
      .where(where)
      .orderBy(desc(aiRequests.createdAt), desc(aiRequests.id))
      .limit(q.limit)
      .offset(q.offset),
    ctx.db
      .select({ total: sql<number>`count(*)::int` })
      .from(aiRequests)
      .where(where),
  ]);
  return {
    items: rows.map(({ request, displayName }) => ({
      id: request.id,
      createdAt: request.createdAt,
      feature: request.feature,
      surface: request.surface,
      provider: request.provider,
      model: request.model,
      status: request.status,
      inputTokens: request.inputTokens,
      outputTokens: request.outputTokens,
      latencyMs: request.latencyMs,
      errorCode: request.errorCode,
      requester: everyone && request.userId ? { userId: request.userId, displayName } : null,
      fingerprint:
        everyone && request.promptHash
          ? request.promptHash.slice(0, FINGERPRINT_DISPLAY_LENGTH)
          : null,
    })),
    total: count?.total ?? 0,
    limit: q.limit,
    offset: q.offset,
  };
}

export const usageByUserSchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_USAGE_ROWS).default(DEFAULT_USAGE_ROWS),
});

export interface UserAiUsage {
  userId: string;
  displayName: string | null;
  /** Requests that count toward the daily limit today (UTC). */
  counted: number;
  /** Every ledger row today, including denied and uncounted failures. */
  attempts: number;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Today's (UTC) AI usage per member, heaviest first. Audit data:
 * `canViewAuditLogs`. Counts and tokens only.
 */
export async function getUsageByUser(
  ctx: ServiceContext,
  input: z.input<typeof usageByUserSchema> = {},
): Promise<UserAiUsage[]> {
  await authorize(ctx, 'canViewAuditLogs', { type: 'ai_usage' });
  const { limit } = parseInput(usageByUserSchema, input);
  const counted = sql<number>`(count(*) filter (where ${COUNTED}))::int`;
  const rows = await ctx.db
    .select({
      userId: aiRequests.userId,
      displayName: members.displayName,
      counted,
      attempts: sql<number>`count(*)::int`,
      inputTokens: sql<number>`coalesce(sum(${aiRequests.inputTokens}), 0)::int`,
      outputTokens: sql<number>`coalesce(sum(${aiRequests.outputTokens}), 0)::int`,
    })
    .from(aiRequests)
    .leftJoin(members, eq(members.userId, aiRequests.userId))
    .where(gte(aiRequests.createdAt, startOfUtcDay(ctx.clock.now())))
    .groupBy(aiRequests.userId, members.displayName)
    .orderBy(desc(counted), desc(sql`count(*)`))
    .limit(limit);
  return rows.flatMap((row) => (row.userId ? [{ ...row, userId: row.userId }] : []));
}
