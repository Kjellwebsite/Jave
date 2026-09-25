import { and, count, eq, gte, inArray, isNotNull, isNull, max } from 'drizzle-orm';
import { z } from 'zod';
import { guildMemberEvents, members, referralCodes, referrals } from '@jave/database';
import { recordAudit } from '../audit/audit.service';
import { publishEvent } from '../events/bus';
import { DAY } from '../kernel/clock';
import { type ServiceContext, withTransaction } from '../kernel/context';
import { randomCode } from '../kernel/crypto';
import {
  ConflictError,
  ForbiddenError,
  InvalidStateError,
  isUniqueViolation,
  NotFoundError,
  ValidationError,
} from '../kernel/errors';
import { parseInput } from '../kernel/validation';
import { actorUserId, type MemberStanding } from '../permissions/actor';
import { authorize, can, isSelf, requireMember } from '../permissions/authorize';
import { consumeRateLimit } from '../rate-limit/rate-limit';
import { getMemberById } from '../identity/users.service';
import { acceptingCampaignId } from './attribution.service';
import { loadCampaign } from './campaigns.service';
import {
  MAX_ACTIVE_REFERRAL_CODES_PER_MEMBER,
  PRIVATE_MEMBER_LABEL,
  REFERRAL_CLAIM_RATE_LIMIT,
  REFERRAL_CLAIM_RATE_WINDOW_SECONDS,
  REFERRAL_CLAIM_WINDOW_DAYS,
  REFERRAL_CODE_GENERATION_ATTEMPTS,
  REFERRAL_CODE_LENGTH,
} from './constants';
import { LIVE_REFERRAL_STATUSES } from './lifecycle';
import { loadAnomalyRules, type ReferralRecord, scoreReferral, stayBounds } from './scoring';

export type ReferralCodeRecord = typeof referralCodes.$inferSelect;

/** Quarantined and banned accounts cannot credit anyone with their join. */
const BLOCKED_CLAIM_STANDINGS: readonly MemberStanding[] = ['quarantined', 'banned'];

/** Uppercase letters, digits, dash and underscore; 4–32 characters. */
export const REFERRAL_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{3,31}$/;

const referralCodeInput = z
  .string()
  .trim()
  .toUpperCase()
  .regex(REFERRAL_CODE_PATTERN, 'invalid referral code');

export const createReferralCodeSchema = z.object({
  /** Staff only: attach the code to a campaign. */
  campaignId: z.uuid().optional(),
  /** Staff only when it is not the caller: issue a code to another member. */
  ownerMemberId: z.uuid().optional(),
  /** Staff only: a chosen code instead of a random one. */
  code: referralCodeInput.optional(),
});

export const referralCodeRefSchema = z.object({ code: referralCodeInput });

async function loadOwner(ctx: ServiceContext, memberId: string) {
  const [owner] = await ctx.db
    .select({
      memberId: members.id,
      userId: members.userId,
      standing: members.standing,
      displayName: members.displayName,
    })
    .from(members)
    .where(and(eq(members.id, memberId), isNull(members.deletedAt)));
  if (!owner) throw new NotFoundError('Member');
  return owner;
}

/**
 * Create a referral code. Members create their own random codes (at most
 * MAX_ACTIVE_REFERRAL_CODES_PER_MEMBER active). Staff with canManageCampaigns
 * may attach a campaign, choose the code, or issue it to another member.
 */
export async function createReferralCode(
  ctx: ServiceContext,
  input: z.input<typeof createReferralCodeSchema> = {},
): Promise<ReferralCodeRecord> {
  const data = parseInput(createReferralCodeSchema, input);
  const forOther = data.ownerMemberId !== undefined && !isSelf(ctx.actor, data.ownerMemberId);
  const privileged = Boolean(data.campaignId || data.code || forOther);
  if (privileged) await authorize(ctx, 'canManageCampaigns', { type: 'referral_code' });
  const owner = await loadOwner(ctx, data.ownerMemberId ?? requireMember(ctx).memberId);
  if (owner.standing !== 'good') {
    throw new InvalidStateError('Referral codes require a member in good standing.');
  }
  if (data.campaignId) {
    const campaign = await loadCampaign(ctx, data.campaignId);
    if (!campaign.active) throw new InvalidStateError('That campaign is not active.');
  }
  const issuer = actorUserId(ctx.actor);

  return withTransaction(ctx, async (tx) => {
    // Serializes concurrent creations for the same owner so the cap holds.
    await tx.db
      .select({ id: members.id })
      .from(members)
      .where(eq(members.id, owner.memberId))
      .for('update');
    if (!privileged) {
      const [active] = await tx.db
        .select({ value: count() })
        .from(referralCodes)
        .where(
          and(
            eq(referralCodes.ownerUserId, owner.userId),
            eq(referralCodes.active, true),
            isNull(referralCodes.campaignId),
          ),
        );
      if ((active?.value ?? 0) >= MAX_ACTIVE_REFERRAL_CODES_PER_MEMBER) {
        throw new ConflictError(
          `You already have ${MAX_ACTIVE_REFERRAL_CODES_PER_MEMBER} active referral codes. Deactivate one first.`,
        );
      }
    }
    const attempts = data.code ? 1 : REFERRAL_CODE_GENERATION_ATTEMPTS;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const code = data.code ?? randomCode(REFERRAL_CODE_LENGTH);
      const [row] = await tx.db
        .insert(referralCodes)
        .values({
          code,
          ownerUserId: owner.userId,
          campaignId: data.campaignId ?? null,
          createdByUserId: issuer && issuer !== owner.userId ? issuer : null,
          createdAt: tx.clock.now(),
        })
        .onConflictDoNothing({ target: referralCodes.code })
        .returning();
      if (!row) continue;
      await recordAudit(tx, {
        action: 'referral_code.created',
        targetType: 'referral_code',
        targetId: row.code,
        context: { ownerMemberId: owner.memberId, campaignId: row.campaignId },
      });
      return row;
    }
    throw new ConflictError(
      data.code ? 'That code is taken.' : 'Could not allocate a code. Retry.',
    );
  });
}

/** Deactivate a code (its owner or staff with canManageCampaigns). Idempotent. */
export async function deactivateReferralCode(
  ctx: ServiceContext,
  input: z.input<typeof referralCodeRefSchema>,
): Promise<ReferralCodeRecord> {
  const data = parseInput(referralCodeRefSchema, input);
  const [row] = await ctx.db.select().from(referralCodes).where(eq(referralCodes.code, data.code));
  // Someone else's code answers exactly like an unknown one, and leaves no audit
  // row: otherwise this is a free oracle for valid codes (claims are rate-limited).
  const mayManage =
    row && (actorUserId(ctx.actor) === row.ownerUserId || can(ctx, 'canManageCampaigns'));
  if (!row || !mayManage) throw new NotFoundError('Referral code');
  if (!row.active) return row;
  return withTransaction(ctx, async (tx) => {
    const now = tx.clock.now();
    const [updated] = await tx.db
      .update(referralCodes)
      .set({ active: false, deactivatedAt: now })
      .where(eq(referralCodes.code, row.code))
      .returning();
    await recordAudit(tx, {
      action: 'referral_code.deactivated',
      targetType: 'referral_code',
      targetId: row.code,
    });
    return updated!;
  });
}

/** Time of the member's most recent recorded guild join, if JAVE observed one. */
async function lastObservedJoin(ctx: ServiceContext, userId: string): Promise<Date | null> {
  const [row] = await ctx.db
    .select({ at: max(guildMemberEvents.occurredAt) })
    .from(guildMemberEvents)
    .where(and(eq(guildMemberEvents.userId, userId), eq(guildMemberEvents.type, 'join')));
  return row?.at ?? null;
}

export interface ClaimResult {
  referralId: string;
  status: ReferralRecord['status'];
  /** Display name of the member whose code was used. */
  referrerName: string;
}

async function loadActiveCode(ctx: ServiceContext, code: string) {
  const [row] = await ctx.db
    .select({
      code: referralCodes.code,
      ownerUserId: referralCodes.ownerUserId,
      campaignId: referralCodes.campaignId,
      active: referralCodes.active,
      ownerStanding: members.standing,
      ownerName: members.displayName,
      ownerVisibility: members.profileVisibility,
      ownerDeletedAt: members.deletedAt,
    })
    .from(referralCodes)
    .innerJoin(members, eq(members.userId, referralCodes.ownerUserId))
    .where(eq(referralCodes.code, code));
  // Inactive codes and codes of members not in good standing look the same as unknown ones.
  if (!row || !row.active || row.ownerDeletedAt || row.ownerStanding !== 'good') {
    throw new NotFoundError('Referral code');
  }
  return row;
}

/**
 * Credit the caller's join to a referral code (onboarding / applications).
 * Once per person, never your own code, within REFERRAL_CLAIM_WINDOW_DAYS of
 * joining. The code re-attributes the live referral (an explicit "who
 * referred you" beats invite-link detection); the original invite code stays
 * recorded. Rate-limited against code enumeration.
 */
export async function claimReferralCode(
  ctx: ServiceContext,
  input: z.input<typeof referralCodeRefSchema>,
): Promise<ClaimResult> {
  const actor = requireMember(ctx);
  const data = parseInput(referralCodeRefSchema, input);
  if (BLOCKED_CLAIM_STANDINGS.includes(actor.standing)) {
    throw new ForbiddenError('Referral codes are unavailable for this account.');
  }
  await consumeRateLimit(
    ctx,
    `referral-claim:${actor.userId}`,
    REFERRAL_CLAIM_RATE_LIMIT,
    REFERRAL_CLAIM_RATE_WINDOW_SECONDS,
  );
  const code = await loadActiveCode(ctx, data.code);
  if (code.ownerUserId === actor.userId) {
    await recordAudit(
      ctx,
      {
        action: 'referral.self_claim_blocked',
        targetType: 'referral_code',
        targetId: code.code,
        result: 'denied',
      },
      { durable: true },
    );
    throw new ValidationError('You cannot use your own referral code.');
  }
  const [alreadyClaimed] = await ctx.db
    .select({ id: referrals.id })
    .from(referrals)
    .where(and(eq(referrals.inviteeUserId, actor.userId), isNotNull(referrals.referralCode)))
    .limit(1);
  if (alreadyClaimed) throw new ConflictError('You have already used a referral code.');

  const member = await getMemberById(ctx, actor.memberId);
  if (member.guildStatus !== 'present') {
    throw new InvalidStateError('Join the JAVELIN server before using a referral code.');
  }
  const now = ctx.clock.now();
  // Only an observed join counts: members synced before JAVE tracked joins are not "new".
  const observedJoin = await lastObservedJoin(ctx, actor.userId);
  const stay = observedJoin ? await stayBounds(ctx, actor.userId, observedJoin) : null;
  const liveRows = await ctx.db
    .select()
    .from(referrals)
    .where(
      and(
        eq(referrals.inviteeUserId, actor.userId),
        inArray(referrals.status, [...LIVE_REFERRAL_STATUSES]),
      ),
    );
  // A live referral from before the current stay is one whose leave is not processed yet.
  const live = liveRows.find((row) => !stay || row.joinedAt >= stay.from);
  const stale = liveRows.filter((row) => row !== live);
  if (!live) {
    const [counted] = await ctx.db
      .select({ id: referrals.id })
      .from(referrals)
      .where(and(eq(referrals.inviteeUserId, actor.userId), eq(referrals.status, 'valid')))
      .limit(1);
    if (counted) throw new InvalidStateError('Your referral is already recorded.');
  }
  const joinedAt = live?.joinedAt ?? observedJoin;
  if (!joinedAt) {
    throw new InvalidStateError('Referral codes are for members who joined recently.');
  }
  if (!live && stay) {
    // This stay was already attributed and closed (invalidated, self-invite): not re-openable.
    const [closed] = await ctx.db
      .select({ id: referrals.id })
      .from(referrals)
      .where(and(eq(referrals.inviteeUserId, actor.userId), gte(referrals.joinedAt, stay.from)))
      .limit(1);
    if (closed) throw new InvalidStateError('Your referral for this join can no longer change.');
  }
  if (now.getTime() - joinedAt.getTime() > REFERRAL_CLAIM_WINDOW_DAYS * DAY) {
    throw new InvalidStateError(
      `Referral codes can only be used within ${REFERRAL_CLAIM_WINDOW_DAYS} days of joining.`,
    );
  }
  const campaignId =
    (await acceptingCampaignId(ctx, code.campaignId, now)) ?? live?.campaignId ?? null;
  const anomaly = await scoreReferral(
    ctx,
    {
      referralId: live?.id ?? null,
      inviterUserId: code.ownerUserId,
      inviteeUserId: actor.userId,
      joinedAt,
      leftAt: null,
    },
    await loadAnomalyRules(ctx),
  );
  const attribution = {
    inviterUserId: code.ownerUserId,
    referralCode: code.code,
    campaignId,
    method: 'referral_code' as const,
    anomalyFlags: anomaly.flags,
    anomalyScore: anomaly.score,
    // A new inviter voids any earlier review.
    reviewedByUserId: null,
    reviewedAt: null,
    reviewNote: null,
    updatedAt: now,
  };

  try {
    return await withTransaction(ctx, async (tx) => {
      if (stale.length > 0) {
        // Same rule as attributeJoin: a new stay supersedes an earlier one still marked live.
        await tx.db
          .update(referrals)
          .set({
            status: 'left',
            statusReason: 'superseded',
            leftAt: stay?.lastLeaveAt ?? joinedAt,
            updatedAt: now,
          })
          .where(
            and(
              inArray(
                referrals.id,
                stale.map((row) => row.id),
              ),
              inArray(referrals.status, [...LIVE_REFERRAL_STATUSES]),
            ),
          );
      }
      const [row] = live
        ? await tx.db
            .update(referrals)
            .set(attribution)
            .where(
              and(
                eq(referrals.id, live.id),
                inArray(referrals.status, [...LIVE_REFERRAL_STATUSES]),
                // A concurrent claim that won the row makes this one a no-op.
                isNull(referrals.referralCode),
              ),
            )
            .returning()
        : await tx.db
            .insert(referrals)
            .values({
              ...attribution,
              inviteeUserId: actor.userId,
              status: 'joined',
              joinedAt,
              createdAt: now,
            })
            .returning();
      if (!row) {
        const [current] = live
          ? await tx.db
              .select({ referralCode: referrals.referralCode })
              .from(referrals)
              .where(eq(referrals.id, live.id))
          : [];
        if (current?.referralCode)
          throw new ConflictError('You have already used a referral code.');
        throw new InvalidStateError('Your referral changed meanwhile. Retry.');
      }
      await recordAudit(tx, {
        action: 'referral.code_claimed',
        targetType: 'referral',
        targetId: row.id,
        context: {
          code: code.code,
          previousInviterUserId: live?.inviterUserId ?? null,
          previousMethod: live?.method ?? null,
        },
      });
      await publishEvent(tx, {
        type: 'referral.recorded',
        aggregateType: 'referral',
        aggregateId: row.id,
        subjectMemberId: actor.memberId,
        payload: {
          method: row.method,
          status: row.status,
          campaignId: row.campaignId,
          flagged: row.anomalyFlags.length > 0,
          reattributed: Boolean(live),
        },
      });
      const referrerName = code.ownerVisibility === 'staff' ? PRIVATE_MEMBER_LABEL : code.ownerName;
      return { referralId: row.id, status: row.status, referrerName };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError('You have already used a referral code.');
    }
    throw error;
  }
}
