import 'server-only';
import { and, count, eq, gte, inArray, isNotNull, isNull } from 'drizzle-orm';
import { type Capability, can, DAY, type ServiceContext } from '@jave/core';
import {
  applications,
  memberCapabilities,
  members,
  projects,
  securityEvents,
  tickets,
  trials,
} from '@jave/database';

export const JOIN_WINDOW_DAYS = 7;

export type OverviewMetricKey =
  | 'membersPresent'
  | 'joinedRecently'
  | 'openApplications'
  | 'activeTrials'
  | 'openTickets'
  | 'openSecurityEvents'
  | 'verifiedCapabilities'
  | 'projectsShipped';

export interface OverviewMetric {
  key: OverviewMetricKey;
  value: number;
}

interface MetricDefinition {
  key: OverviewMetricKey;
  /** The metric is computed only for actors holding this capability. */
  capability: Capability;
  query: (ctx: ServiceContext) => Promise<number>;
}

const OPEN_APPLICATION_STATUSES = ['submitted', 'review', 'interview'] as const;
const OPEN_TICKET_STATUSES = ['open', 'claimed', 'waiting'] as const;

const METRICS: readonly MetricDefinition[] = [
  {
    key: 'membersPresent',
    capability: 'canViewMembers',
    query: async (ctx) => {
      const [row] = await ctx.db
        .select({ value: count() })
        .from(members)
        .where(and(eq(members.guildStatus, 'present'), isNull(members.deletedAt)));
      return row?.value ?? 0;
    },
  },
  {
    key: 'joinedRecently',
    capability: 'canViewMembers',
    query: async (ctx) => {
      const since = new Date(ctx.clock.now().getTime() - JOIN_WINDOW_DAYS * DAY);
      const [row] = await ctx.db
        .select({ value: count() })
        .from(members)
        .where(and(gte(members.joinedGuildAt, since), isNull(members.deletedAt)));
      return row?.value ?? 0;
    },
  },
  {
    key: 'openApplications',
    capability: 'canViewApplications',
    query: async (ctx) => {
      const [row] = await ctx.db
        .select({ value: count() })
        .from(applications)
        .where(inArray(applications.status, [...OPEN_APPLICATION_STATUSES]));
      return row?.value ?? 0;
    },
  },
  {
    key: 'activeTrials',
    capability: 'canViewMembers',
    query: async (ctx) => {
      const [row] = await ctx.db
        .select({ value: count() })
        .from(trials)
        .where(eq(trials.status, 'active'));
      return row?.value ?? 0;
    },
  },
  {
    key: 'openTickets',
    capability: 'canHandleTickets',
    query: async (ctx) => {
      const [row] = await ctx.db
        .select({ value: count() })
        .from(tickets)
        .where(inArray(tickets.status, [...OPEN_TICKET_STATUSES]));
      return row?.value ?? 0;
    },
  },
  {
    key: 'openSecurityEvents',
    capability: 'canViewSecurityEvents',
    query: async (ctx) => {
      const [row] = await ctx.db
        .select({ value: count() })
        .from(securityEvents)
        .where(eq(securityEvents.status, 'open'));
      return row?.value ?? 0;
    },
  },
  {
    key: 'verifiedCapabilities',
    capability: 'canViewMembers',
    query: async (ctx) => {
      const [row] = await ctx.db
        .select({ value: count() })
        .from(memberCapabilities)
        .innerJoin(members, eq(members.id, memberCapabilities.memberId))
        .where(and(isNotNull(memberCapabilities.verifiedRank), isNull(members.deletedAt)));
      return row?.value ?? 0;
    },
  },
  {
    key: 'projectsShipped',
    capability: 'canViewMembers',
    query: async (ctx) => {
      const [row] = await ctx.db
        .select({ value: count() })
        .from(projects)
        .where(and(eq(projects.status, 'shipped'), isNull(projects.deletedAt)));
      return row?.value ?? 0;
    },
  },
];

/**
 * Organization counters for the overview. Each metric is computed only when
 * the actor holds its capability; the rest are omitted, not zeroed.
 */
export async function loadOverviewMetrics(ctx: ServiceContext): Promise<OverviewMetric[]> {
  const permitted = METRICS.filter((metric) => can(ctx, metric.capability));
  return Promise.all(
    permitted.map(async (metric) => ({ key: metric.key, value: await metric.query(ctx) })),
  );
}
