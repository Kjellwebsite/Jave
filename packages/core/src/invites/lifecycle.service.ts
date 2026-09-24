import {
  and,
  asc,
  count,
  eq,
  exists,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  notExists,
  or,
  sql,
} from 'drizzle-orm';
import { guildMemberEvents, members, referrals } from '@jave/database';
import { type DomainEventRecord, type EventSubscriber, publishEvent } from '../events/bus';
import { DAY } from '../kernel/clock';
import { isUuid } from '../kernel/ids';
import { type ServiceContext, withTransaction } from '../kernel/context';
import { isUniqueViolation } from '../kernel/errors';
import { notify } from '../notifications/notifications.service';
import type { Settings } from '../settings/schemas';
import { getSettings } from '../settings/settings.service';
import { requireSystemActor } from './access';
import { type AnomalyRules, isAnomalyFlag, scoreFlags, withFlag } from './anomaly';
import {
  FAST_LEAVE_MS,
  MAX_JOIN_CLOCK_SKEW_MS,
  SWEEP_BATCH_SIZE,
  SWEEP_MAX_BATCHES,
} from './constants';
import { LIVE_REFERRAL_STATUSES } from './lifecycle';
import { loadAnomalyRules, type ReferralRecord, scoreReferral } from './scoring';

const LIVE = [...LIVE_REFERRAL_STATUSES];

/** Name used in the inviter's notification when the invitee's profile is staff-only. */
const HIDDEN_INVITEE_SUBJECT = 'A member you referred';

/**
 * LEFT fields for a referral. Discord's join time and our clock can disagree
 * by a little, so a leave is never recorded before the join it ends.
 */
function leaveFields(
  referral: Pick<ReferralRecord, 'joinedAt' | 'anomalyFlags'>,
  leftAt: Date,
): { leftAt: Date; anomalyFlags: string[]; anomalyScore: number } {
  const at = leftAt.getTime() < referral.joinedAt.getTime() ? referral.joinedAt : leftAt;
  const fast = at.getTime() - referral.joinedAt.getTime() < FAST_LEAVE_MS;
  const flags = fast
    ? withFlag(referral.anomalyFlags, 'fast_leave')
    : referral.anomalyFlags.filter(isAnomalyFlag);
  return { leftAt: at, anomalyFlags: flags, anomalyScore: scoreFlags(flags) };
}

async function closeAsLeft(
  ctx: ServiceContext,
  referral: Pick<ReferralRecord, 'id' | 'joinedAt' | 'anomalyFlags'>,
  leftAt: Date,
): Promise<boolean> {
  const updated = await ctx.db
    .update(referrals)
    .set({
      status: 'left',
      statusReason: 'left_guild',
      ...leaveFields(referral, leftAt),
      updatedAt: ctx.clock.now(),
    })
    .where(and(eq(referrals.id, referral.id), inArray(referrals.status, LIVE)))
    .returning({ id: referrals.id });
  return updated.length > 0;
}

// ─── member.left ─────────────────────────────────────────────────────────────

/**
 * The invitee left the server: live referrals become LEFT (flagged
 * fast_leave inside 24 h); a VALID referral keeps its status and records
 * leftAt. Idempotent (at-least-once delivery).
 *
 * A delayed event must not end a later stay: when the member has rejoined
 * since this leave, only referrals from before that rejoin are closed.
 */
export async function markInviteeLeft(
  ctx: ServiceContext,
  memberId: string,
  leftAt: Date,
): Promise<number> {
  if (!isUuid(memberId)) return 0;
  const [member] = await ctx.db
    .select({
      userId: members.userId,
      guildStatus: members.guildStatus,
      joinedGuildAt: members.joinedGuildAt,
    })
    .from(members)
    .where(eq(members.id, memberId));
  if (!member) return 0;
  const rejoinedAt =
    member.guildStatus === 'present' &&
    member.joinedGuildAt &&
    member.joinedGuildAt.getTime() > leftAt.getTime()
      ? member.joinedGuildAt
      : null;
  const scope = rejoinedAt
    ? lt(referrals.joinedAt, new Date(rejoinedAt.getTime() - MAX_JOIN_CLOCK_SKEW_MS))
    : undefined;
  return withTransaction(ctx, async (tx) => {
    const live = await tx.db
      .select()
      .from(referrals)
      .where(
        and(eq(referrals.inviteeUserId, member.userId), inArray(referrals.status, LIVE), scope),
      )
      .for('update');
    for (const referral of live) await closeAsLeft(tx, referral, leftAt);
    await tx.db
      .update(referrals)
      .set({ leftAt: sql`greatest(${referrals.joinedAt}, ${leftAt.toISOString()}::timestamptz)` })
      .where(
        and(
          eq(referrals.inviteeUserId, member.userId),
          eq(referrals.status, 'valid'),
          isNull(referrals.leftAt),
          scope,
        ),
      );
    return live.length;
  });
}

export const referralLeftSubscriber: EventSubscriber = {
  name: 'invites.referral-left',
  types: ['member.left'],
  handle: async (ctx: ServiceContext, event: DomainEventRecord) => {
    await markInviteeLeft(ctx, event.aggregateId, event.occurredAt);
  },
};

// ─── Hourly sweep ────────────────────────────────────────────────────────────

export interface SweepSummary {
  left: number;
  retained: number;
  validated: number;
  /** Retained but held back by the anomaly threshold (awaiting review). */
  blocked: number;
  /** Invalidated because the invitee already counts as a VALID referral. */
  duplicates: number;
}

/** A leave recorded after this referral's join, if any. */
const leaveAfterJoin = sql`(select min(${guildMemberEvents.occurredAt}) from ${guildMemberEvents}
  where ${guildMemberEvents.userId} = ${referrals.inviteeUserId}
    and ${guildMemberEvents.type} = 'leave'
    and ${guildMemberEvents.occurredAt} > ${referrals.joinedAt})`.mapWith(
  guildMemberEvents.occurredAt,
);

function noLeaveSinceJoin(ctx: ServiceContext) {
  return notExists(
    ctx.db
      .select({ id: guildMemberEvents.id })
      .from(guildMemberEvents)
      .where(
        and(
          eq(guildMemberEvents.userId, referrals.inviteeUserId),
          eq(guildMemberEvents.type, 'leave'),
          gt(guildMemberEvents.occurredAt, referrals.joinedAt),
        ),
      ),
  );
}

/**
 * Safety net for member.left deliveries that never happened: a live referral
 * whose invitee is gone (departed, deleted, no member row), or who left after
 * this join and came back without a new attribution, is closed as LEFT.
 */
async function closeMissedLeaves(ctx: ServiceContext): Promise<number> {
  const now = ctx.clock.now();
  const rows = await ctx.db
    .select({
      id: referrals.id,
      joinedAt: referrals.joinedAt,
      anomalyFlags: referrals.anomalyFlags,
      leaveAt: leaveAfterJoin,
      memberLeftAt: members.leftGuildAt,
    })
    .from(referrals)
    .leftJoin(members, eq(members.userId, referrals.inviteeUserId))
    .where(
      and(
        inArray(referrals.status, LIVE),
        or(
          sql`${leaveAfterJoin} is not null`,
          isNull(members.id),
          ne(members.guildStatus, 'present'),
          isNotNull(members.deletedAt),
        ),
      ),
    )
    .limit(SWEEP_BATCH_SIZE * SWEEP_MAX_BATCHES);
  let closed = 0;
  for (const row of rows) {
    if (await closeAsLeft(ctx, row, row.leaveAt ?? row.memberLeftAt ?? now)) closed++;
  }
  return closed;
}

/** JOINED → RETAINED once the invitee has stayed `retentionDays`. One statement. */
async function promoteRetained(ctx: ServiceContext, retentionDays: number): Promise<number> {
  const now = ctx.clock.now();
  const cutoff = new Date(now.getTime() - retentionDays * DAY);
  const rows = await ctx.db
    .update(referrals)
    .set({ status: 'retained', retainedAt: now, updatedAt: now })
    .where(
      and(
        eq(referrals.status, 'joined'),
        lte(referrals.joinedAt, cutoff),
        exists(
          ctx.db
            .select({ id: members.id })
            .from(members)
            .where(
              and(
                eq(members.userId, referrals.inviteeUserId),
                eq(members.guildStatus, 'present'),
                isNull(members.deletedAt),
                inArray(members.standing, ['good', 'restricted']),
              ),
            ),
        ),
        noLeaveSinceJoin(ctx),
      ),
    )
    .returning({ id: referrals.id });
  return rows.length;
}

interface ValidationCandidate {
  referral: ReferralRecord;
  inviteeMemberId: string;
  inviteeName: string;
  inviteeVisible: boolean;
}

async function loadCandidates(
  ctx: ServiceContext,
  analytics: Settings<'analytics'>,
  after: { joinedAt: Date; id: string } | null,
): Promise<ValidationCandidate[]> {
  const filters = [
    eq(referrals.status, 'retained'),
    eq(members.guildStatus, 'present'),
    eq(members.standing, 'good'),
    isNull(members.deletedAt),
    noLeaveSinceJoin(ctx),
  ];
  if (analytics.validRequiresOnboarding) filters.push(eq(members.onboardingState, 'completed'));
  if (after) {
    filters.push(
      or(
        gt(referrals.joinedAt, after.joinedAt),
        and(eq(referrals.joinedAt, after.joinedAt), gt(referrals.id, after.id)),
      )!,
    );
  }
  const rows = await ctx.db
    .select({
      referral: referrals,
      inviteeMemberId: members.id,
      inviteeName: members.displayName,
      visibility: members.profileVisibility,
    })
    .from(referrals)
    .innerJoin(members, eq(members.userId, referrals.inviteeUserId))
    .where(and(...filters))
    .orderBy(asc(referrals.joinedAt), asc(referrals.id))
    .limit(SWEEP_BATCH_SIZE);
  return rows.map((row) => ({
    referral: row.referral,
    inviteeMemberId: row.inviteeMemberId,
    inviteeName: row.inviteeName,
    inviteeVisible: row.visibility !== 'staff',
  }));
}

/** Re-score with the inviter's current cohort; reviewed referrals keep staff's verdict. */
async function refreshScore(
  ctx: ServiceContext,
  referral: ReferralRecord,
  rules: AnomalyRules,
): Promise<number> {
  if (referral.reviewedAt) return referral.anomalyScore;
  const result = await scoreReferral(
    ctx,
    {
      referralId: referral.id,
      inviterUserId: referral.inviterUserId,
      inviteeUserId: referral.inviteeUserId,
      joinedAt: referral.joinedAt,
      leftAt: referral.leftAt,
    },
    rules,
  );
  const unchanged =
    result.score === referral.anomalyScore &&
    result.flags.join(',') === referral.anomalyFlags.join(',');
  if (!unchanged) {
    await ctx.db
      .update(referrals)
      .set({ anomalyFlags: result.flags, anomalyScore: result.score, updatedAt: ctx.clock.now() })
      .where(eq(referrals.id, referral.id));
  }
  return result.score;
}

async function markDuplicate(ctx: ServiceContext, referralId: string): Promise<void> {
  await ctx.db
    .update(referrals)
    .set({ status: 'invalid', statusReason: 'duplicate_invitee', updatedAt: ctx.clock.now() })
    .where(and(eq(referrals.id, referralId), eq(referrals.status, 'retained')));
}

export async function inviterMemberId(ctx: ServiceContext, inviterUserId: string | null) {
  if (!inviterUserId) return null;
  const [row] = await ctx.db
    .select({ id: members.id })
    .from(members)
    .where(and(eq(members.userId, inviterUserId), isNull(members.deletedAt)));
  return row?.id ?? null;
}

/** RETAINED → VALID inside one transaction with its event and notification. */
async function validate(ctx: ServiceContext, candidate: ValidationCandidate): Promise<boolean> {
  const { referral } = candidate;
  return withTransaction(ctx, async (tx) => {
    const now = tx.clock.now();
    const [updated] = await tx.db
      .update(referrals)
      .set({ status: 'valid', validatedAt: now, updatedAt: now })
      .where(and(eq(referrals.id, referral.id), eq(referrals.status, 'retained')))
      .returning({ id: referrals.id });
    if (!updated) return false;
    const inviterMember = await inviterMemberId(tx, referral.inviterUserId);
    await publishEvent(tx, {
      type: 'referral.validated',
      aggregateType: 'referral',
      aggregateId: referral.id,
      subjectMemberId: inviterMember,
      payload: {
        inviteeMemberId: candidate.inviteeMemberId,
        method: referral.method,
        campaignId: referral.campaignId,
      },
    });
    if (inviterMember && referral.inviterUserId) {
      const [total] = await tx.db
        .select({ value: count() })
        .from(referrals)
        .where(
          and(eq(referrals.inviterUserId, referral.inviterUserId), eq(referrals.status, 'valid')),
        );
      const subject = candidate.inviteeVisible ? candidate.inviteeName : HIDDEN_INVITEE_SUBJECT;
      await notify(tx, {
        recipientUserId: referral.inviterUserId,
        type: 'referral.validated',
        title: 'REFERRAL VALIDATED',
        body: `${subject} is now a valid referral. Valid referrals: ${total?.value ?? 1}.`,
        data: { referralId: referral.id },
        dedupeKey: `referral:${referral.id}:validated`,
      });
    }
    return true;
  });
}

async function hasOtherValid(ctx: ServiceContext, referral: ReferralRecord): Promise<boolean> {
  const [row] = await ctx.db
    .select({ id: referrals.id })
    .from(referrals)
    .where(and(eq(referrals.inviteeUserId, referral.inviteeUserId), eq(referrals.status, 'valid')))
    .limit(1);
  return Boolean(row);
}

async function validateRetained(
  ctx: ServiceContext,
  analytics: Settings<'analytics'>,
  rules: AnomalyRules,
): Promise<Pick<SweepSummary, 'validated' | 'blocked' | 'duplicates'>> {
  const summary = { validated: 0, blocked: 0, duplicates: 0 };
  let cursor: { joinedAt: Date; id: string } | null = null;
  for (let batch = 0; batch < SWEEP_MAX_BATCHES; batch++) {
    const candidates = await loadCandidates(ctx, analytics, cursor);
    for (const candidate of candidates) {
      const { referral } = candidate;
      const score = await refreshScore(ctx, referral, rules);
      if (score >= analytics.referralAnomalyThreshold) {
        summary.blocked++;
        continue;
      }
      if (await hasOtherValid(ctx, referral)) {
        await markDuplicate(ctx, referral.id);
        summary.duplicates++;
        continue;
      }
      try {
        if (await validate(ctx, candidate)) summary.validated++;
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        await markDuplicate(ctx, referral.id);
        summary.duplicates++;
      }
    }
    const last = candidates.at(-1);
    if (!last || candidates.length < SWEEP_BATCH_SIZE) break;
    cursor = { joinedAt: last.referral.joinedAt, id: last.referral.id };
  }
  return summary;
}

/**
 * Hourly: close missed leaves, promote JOINED → RETAINED after
 * settings.analytics.retentionDays, then RETAINED → VALID when onboarding is
 * complete (if required) and the anomaly score is below the threshold.
 * Idempotent; safe to re-run. System actor only.
 */
export async function runReferralSweep(ctx: ServiceContext): Promise<SweepSummary> {
  await requireSystemActor(ctx, { type: 'referral' });
  const analytics = await getSettings(ctx, 'analytics');
  const rules = await loadAnomalyRules(ctx);
  const left = await closeMissedLeaves(ctx);
  const retained = await promoteRetained(ctx, analytics.retentionDays);
  const validation = await validateRetained(ctx, analytics, rules);
  return { left, retained, ...validation };
}
