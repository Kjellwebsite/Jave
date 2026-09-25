import { and, eq, inArray, lt } from 'drizzle-orm';
import { z } from 'zod';
import { campaigns, inviteCodes, members, referrals, users } from '@jave/database';
import { recordAudit } from '../audit/audit.service';
import { publishEvent } from '../events/bus';
import { type ServiceContext, withTransaction } from '../kernel/context';
import { isUniqueViolation, NotFoundError, ValidationError } from '../kernel/errors';
import { parseInput } from '../kernel/validation';
import { requireSystemActor } from './access';
import { campaignAccepts } from './campaigns.service';
import { MAX_JOIN_CLOCK_SKEW_MS } from './constants';
import { LIVE_REFERRAL_STATUSES } from './lifecycle';
import { loadAnomalyRules, type ReferralRecord, scoreReferral } from './scoring';
import { INVITE_CODE_PATTERN } from './sync.service';

export const attributeJoinSchema = z.object({
  inviteeUserId: z.uuid(),
  /** The invite detected by detectUsedInvite, or null when unknown. */
  usedCode: z.string().regex(INVITE_CODE_PATTERN, 'invalid invite code').nullable(),
  /** The join came through the guild's vanity URL. */
  vanity: z.boolean().default(false),
  /** Discord's join timestamp. Retries with the same value are idempotent. Defaults to now. */
  joinedAt: z.coerce.date().optional(),
});

type ReferralMethod = ReferralRecord['method'];

interface ReferralSource {
  method: ReferralMethod;
  inviteCode: string | null;
  inviterUserId: string | null;
  campaignId: string | null;
}

export interface AttributionResult {
  referral: ReferralRecord;
  /** False when this join had already been attributed (idempotent retry). */
  created: boolean;
}

async function findReferralForJoin(
  ctx: ServiceContext,
  inviteeUserId: string,
  joinedAt: Date,
): Promise<ReferralRecord | null> {
  const [row] = await ctx.db
    .select()
    .from(referrals)
    .where(and(eq(referrals.inviteeUserId, inviteeUserId), eq(referrals.joinedAt, joinedAt)));
  return row ?? null;
}

/** The campaign id when the campaign accepts attributions at `at`, otherwise null. */
export async function acceptingCampaignId(
  ctx: ServiceContext,
  campaignId: string | null,
  at: Date,
): Promise<string | null> {
  if (!campaignId) return null;
  const [campaign] = await ctx.db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  return campaign && campaignAccepts(campaign, at) ? campaign.id : null;
}

async function resolveSource(
  ctx: ServiceContext,
  data: z.infer<typeof attributeJoinSchema>,
  joinedAt: Date,
): Promise<ReferralSource> {
  const fallback: ReferralMethod = data.vanity ? 'vanity' : 'unknown';
  if (!data.usedCode) {
    return { method: fallback, inviteCode: null, inviterUserId: null, campaignId: null };
  }
  // Deleted invites are included: a max-uses invite is deleted by the use that brought this member.
  const [invite] = await ctx.db
    .select()
    .from(inviteCodes)
    .where(eq(inviteCodes.code, data.usedCode));
  if (!invite) {
    // Not mirrored yet: keep the code for traceability, credit nobody.
    return { method: fallback, inviteCode: data.usedCode, inviterUserId: null, campaignId: null };
  }
  const campaignId = await acceptingCampaignId(ctx, invite.campaignId, joinedAt);
  if (invite.isVanity || data.vanity) {
    return { method: 'vanity', inviteCode: invite.code, inviterUserId: null, campaignId };
  }
  return {
    method: 'invite',
    inviteCode: invite.code,
    inviterUserId: invite.inviterUserId,
    campaignId,
  };
}

/**
 * Attribute a guild join to its source (bot: guildMemberAdd, after
 * recordGuildJoin). Creates one referral per join — JOINED, or INVALID for a
 * self-invite — with anomaly flags. Idempotent per invitee + joinedAt.
 * A still-live referral from an earlier join of the same person is closed.
 * System actor only.
 */
export async function attributeJoin(
  ctx: ServiceContext,
  input: z.input<typeof attributeJoinSchema>,
): Promise<AttributionResult> {
  await requireSystemActor(ctx, { type: 'referral' });
  const data = parseInput(attributeJoinSchema, input);
  const now = ctx.clock.now();
  const joinedAt = data.joinedAt ?? now;
  if (joinedAt.getTime() > now.getTime() + MAX_JOIN_CLOCK_SKEW_MS) {
    throw new ValidationError('joinedAt is in the future.');
  }
  const [invitee] = await ctx.db
    .select({ id: users.id, isBot: users.isBot, deletedAt: users.deletedAt })
    .from(users)
    .where(eq(users.id, data.inviteeUserId));
  if (!invitee || invitee.deletedAt) throw new NotFoundError('User');
  if (invitee.isBot) throw new ValidationError('Bot accounts are not referrals.');

  const existing = await findReferralForJoin(ctx, invitee.id, joinedAt);
  if (existing) return { referral: existing, created: false };

  const source = await resolveSource(ctx, data, joinedAt);
  const rules = await loadAnomalyRules(ctx);
  const anomaly = await scoreReferral(
    ctx,
    {
      referralId: null,
      inviterUserId: source.inviterUserId,
      inviteeUserId: invitee.id,
      joinedAt,
      leftAt: null,
    },
    rules,
  );
  const selfInvite = anomaly.flags.includes('self_invite');

  try {
    return await withTransaction(ctx, async (tx) => {
      // An earlier join still marked live means its leave was never recorded.
      await tx.db
        .update(referrals)
        .set({ status: 'left', statusReason: 'superseded', leftAt: joinedAt })
        .where(
          and(
            eq(referrals.inviteeUserId, invitee.id),
            inArray(referrals.status, [...LIVE_REFERRAL_STATUSES]),
            lt(referrals.joinedAt, joinedAt),
          ),
        );
      // Out-of-order delivery: a newer join is already live, so this one is history.
      const [newer] = await tx.db
        .select({ joinedAt: referrals.joinedAt })
        .from(referrals)
        .where(
          and(
            eq(referrals.inviteeUserId, invitee.id),
            inArray(referrals.status, [...LIVE_REFERRAL_STATUSES]),
          ),
        );
      const [row] = await tx.db
        .insert(referrals)
        .values({
          inviteeUserId: invitee.id,
          inviterUserId: source.inviterUserId,
          inviteCode: source.inviteCode,
          campaignId: source.campaignId,
          method: source.method,
          status: selfInvite ? 'invalid' : newer ? 'left' : 'joined',
          statusReason: selfInvite ? 'self_invite' : newer ? 'superseded' : null,
          joinedAt,
          leftAt: !selfInvite && newer ? newer.joinedAt : null,
          anomalyFlags: anomaly.flags,
          anomalyScore: anomaly.score,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      const referral = row!;
      if (selfInvite) {
        await recordAudit(tx, {
          action: 'referral.self_invite_flagged',
          targetType: 'referral',
          targetId: referral.id,
          context: { inviteCode: source.inviteCode, inviteeUserId: invitee.id },
        });
      }
      const [inviteeMember] = await tx.db
        .select({ id: members.id })
        .from(members)
        .where(eq(members.userId, invitee.id));
      await publishEvent(tx, {
        type: 'referral.recorded',
        aggregateType: 'referral',
        aggregateId: referral.id,
        subjectMemberId: inviteeMember?.id ?? null,
        payload: {
          method: referral.method,
          status: referral.status,
          campaignId: referral.campaignId,
          flagged: referral.anomalyFlags.length > 0,
        },
      });
      return { referral, created: true };
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    // A concurrent attribution of the same join won the race.
    const winner = await findReferralForJoin(ctx, invitee.id, joinedAt);
    if (!winner) throw error;
    return { referral: winner, created: false };
  }
}
