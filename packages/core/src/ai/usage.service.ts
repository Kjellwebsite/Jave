import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { aiRequests } from '@jave/database';
import { DAY } from '../kernel/clock';
import type { ServiceContext } from '../kernel/context';
import { parseInput } from '../kernel/validation';
import { authorize, requireUser } from '../permissions/authorize';
import { getSettings } from '../settings/settings.service';
import { MAX_USAGE_DAYS } from './constants';
import { countToday, nextUtcMidnight, startOfUtcDay } from './ledger';

export interface MyAiUsage {
  enabled: boolean;
  used: number;
  limit: number;
  remaining: number;
  resetsAt: Date;
}

/** Today's usage for the signed-in member (UTC day). */
export async function getUsage(
  ctx: ServiceContext,
  deps: { dailyRequestCeiling?: number } = {},
): Promise<MyAiUsage> {
  const actor = requireUser(ctx);
  const settings = await getSettings(ctx, 'ai');
  const limit = Math.min(
    settings.dailyRequestsPerUser,
    deps.dailyRequestCeiling ?? Number.POSITIVE_INFINITY,
  );
  const used = await countToday(ctx, actor.userId);
  return {
    enabled: settings.enabled,
    used,
    limit,
    remaining: Math.max(0, limit - used),
    resetsAt: nextUtcMidnight(ctx.clock.now()),
  };
}

export const orgUsageSchema = z.object({
  days: z.coerce.number().int().min(1).max(MAX_USAGE_DAYS).default(7),
});

export interface OrgAiUsage {
  since: Date;
  requests: number;
  distinctUsers: number;
  inputTokens: number;
  outputTokens: number;
  byStatus: Record<string, number>;
  byFeature: { feature: string; requests: number; inputTokens: number; outputTokens: number }[];
  byDay: { day: string; requests: number }[];
}

/** Organization-wide AI usage for analytics viewers. Aggregates only — no prompts, no per-user rows. */
export async function getOrgUsage(
  ctx: ServiceContext,
  input: z.input<typeof orgUsageSchema> = {},
): Promise<OrgAiUsage> {
  await authorize(ctx, 'canViewAnalytics', { type: 'ai_usage' });
  const { days } = parseInput(orgUsageSchema, input);
  const since = new Date(startOfUtcDay(ctx.clock.now()).getTime() - (days - 1) * DAY);
  const window = gte(aiRequests.createdAt, since);
  const [totals, statuses, features, series] = await Promise.all([
    ctx.db
      .select({
        requests: sql<number>`count(*)::int`,
        distinctUsers: sql<number>`count(distinct ${aiRequests.userId})::int`,
        inputTokens: sql<number>`coalesce(sum(${aiRequests.inputTokens}), 0)::int`,
        outputTokens: sql<number>`coalesce(sum(${aiRequests.outputTokens}), 0)::int`,
      })
      .from(aiRequests)
      .where(window),
    ctx.db
      .select({ status: aiRequests.status, count: sql<number>`count(*)::int` })
      .from(aiRequests)
      .where(window)
      .groupBy(aiRequests.status),
    ctx.db
      .select({
        feature: aiRequests.feature,
        requests: sql<number>`count(*)::int`,
        inputTokens: sql<number>`coalesce(sum(${aiRequests.inputTokens}), 0)::int`,
        outputTokens: sql<number>`coalesce(sum(${aiRequests.outputTokens}), 0)::int`,
      })
      .from(aiRequests)
      .where(and(window, eq(aiRequests.status, 'ok')))
      .groupBy(aiRequests.feature)
      .orderBy(desc(sql`count(*)`)),
    ctx.db
      .select({
        day: sql<string>`to_char(${aiRequests.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`,
        requests: sql<number>`count(*)::int`,
      })
      .from(aiRequests)
      .where(window)
      .groupBy(sql`1`)
      .orderBy(sql`1`),
  ]);
  const total = totals[0];
  return {
    since,
    requests: total?.requests ?? 0,
    distinctUsers: total?.distinctUsers ?? 0,
    inputTokens: total?.inputTokens ?? 0,
    outputTokens: total?.outputTokens ?? 0,
    byStatus: Object.fromEntries(statuses.map((s) => [s.status, s.count])),
    byFeature: features,
    byDay: series,
  };
}
