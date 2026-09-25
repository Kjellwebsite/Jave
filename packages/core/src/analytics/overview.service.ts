import { z } from 'zod';
import type { ServiceContext } from '../kernel/context';
import { parseInput } from '../kernel/validation';
import { authorizeAnalytics } from './access';
import {
  type ModAction,
  moderationCounts,
  type SecurityTrigger,
  ticketCounts,
} from './queries/operations';
import {
  memberCounts,
  type RetentionCohort,
  referralCounts,
  retentionCohort,
} from './queries/people';
import {
  type ApplicationStatus,
  applicationCounts,
  missionCounts,
  projectCounts,
  type ProjectStatus,
  trialCounts,
  type TrialStatus,
  verifiedContributions,
} from './queries/pipeline';
import {
  DEFAULT_RANGE_DAYS,
  RANGE_DAYS,
  type RangeDays,
  rate,
  RETENTION_HORIZON_DAYS,
  roundDuration,
  shiftBack,
  type TimeWindow,
  windowEndingAt,
} from './window';

export const overviewSchema = z.object({
  rangeDays: z.literal(RANGE_DAYS).default(DEFAULT_RANGE_DAYS),
});

/**
 * Organizational health for staff. Descriptive counts and rates only: no
 * engagement scores, no message counts, no per-member ranking.
 */
export interface ServerOverview {
  rangeDays: RangeDays;
  window: TimeWindow;
  generatedAt: Date;
  members: {
    present: number;
    onboarded: number;
    joins: number;
    leaves: number;
    net: number;
    retention: { d7: RetentionCohort; d30: RetentionCohort };
  };
  applications: {
    byStatus: Record<ApplicationStatus, number>;
    pending: number;
    submitted: number;
    accepted: number;
    rejected: number;
    /** accepted / (accepted + rejected), decisions made in range. */
    acceptanceRate: number | null;
    medianHoursToDecision: number | null;
  };
  trials: {
    byStatus: Record<TrialStatus, number>;
    active: number;
    completed: number;
    resultsPublished: number;
    passed: number;
    /** (pass + distinction) / results published in range. */
    passRate: number | null;
  };
  missions: { open: number; completed: number };
  projects: { byStatus: Record<ProjectStatus, number>; shipped: number };
  tickets: {
    open: number;
    opened: number;
    medianFirstResponseMinutes: number | null;
    slaTracked: number;
    slaBreached: number;
    slaBreachRate: number | null;
  };
  moderation: {
    casesByAction: Record<ModAction, number>;
    securityEventsByTrigger: Record<SecurityTrigger, number>;
  };
  contributions: { verified: number };
  referrals: { attributed: number; validated: number };
}

const [D7, D30] = RETENTION_HORIZON_DAYS;

/**
 * Server overview for the last `rangeDays` (7, 30 or 90). Retention cohorts
 * are the joins of a window of the same length that ended D7/D30 ago, so each
 * join has had the full horizon to mature. Section queries are aggregates and
 * run concurrently.
 */
export async function getServerOverview(
  ctx: ServiceContext,
  input: z.input<typeof overviewSchema> = {},
): Promise<ServerOverview> {
  const { rangeDays } = parseInput(overviewSchema, input);
  await authorizeAnalytics(ctx, 'overview');
  const now = ctx.clock.now();
  const window = windowEndingAt(now, rangeDays);
  const [members, d7, d30, apps, trials, missions, projects, tickets, moderation, verified, refs] =
    await Promise.all([
      memberCounts(ctx, window),
      retentionCohort(ctx, D7, shiftBack(window, D7)),
      retentionCohort(ctx, D30, shiftBack(window, D30)),
      applicationCounts(ctx, window),
      trialCounts(ctx, window),
      missionCounts(ctx, window),
      projectCounts(ctx, window),
      ticketCounts(ctx, window, now),
      moderationCounts(ctx, window),
      verifiedContributions(ctx, window),
      referralCounts(ctx, window),
    ]);
  return {
    rangeDays,
    window,
    generatedAt: now,
    members: {
      ...members,
      net: members.joins - members.leaves,
      retention: { d7, d30 },
    },
    applications: {
      byStatus: apps.byStatus,
      pending: apps.pending,
      submitted: apps.submitted,
      accepted: apps.accepted,
      rejected: apps.rejected,
      acceptanceRate: rate(apps.accepted, apps.accepted + apps.rejected),
      medianHoursToDecision: roundDuration(apps.medianHoursToDecision),
    },
    trials: {
      byStatus: trials.byStatus,
      active: trials.byStatus.active,
      completed: trials.completed,
      resultsPublished: trials.resultsPublished,
      passed: trials.passed,
      passRate: rate(trials.passed, trials.resultsPublished),
    },
    missions,
    projects,
    tickets: {
      ...tickets,
      medianFirstResponseMinutes: roundDuration(tickets.medianFirstResponseMinutes),
      slaBreachRate: rate(tickets.slaBreached, tickets.slaTracked),
    },
    moderation,
    contributions: { verified },
    referrals: { attributed: refs.attributed, validated: refs.validated },
  };
}
