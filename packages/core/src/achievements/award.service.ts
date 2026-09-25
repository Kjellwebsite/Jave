import { and, eq, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import { memberAchievements } from '@jave/database';
import { type ServiceContext, withTransaction } from '../kernel/context';
import { ConflictError, ForbiddenError, InvalidStateError, NotFoundError } from '../kernel/errors';
import { parseInput } from '../kernel/validation';
import { recordAudit } from '../audit/audit.service';
import { publishEvent } from '../events/bus';
import { notify } from '../notifications/notifications.service';
import { actorUserId } from '../permissions/actor';
import { authorize, isSelf } from '../permissions/authorize';
import { achievementHeadline } from './criteria';
import { scheduleAchievementAnnouncement, scheduleAchievementRetraction } from './discord-jobs';
import { grantAchievement } from './grant';
import { requireSystemActor } from './guards';
import {
  awardAchievementSchema,
  memberAchievementSchema,
  revokeAchievementSchema,
  systemAwardSchema,
} from './schemas';
import {
  type AwardableMember,
  findActiveAward,
  hasAwardHistory,
  loadAwardableMember,
  loadDefinition,
  type MemberAchievementRecord,
} from './store';

async function blockSelfAction(
  ctx: ServiceContext,
  memberId: string,
  key: string,
  action: 'award' | 'revoke' | 'verify',
): Promise<void> {
  if (!isSelf(ctx.actor, memberId)) return;
  await recordAudit(
    ctx,
    {
      action: `achievement.self_${action}_blocked`,
      targetType: 'member',
      targetId: memberId,
      context: { key },
      result: 'denied',
    },
    { durable: true },
  );
  throw new ForbiddenError(`You cannot ${action} your own achievements.`);
}

async function requireAwardableMember(
  ctx: ServiceContext,
  memberId: string,
): Promise<AwardableMember> {
  const member = await loadAwardableMember(ctx, memberId);
  if (!member) throw new NotFoundError('Member');
  return member;
}

/**
 * Staff award (canAwardAchievements). Never to yourself. Works for any active
 * definition, including after a revocation. Awards that require
 * verification start UNVERIFIED and need a second person.
 */
export async function awardAchievement(
  ctx: ServiceContext,
  input: z.input<typeof awardAchievementSchema>,
): Promise<MemberAchievementRecord> {
  const data = parseInput(awardAchievementSchema, input);
  await authorize(ctx, 'canAwardAchievements', { type: 'member', id: data.memberId });
  await blockSelfAction(ctx, data.memberId, data.key, 'award');
  const definition = await loadDefinition(ctx, data.key);
  if (!definition.active) throw new InvalidStateError('This achievement is inactive.');
  const member = await requireAwardableMember(ctx, data.memberId);
  return withTransaction(ctx, async (tx) => {
    const award = await grantAchievement(tx, {
      member,
      definition,
      source: 'manual',
      note: data.reason,
      announce: true,
    });
    if (!award) throw new ConflictError('The member already holds this achievement.');
    await recordAudit(tx, {
      action: 'achievement.awarded',
      targetType: 'member',
      targetId: member.id,
      context: { key: definition.key, reason: data.reason, awardId: award.id },
    });
    return award;
  });
}

export type SystemAwardOutcome =
  | { status: 'awarded'; award: MemberAchievementRecord }
  | {
      status: 'skipped';
      reason: 'inactive' | 'ineligible_member' | 'already_held' | 'previously_revoked';
    };

/**
 * Automatic award by a system process (the rule engine, mission rewards).
 * System actor only. Never overrides a revocation: once staff revoked an
 * award, only a manual award can restore it. Missing or inactive
 * definitions, and deleted or banned members, are skipped rather than failed.
 * Run it inside the caller's transaction to keep the award atomic with the
 * state change that earned it.
 */
export async function awardAchievementFromSystem(
  ctx: ServiceContext,
  input: z.input<typeof systemAwardSchema>,
): Promise<SystemAwardOutcome> {
  requireSystemActor(ctx);
  const data = parseInput(systemAwardSchema, input);
  const definition = await loadDefinition(ctx, data.key).catch((error: unknown) => {
    if (error instanceof NotFoundError) return null;
    throw error;
  });
  if (!definition?.active) return { status: 'skipped', reason: 'inactive' };
  const member = await loadAwardableMember(ctx, data.memberId);
  if (!member) return { status: 'skipped', reason: 'ineligible_member' };
  if (await findActiveAward(ctx, member.id, definition.key))
    return { status: 'skipped', reason: 'already_held' };
  if (await hasAwardHistory(ctx, member.id, definition.key))
    return { status: 'skipped', reason: 'previously_revoked' };
  return withTransaction(ctx, async (tx) => {
    const award = await grantAchievement(tx, {
      member,
      definition,
      source: 'system',
      sourceEventId: data.sourceEventId,
      note: data.reason,
      announce: data.announce,
    });
    return award
      ? { status: 'awarded', award }
      : { status: 'skipped', reason: 'already_held' as const };
  });
}

/**
 * Revoke an active award (canAwardAchievements). Never your own. The award
 * row is kept with the reason; automatic processes will not re-award it.
 */
export async function revokeAchievement(
  ctx: ServiceContext,
  input: z.input<typeof revokeAchievementSchema>,
): Promise<MemberAchievementRecord> {
  const data = parseInput(revokeAchievementSchema, input);
  await authorize(ctx, 'canAwardAchievements', { type: 'member', id: data.memberId });
  await blockSelfAction(ctx, data.memberId, data.key, 'revoke');
  const definition = await loadDefinition(ctx, data.key);
  return withTransaction(ctx, async (tx) => {
    const now = tx.clock.now();
    const [revoked] = await tx.db
      .update(memberAchievements)
      .set({ revokedAt: now, revokeReason: data.reason, revokedByUserId: actorUserId(tx.actor) })
      .where(
        and(
          eq(memberAchievements.memberId, data.memberId),
          eq(memberAchievements.achievementKey, data.key),
          isNull(memberAchievements.revokedAt),
        ),
      )
      .returning();
    if (!revoked) throw new NotFoundError('Achievement award');
    await recordAudit(tx, {
      action: 'achievement.revoked',
      targetType: 'member',
      targetId: data.memberId,
      context: { key: data.key, reason: data.reason, awardId: revoked.id },
    });
    await publishEvent(tx, {
      type: 'achievement.revoked',
      aggregateType: 'member_achievement',
      aggregateId: revoked.id,
      subjectMemberId: data.memberId,
      payload: { key: data.key },
    });
    const member = await loadAwardableMember(tx, data.memberId);
    if (member) {
      await notify(tx, {
        recipientUserId: member.userId,
        type: 'achievement.updated',
        title: 'ACHIEVEMENT REVOKED',
        body: `${definition.title.toUpperCase()} — revoked by staff. Open a ticket if you think this is wrong.`,
        data: { key: data.key, memberAchievementId: revoked.id },
        dedupeKey: `achievement:${revoked.id}:revoked`,
      });
    }
    await scheduleAchievementRetraction(tx, revoked);
    return revoked;
  });
}

/**
 * Verify an UNVERIFIED award (canAwardAchievements). Four-eyes: neither the
 * holder nor the person who awarded it may verify it. Verification queues the
 * public announcement.
 */
export async function verifyMemberAchievement(
  ctx: ServiceContext,
  input: z.input<typeof memberAchievementSchema>,
): Promise<MemberAchievementRecord> {
  const data = parseInput(memberAchievementSchema, input);
  await authorize(ctx, 'canAwardAchievements', { type: 'member', id: data.memberId });
  await blockSelfAction(ctx, data.memberId, data.key, 'verify');
  const definition = await loadDefinition(ctx, data.key);
  const award = await findActiveAward(ctx, data.memberId, data.key);
  if (!award) throw new NotFoundError('Achievement award');
  if (award.verification === 'verified')
    throw new InvalidStateError('This award is already verified.');
  const verifier = actorUserId(ctx.actor);
  if (verifier !== null && award.awardedByUserId === verifier) {
    throw new ForbiddenError('Someone other than the awarder must verify this award.');
  }
  const member = await requireAwardableMember(ctx, data.memberId);
  return withTransaction(ctx, async (tx) => {
    const now = tx.clock.now();
    const [verified] = await tx.db
      .update(memberAchievements)
      .set({ verification: 'verified', verifiedAt: now, verifiedByUserId: verifier })
      .where(
        and(
          eq(memberAchievements.id, award.id),
          eq(memberAchievements.verification, 'unverified'),
          isNull(memberAchievements.revokedAt),
        ),
      )
      .returning();
    if (!verified) throw new ConflictError('This award changed while you were reviewing it.');
    await recordAudit(tx, {
      action: 'achievement.verified',
      targetType: 'member',
      targetId: member.id,
      context: { key: data.key, awardId: verified.id },
    });
    await publishEvent(tx, {
      type: 'achievement.verified',
      aggregateType: 'member_achievement',
      aggregateId: verified.id,
      subjectMemberId: member.id,
      payload: { key: data.key },
    });
    await notify(tx, {
      recipientUserId: member.userId,
      type: 'achievement.updated',
      title: 'ACHIEVEMENT VERIFIED',
      body: achievementHeadline(definition),
      data: { key: data.key, memberAchievementId: verified.id },
      dedupeKey: `achievement:${verified.id}:verified`,
    });
    await scheduleAchievementAnnouncement(tx, verified, definition, member);
    return verified;
  });
}
