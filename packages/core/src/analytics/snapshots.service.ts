import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { analyticsSnapshots } from '@jave/database';
import type { ServiceContext } from '../kernel/context';
import { ValidationError } from '../kernel/errors';
import { parseInput } from '../kernel/validation';
import { requireSystemActor } from '../invites/access';
import { getSettings } from '../settings/settings.service';
import { authorizeAnalytics } from './access';
import {
  ANALYTICS_METRIC_KEYS,
  type AnalyticsMetric,
  metricDefinition,
  type MetricKind,
  type MetricPoint,
} from './metrics';
import { moderationCounts, ticketCounts } from './queries/operations';
import { memberCounts, progressionCounts, referralCounts } from './queries/people';
import {
  applicationCounts,
  missionCounts,
  projectCounts,
  trialCounts,
  verifiedContributions,
} from './queries/pipeline';
import {
  DEFAULT_SERIES_RANGE_DAYS,
  dayWindow,
  daysEndingWith,
  previousDay,
  SERIES_RANGE_DAYS,
  type SeriesRangeDays,
  utcDay,
} from './window';

/** Earlier days (before yesterday) whose missing flows the snapshot job fills in. */
export const SNAPSHOT_BACKFILL_DAYS = 7;
/** Oldest day a manual snapshot may target. */
export const SNAPSHOT_MAX_AGE_DAYS = 365;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const isoDay = z
  .string()
  .regex(ISO_DAY, 'use YYYY-MM-DD')
  .refine((day) => {
    const parsed = new Date(`${day}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && utcDay(parsed) === day;
  }, 'not a calendar day');

function dimensioned<K extends string>(
  metric: AnalyticsMetric,
  counts: Record<K, number>,
): MetricPoint[] {
  return (Object.entries(counts) as [K, number][]).map(([dimension, value]) => ({
    metric,
    dimension,
    value,
  }));
}

/** Everything that happened during `day` (UTC), plus current gauges when asked. */
async function collectDay(
  ctx: ServiceContext,
  day: string,
  includeGauges: boolean,
): Promise<MetricPoint[]> {
  const window = dayWindow(day);
  const now = ctx.clock.now();
  const [
    people,
    apps,
    trials,
    missions,
    projects,
    verified,
    tickets,
    moderation,
    referrals,
    roles,
  ] = await Promise.all([
    memberCounts(ctx, window),
    applicationCounts(ctx, window),
    trialCounts(ctx, window),
    missionCounts(ctx, window),
    projectCounts(ctx, window),
    verifiedContributions(ctx, window),
    ticketCounts(ctx, window, now),
    moderationCounts(ctx, window),
    referralCounts(ctx, window),
    includeGauges ? progressionCounts(ctx) : Promise.resolve(null),
  ]);
  const point = (metric: AnalyticsMetric, value: number): MetricPoint => ({
    metric,
    dimension: '',
    value,
  });
  const flows: MetricPoint[] = [
    point('members.joins', people.joins),
    point('members.leaves', people.leaves),
    point('applications.submitted', apps.submitted),
    point('applications.accepted', apps.accepted),
    point('applications.rejected', apps.rejected),
    point('trials.completed', trials.completed),
    point('trials.passed', trials.passed),
    point('missions.completed', missions.completed),
    point('projects.shipped', projects.shipped),
    point('contributions.verified', verified),
    point('tickets.opened', tickets.opened),
    point('referrals.attributed', referrals.attributed),
    point('referrals.validated', referrals.validated),
    ...dimensioned('moderation.cases', moderation.casesByAction),
    ...dimensioned('security.events', moderation.securityEventsByTrigger),
  ];
  if (!includeGauges || !roles) return flows;
  return [
    ...flows,
    point('members.present', people.present),
    point('members.onboarded', people.onboarded),
    point('applications.pending', apps.pending),
    point('trials.active', trials.byStatus.active),
    point('missions.open', missions.open),
    point('projects.shipped_total', projects.byStatus.shipped),
    point('tickets.open', tickets.open),
    point('referrals.valid_total', referrals.validTotal),
    ...dimensioned('members.by_role', roles),
  ];
}

async function upsertPoints(ctx: ServiceContext, day: string, points: readonly MetricPoint[]) {
  if (points.length === 0) return;
  await ctx.db
    .insert(analyticsSnapshots)
    .values(points.map((p) => ({ day, ...p, createdAt: ctx.clock.now() })))
    .onConflictDoUpdate({
      target: [analyticsSnapshots.day, analyticsSnapshots.metric, analyticsSnapshots.dimension],
      set: { value: sql`excluded.value`, createdAt: ctx.clock.now() },
    });
}

/** Days in the backfill horizon that have no flow snapshot yet. */
async function missingDays(ctx: ServiceContext, yesterday: string): Promise<string[]> {
  const candidates = daysEndingWith(yesterday, SNAPSHOT_BACKFILL_DAYS + 1).slice(0, -1);
  const present = await ctx.db
    .selectDistinct({ day: analyticsSnapshots.day })
    .from(analyticsSnapshots)
    .where(
      and(
        eq(analyticsSnapshots.metric, 'members.joins'),
        inArray(analyticsSnapshots.day, candidates),
      ),
    );
  const have = new Set(present.map((r) => r.day));
  return candidates.filter((d) => !have.has(d));
}

export const snapshotPayloadSchema = z.object({
  /** Recompute one completed day's flows (manual backfill). Defaults to yesterday. */
  day: isoDay.optional(),
});

export interface SnapshotResult {
  skipped: boolean;
  day: string | null;
  points: number;
  backfilled: string[];
}

/**
 * Daily job 'analytics.snapshot': idempotent upsert per (day, metric,
 * dimension). Captures yesterday's flows and today's gauges (labelled with
 * yesterday), then fills flows for up to SNAPSHOT_BACKFILL_DAYS earlier days
 * that were missed (e.g. worker downtime). Gauges cannot be reconstructed
 * for the past, so backfilled days carry flows only. System actor only.
 */
export async function runAnalyticsSnapshot(
  ctx: ServiceContext,
  payload: unknown = {},
): Promise<SnapshotResult> {
  await requireSystemActor(ctx, { type: 'analytics', id: 'snapshot' });
  const data = parseInput(snapshotPayloadSchema, payload);
  const settings = await getSettings(ctx, 'analytics');
  if (!settings.enabled) return { skipped: true, day: null, points: 0, backfilled: [] };
  const now = ctx.clock.now();
  const yesterday = previousDay(now);
  const day = data.day ?? yesterday;
  const oldest = daysEndingWith(yesterday, SNAPSHOT_MAX_AGE_DAYS)[0]!;
  if (day > yesterday || day < oldest) {
    throw new ValidationError(`Snapshot day must be between ${oldest} and ${yesterday}.`);
  }
  const points = await collectDay(ctx, day, day === yesterday);
  await upsertPoints(ctx, day, points);
  const backfilled = data.day ? [] : await missingDays(ctx, yesterday);
  for (const missed of backfilled) {
    await upsertPoints(ctx, missed, await collectDay(ctx, missed, false));
  }
  return { skipped: false, day, points: points.length, backfilled };
}

export const timeSeriesSchema = z.object({
  metric: z.enum(ANALYTICS_METRIC_KEYS),
  rangeDays: z.literal(SERIES_RANGE_DAYS).default(DEFAULT_SERIES_RANGE_DAYS),
  /** One dimension value of a dimensioned metric; omit for the total. */
  dimension: z
    .string()
    .regex(/^[a-z_]{1,64}$/, 'invalid dimension')
    .optional(),
});

export interface TimeSeries {
  metric: AnalyticsMetric;
  kind: MetricKind;
  dimension: string | null;
  rangeDays: SeriesRangeDays;
  /** One point per completed UTC day, oldest first; null = no snapshot that day. */
  points: { day: string; value: number | null }[];
}

/** Daily values of one metric from analytics_snapshots (canViewAnalytics). */
export async function getTimeSeries(
  ctx: ServiceContext,
  input: z.input<typeof timeSeriesSchema>,
): Promise<TimeSeries> {
  const q = parseInput(timeSeriesSchema, input);
  await authorizeAnalytics(ctx, 'timeseries');
  const definition = metricDefinition(q.metric);
  if (q.dimension !== undefined && !definition.dimension) {
    throw new ValidationError(`${q.metric} has no dimensions.`);
  }
  const days = daysEndingWith(previousDay(ctx.clock.now()), q.rangeDays);
  const filters = [
    eq(analyticsSnapshots.metric, q.metric),
    gte(analyticsSnapshots.day, days[0]!),
    lte(analyticsSnapshots.day, days.at(-1)!),
  ];
  if (q.dimension !== undefined) filters.push(eq(analyticsSnapshots.dimension, q.dimension));
  const rows = await ctx.db
    .select({
      day: analyticsSnapshots.day,
      value: sql<number>`sum(${analyticsSnapshots.value})`.mapWith(Number),
    })
    .from(analyticsSnapshots)
    .where(and(...filters))
    .groupBy(analyticsSnapshots.day);
  const byDay = new Map(rows.map((r) => [r.day, r.value]));
  return {
    metric: q.metric,
    kind: definition.kind,
    dimension: q.dimension ?? null,
    rangeDays: q.rangeDays,
    points: days.map((day) => ({ day, value: byDay.get(day) ?? null })),
  };
}
