import 'server-only';
import { analytics, can, DisabledError, type ServiceContext } from '@jave/core';
import type { AnalyticsRange } from '@/lib/analytics-view';

/** Daily-snapshot series the analytics page charts (all read through core). */
export const TREND_METRICS = [
  'members.joins',
  'members.leaves',
  'members.present',
  'applications.submitted',
  'trials.passed',
  'missions.completed',
  'projects.shipped',
  'contributions.verified',
  'referrals.validated',
  'tickets.opened',
  'moderation.cases',
  'security.events',
] as const satisfies readonly analytics.AnalyticsMetric[];

export type TrendMetric = (typeof TREND_METRICS)[number];

export interface AnalyticsView {
  range: AnalyticsRange;
  overview: analytics.ServerOverview;
  progress: analytics.JavelinProgress;
  series: Record<TrendMetric, analytics.TimeSeries>;
}

export type AnalyticsLoad = { status: 'ok'; view: AnalyticsView } | { status: 'disabled' };

/**
 * Everything the analytics page shows, for the actor in `ctx`. Core enforces
 * canViewAnalytics (ForbiddenError → the page renders ACCESS RESTRICTED) and
 * the settings kill switch (reported here as `disabled`).
 */
export async function loadAnalytics(
  ctx: ServiceContext,
  range: AnalyticsRange,
): Promise<AnalyticsLoad> {
  try {
    const [overview, progress, ...series] = await Promise.all([
      analytics.getServerOverview(ctx, { rangeDays: range }),
      analytics.getJavelinProgress(ctx),
      ...TREND_METRICS.map((metric) => analytics.getTimeSeries(ctx, { metric, rangeDays: range })),
    ]);
    const byMetric = Object.fromEntries(
      TREND_METRICS.map((metric, index) => [metric, series[index]!]),
    ) as Record<TrendMetric, analytics.TimeSeries>;
    return { status: 'ok', view: { range, overview, progress, series: byMetric } };
  } catch (error) {
    if (error instanceof DisabledError) return { status: 'disabled' };
    throw error;
  }
}

/** Days summarized by the /overview health strip. */
export const HEALTH_STRIP_RANGE: AnalyticsRange = 30;

/**
 * The compact health strip on /overview: analytics staff only. Others get
 * null without asking core, so an ordinary page view never logs a denial.
 */
export async function loadHealthStrip(ctx: ServiceContext): Promise<analytics.ServerOverview | null> {
  if (!can(ctx, 'canViewAnalytics')) return null;
  try {
    return await analytics.getServerOverview(ctx, { rangeDays: HEALTH_STRIP_RANGE });
  } catch (error) {
    if (error instanceof DisabledError) return null;
    throw error;
  }
}
