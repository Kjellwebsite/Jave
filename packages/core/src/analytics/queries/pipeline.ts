import { and, count, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import {
  applications,
  applicationStatus,
  contributions,
  missionAssignments,
  missions,
  projects,
  projectStatus,
  trialResults,
  trials,
  trialStatus,
} from '@jave/database';
import type { ServiceContext } from '../../kernel/context';
import { countWhere, medianDuration, SECONDS_PER_HOUR, within } from '../sql';
import { tally, type TimeWindow } from '../window';

export type ApplicationStatus = (typeof applicationStatus.enumValues)[number];
export type TrialStatus = (typeof trialStatus.enumValues)[number];
export type ProjectStatus = (typeof projectStatus.enumValues)[number];

/** Applications waiting on staff. */
export const PENDING_APPLICATION_STATUSES: readonly ApplicationStatus[] = [
  'submitted',
  'review',
  'interview',
];

export interface ApplicationCounts {
  byStatus: Record<ApplicationStatus, number>;
  pending: number;
  submitted: number;
  accepted: number;
  rejected: number;
  medianHoursToDecision: number | null;
}

export async function applicationCounts(
  ctx: ServiceContext,
  window: TimeWindow,
): Promise<ApplicationCounts> {
  const decidedInWindow = and(
    inArray(applications.status, ['accepted', 'rejected']),
    within(applications.decidedAt, window),
    isNotNull(applications.submittedAt),
  );
  const [statusRows, [flow]] = await Promise.all([
    ctx.db
      .select({ key: applications.status, count: count() })
      .from(applications)
      .groupBy(applications.status),
    ctx.db
      .select({
        submitted: countWhere(within(applications.submittedAt, window)),
        accepted: countWhere(
          and(eq(applications.status, 'accepted'), within(applications.decidedAt, window)),
        ),
        rejected: countWhere(
          and(eq(applications.status, 'rejected'), within(applications.decidedAt, window)),
        ),
        medianHours: medianDuration(
          applications.submittedAt,
          applications.decidedAt,
          SECONDS_PER_HOUR,
          decidedInWindow,
        ),
      })
      .from(applications),
  ]);
  const byStatus = tally(applicationStatus.enumValues, statusRows);
  return {
    byStatus,
    pending: PENDING_APPLICATION_STATUSES.reduce((sum, s) => sum + byStatus[s], 0),
    submitted: flow?.submitted ?? 0,
    accepted: flow?.accepted ?? 0,
    rejected: flow?.rejected ?? 0,
    medianHoursToDecision: flow?.medianHours ?? null,
  };
}

export interface TrialCounts {
  byStatus: Record<TrialStatus, number>;
  completed: number;
  resultsPublished: number;
  passed: number;
}

export async function trialCounts(ctx: ServiceContext, window: TimeWindow): Promise<TrialCounts> {
  const [statusRows, [flow], [results]] = await Promise.all([
    ctx.db.select({ key: trials.status, count: count() }).from(trials).groupBy(trials.status),
    ctx.db.select({ completed: countWhere(within(trials.completedAt, window)) }).from(trials),
    ctx.db
      .select({
        published: count(),
        passed: countWhere(inArray(trialResults.outcome, ['pass', 'distinction'])),
      })
      .from(trialResults)
      .where(within(trialResults.publishedAt, window)),
  ]);
  return {
    byStatus: tally(trialStatus.enumValues, statusRows),
    completed: flow?.completed ?? 0,
    resultsPublished: results?.published ?? 0,
    passed: results?.passed ?? 0,
  };
}

export interface MissionCounts {
  open: number;
  completed: number;
}

export async function missionCounts(
  ctx: ServiceContext,
  window: TimeWindow,
): Promise<MissionCounts> {
  const [[open], [done]] = await Promise.all([
    ctx.db.select({ value: count() }).from(missions).where(eq(missions.status, 'open')),
    ctx.db
      .select({ value: count() })
      .from(missionAssignments)
      .where(
        and(
          eq(missionAssignments.status, 'verified'),
          within(missionAssignments.verifiedAt, window),
        ),
      ),
  ]);
  return { open: open?.value ?? 0, completed: done?.value ?? 0 };
}

export interface ProjectCounts {
  byStatus: Record<ProjectStatus, number>;
  shipped: number;
}

export async function projectCounts(
  ctx: ServiceContext,
  window: TimeWindow,
): Promise<ProjectCounts> {
  const live = isNull(projects.deletedAt);
  const [statusRows, [flow]] = await Promise.all([
    ctx.db
      .select({ key: projects.status, count: count() })
      .from(projects)
      .where(live)
      .groupBy(projects.status),
    ctx.db
      .select({ shipped: countWhere(within(projects.shippedAt, window)) })
      .from(projects)
      .where(live),
  ]);
  return { byStatus: tally(projectStatus.enumValues, statusRows), shipped: flow?.shipped ?? 0 };
}

export async function verifiedContributions(
  ctx: ServiceContext,
  window: TimeWindow,
): Promise<number> {
  const [row] = await ctx.db
    .select({ value: count() })
    .from(contributions)
    .where(and(eq(contributions.status, 'verified'), within(contributions.verifiedAt, window)));
  return row?.value ?? 0;
}
