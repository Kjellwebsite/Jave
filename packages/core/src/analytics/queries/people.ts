import { and, count, eq, gt, inArray, isNull, lte, notExists, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { guildMemberEvents, memberRoles, members, referrals } from '@jave/database';
import type { ServiceContext } from '../../kernel/context';
import { type OrgRole, PROGRESSION_ROLES } from '../../permissions/roles';
import { countWhere, within } from '../sql';
import { rate, tally, type TimeWindow } from '../window';

export interface MemberCounts {
  /** Currently in the server (not deleted). */
  present: number;
  /** Present and onboarded. */
  onboarded: number;
  joins: number;
  leaves: number;
}

const presentMember = and(eq(members.guildStatus, 'present'), isNull(members.deletedAt));

export async function memberCounts(ctx: ServiceContext, window: TimeWindow): Promise<MemberCounts> {
  const [[gauge], [flow]] = await Promise.all([
    ctx.db
      .select({
        present: count(),
        onboarded: countWhere(eq(members.onboardingState, 'completed')),
      })
      .from(members)
      .where(presentMember),
    ctx.db
      .select({
        joins: countWhere(eq(guildMemberEvents.type, 'join')),
        leaves: countWhere(eq(guildMemberEvents.type, 'leave')),
      })
      .from(guildMemberEvents)
      .where(within(guildMemberEvents.occurredAt, window)),
  ]);
  return {
    present: gauge?.present ?? 0,
    onboarded: gauge?.onboarded ?? 0,
    joins: flow?.joins ?? 0,
    leaves: flow?.leaves ?? 0,
  };
}

export interface RetentionCohort {
  horizonDays: number;
  /** Joins in the cohort window (each join counts, rejoins included). */
  cohort: number;
  /** Joins not followed by a leave within the horizon. */
  retained: number;
  rate: number | null;
  window: TimeWindow;
}

/**
 * DN retention from the raw join/leave stream: of the joins inside
 * `cohortWindow`, the share with no leave within `horizonDays` of joining.
 * Callers pass a window that ended at least `horizonDays` ago so every join
 * in it has had the full horizon to mature.
 */
export async function retentionCohort(
  ctx: ServiceContext,
  horizonDays: number,
  cohortWindow: TimeWindow,
): Promise<RetentionCohort> {
  const leave = alias(guildMemberEvents, 'leave_event');
  const leftWithinHorizon = ctx.db
    .select({ id: leave.id })
    .from(leave)
    .where(
      and(
        eq(leave.userId, guildMemberEvents.userId),
        eq(leave.type, 'leave'),
        gt(leave.occurredAt, guildMemberEvents.occurredAt),
        lte(
          leave.occurredAt,
          sql`${guildMemberEvents.occurredAt} + make_interval(days => ${horizonDays}::int)`,
        ),
      ),
    );
  const [row] = await ctx.db
    .select({ cohort: count(), retained: countWhere(notExists(leftWithinHorizon)) })
    .from(guildMemberEvents)
    .where(
      and(eq(guildMemberEvents.type, 'join'), within(guildMemberEvents.occurredAt, cohortWindow)),
    );
  const cohort = row?.cohort ?? 0;
  const retained = row?.retained ?? 0;
  return { horizonDays, cohort, retained, rate: rate(retained, cohort), window: cohortWindow };
}

export type ProgressionRole = Extract<OrgRole, 'member' | 'applicant' | 'trial' | 'verified'>;

/** Present members per progression role (roles that are active now). */
export async function progressionCounts(
  ctx: ServiceContext,
): Promise<Record<ProgressionRole, number>> {
  const now = ctx.clock.now();
  const rows = await ctx.db
    .select({
      key: memberRoles.role,
      count: sql<number>`count(distinct ${memberRoles.memberId})::int`,
    })
    .from(memberRoles)
    .innerJoin(members, eq(members.id, memberRoles.memberId))
    .where(
      and(
        inArray(memberRoles.role, [...PROGRESSION_ROLES]),
        isNull(memberRoles.revokedAt),
        or(isNull(memberRoles.expiresAt), gt(memberRoles.expiresAt, now)),
        presentMember,
      ),
    )
    .groupBy(memberRoles.role);
  return tally(
    PROGRESSION_ROLES as readonly ProgressionRole[],
    rows as { key: ProgressionRole; count: number }[],
  );
}

export interface ReferralCounts {
  attributed: number;
  validated: number;
  validTotal: number;
}

export async function referralCounts(
  ctx: ServiceContext,
  window: TimeWindow,
): Promise<ReferralCounts> {
  const [row] = await ctx.db
    .select({
      attributed: countWhere(within(referrals.joinedAt, window)),
      validated: countWhere(
        and(eq(referrals.status, 'valid'), within(referrals.validatedAt, window)),
      ),
      validTotal: countWhere(eq(referrals.status, 'valid')),
    })
    .from(referrals);
  return {
    attributed: row?.attributed ?? 0,
    validated: row?.validated ?? 0,
    validTotal: row?.validTotal ?? 0,
  };
}
