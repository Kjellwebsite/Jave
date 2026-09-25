import { and, desc, eq, gte, lt, lte, ne } from 'drizzle-orm';
import { guildMemberEvents, referrals, users } from '@jave/database';
import type { ServiceContext } from '../kernel/context';
import { getSettings } from '../settings/settings.service';
import {
  ANOMALY_COHORT_LIMIT,
  ANOMALY_COHORT_WINDOW_MS,
  type AnomalyResult,
  type AnomalyRules,
  DEFAULT_ANOMALY_RULES,
  detectAnomalies,
  type ReferralSubject,
} from './anomaly';
import { REJOIN_GRACE_MS } from './constants';

export type ReferralRecord = typeof referrals.$inferSelect;

/** Anomaly rules with the server's "very new account" threshold applied. */
export async function loadAnomalyRules(ctx: ServiceContext): Promise<AnomalyRules> {
  const security = await getSettings(ctx, 'security');
  return { ...DEFAULT_ANOMALY_RULES, newAccountDays: security.suspiciousAccountAgeDays };
}

/** The inviter's other referrals around `around` (both directions), newest first. */
export async function loadCohort(
  ctx: ServiceContext,
  inviterUserId: string,
  around: Date,
  excludeReferralId: string | null,
): Promise<ReferralSubject[]> {
  const from = new Date(around.getTime() - ANOMALY_COHORT_WINDOW_MS);
  const to = new Date(around.getTime() + ANOMALY_COHORT_WINDOW_MS);
  const filters = [
    eq(referrals.inviterUserId, inviterUserId),
    gte(referrals.joinedAt, from),
    lte(referrals.joinedAt, to),
  ];
  if (excludeReferralId) filters.push(ne(referrals.id, excludeReferralId));
  const rows = await ctx.db
    .select({
      joinedAt: referrals.joinedAt,
      leftAt: referrals.leftAt,
      username: users.username,
      accountCreatedAt: users.discordCreatedAt,
    })
    .from(referrals)
    .innerJoin(users, eq(users.id, referrals.inviteeUserId))
    .where(and(...filters))
    .orderBy(desc(referrals.joinedAt))
    .limit(ANOMALY_COHORT_LIMIT);
  return rows;
}

/** Did this person join before (an earlier referral, or an older join event)? */
export async function hasPriorJoin(
  ctx: ServiceContext,
  inviteeUserId: string,
  joinedAt: Date,
  excludeReferralId: string | null,
): Promise<boolean> {
  const referralFilters = [
    eq(referrals.inviteeUserId, inviteeUserId),
    lt(referrals.joinedAt, joinedAt),
  ];
  if (excludeReferralId) referralFilters.push(ne(referrals.id, excludeReferralId));
  const [earlierReferral] = await ctx.db
    .select({ id: referrals.id })
    .from(referrals)
    .where(and(...referralFilters))
    .limit(1);
  if (earlierReferral) return true;
  // recordGuildJoin logs this very join moments before attribution; only older joins count.
  const graceStart = new Date(joinedAt.getTime() - REJOIN_GRACE_MS);
  const [earlierJoin] = await ctx.db
    .select({ id: guildMemberEvents.id })
    .from(guildMemberEvents)
    .where(
      and(
        eq(guildMemberEvents.userId, inviteeUserId),
        eq(guildMemberEvents.type, 'join'),
        lt(guildMemberEvents.occurredAt, graceStart),
      ),
    )
    .limit(1);
  return Boolean(earlierJoin);
}

export interface ScoreTarget {
  referralId: string | null;
  inviterUserId: string | null;
  inviteeUserId: string;
  joinedAt: Date;
  leftAt: Date | null;
}

/** Load everything the pure detector needs and run it. */
export async function scoreReferral(
  ctx: ServiceContext,
  target: ScoreTarget,
  rules: AnomalyRules,
): Promise<AnomalyResult> {
  const [invitee] = await ctx.db
    .select({ username: users.username, accountCreatedAt: users.discordCreatedAt })
    .from(users)
    .where(eq(users.id, target.inviteeUserId));
  const [cohort, rejoin] = await Promise.all([
    target.inviterUserId
      ? loadCohort(ctx, target.inviterUserId, target.joinedAt, target.referralId)
      : Promise.resolve([]),
    hasPriorJoin(ctx, target.inviteeUserId, target.joinedAt, target.referralId),
  ]);
  return detectAnomalies(
    {
      inviterUserId: target.inviterUserId,
      inviteeUserId: target.inviteeUserId,
      subject: {
        joinedAt: target.joinedAt,
        leftAt: target.leftAt,
        username: invitee?.username ?? '',
        accountCreatedAt: invitee?.accountCreatedAt ?? null,
      },
      cohort,
      rejoin,
    },
    rules,
  );
}
