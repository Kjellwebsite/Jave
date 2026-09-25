import { and, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { modCases, securityEvents } from '@jave/database';
import { recordAudit } from '../audit/audit.service';
import { publishEvent } from '../events/bus';
import { type ServiceContext, withTransaction } from '../kernel/context';
import { ConflictError, InvalidStateError, NotFoundError, ValidationError } from '../kernel/errors';
import { parseInput } from '../kernel/validation';
import { authorize } from '../permissions/authorize';
import type { Capability } from '../permissions/capabilities';
import {
  applyDedupeKey,
  caseLiftedBy,
  casesSupersededBy,
  cleanSyncError,
  executeCase,
  isLiveAction,
  isReversal,
  buildApplyPayload,
  loadLiveCases,
  lockTarget,
  type ModCaseRecord,
  notifySyncFailure,
  REVERSAL_OF,
  supersedeViolation,
  timeoutInForce,
} from './case-engine';
import { loadCaseView, type ModCaseView } from './cases.query';
import {
  MAX_BAN_DELETE_MESSAGE_DAYS,
  MAX_QUARANTINE_SECONDS,
  MAX_REASON_LENGTH,
  MAX_SYNC_ERROR_INPUT,
  MAX_TIMEOUT_SECONDS,
  MIN_QUARANTINE_SECONDS,
  MIN_REASON_LENGTH,
  MIN_TIMEOUT_SECONDS,
} from './constants';
import { caseReference, type ModAction } from './copy';
import { enqueueDiscordJob, moderationApplyContract } from './discord-jobs';
import {
  assertCanActOn,
  deny,
  issuerRoles,
  loadTarget,
  type ModerationTarget,
  overturnViolation,
  requireSystemActor,
} from './targets';

/** Capability required per action (and to revoke a case of that action). */
export const CASE_CAPABILITY: Record<ModAction, Capability> = {
  warn: 'canModerate',
  timeout: 'canModerate',
  untimeout: 'canModerate',
  note: 'canModerate',
  kick: 'canKickMembers',
  ban: 'canBanMembers',
  unban: 'canBanMembers',
  quarantine: 'canQuarantine',
  release: 'canQuarantine',
};

const snowflake = z.string().regex(/^\d{17,20}$/, 'must be a Discord ID');
const reasonSchema = z
  .string()
  .trim()
  .min(MIN_REASON_LENGTH, 'Give a reason')
  .max(MAX_REASON_LENGTH, `Keep the reason under ${MAX_REASON_LENGTH} characters`);

const targetShape = {
  targetUserId: z.uuid().optional(),
  targetDiscordId: snowflake.optional(),
  reason: reasonSchema,
  /** Link to the security event this action responds to (e.g. the alert's QUARANTINE button). */
  securityEventId: z.uuid().optional(),
  /** 'ai_suggested' when a confirmed AI proposal executes this action. */
  source: z.enum(['manual', 'ai_suggested']).default('manual'),
};

const exactlyOneTarget = (value: { targetUserId?: string; targetDiscordId?: string }) =>
  Boolean(value.targetUserId) !== Boolean(value.targetDiscordId);
const TARGET_RULE = {
  message: 'Give exactly one of targetUserId or targetDiscordId.',
  path: ['targetUserId'],
};
const baseCaseSchema = z.object(targetShape);

export const warnSchema = baseCaseSchema.refine(exactlyOneTarget, TARGET_RULE);
export const noteSchema = baseCaseSchema.refine(exactlyOneTarget, TARGET_RULE);
export const kickSchema = baseCaseSchema.refine(exactlyOneTarget, TARGET_RULE);
export const untimeoutSchema = baseCaseSchema.refine(exactlyOneTarget, TARGET_RULE);
export const unbanSchema = baseCaseSchema.refine(exactlyOneTarget, TARGET_RULE);
export const releaseSchema = baseCaseSchema.refine(exactlyOneTarget, TARGET_RULE);
export const timeoutSchema = baseCaseSchema
  .extend({
    durationSeconds: z
      .number()
      .int()
      .min(MIN_TIMEOUT_SECONDS, `Timeouts last at least ${MIN_TIMEOUT_SECONDS} seconds`)
      .max(MAX_TIMEOUT_SECONDS, 'Discord limits timeouts to 28 days'),
  })
  .refine(exactlyOneTarget, TARGET_RULE);
export const banSchema = baseCaseSchema
  .extend({
    deleteMessageDays: z.number().int().min(0).max(MAX_BAN_DELETE_MESSAGE_DAYS).default(0),
  })
  .refine(exactlyOneTarget, TARGET_RULE);
export const quarantineSchema = baseCaseSchema
  .extend({
    durationSeconds: z
      .number()
      .int()
      .min(MIN_QUARANTINE_SECONDS)
      .max(
        MAX_QUARANTINE_SECONDS,
        'Quarantines are limited to 90 days; omit the duration for indefinite',
      )
      .optional(),
  })
  .refine(exactlyOneTarget, TARGET_RULE);

type CaseInput = z.output<typeof warnSchema> & {
  durationSeconds?: number;
  deleteMessageDays?: number;
};

async function checkSecurityEventLink(
  ctx: ServiceContext,
  securityEventId: string,
  target: ModerationTarget,
): Promise<void> {
  const [event] = await ctx.db
    .select({ userId: securityEvents.userId })
    .from(securityEvents)
    .where(eq(securityEvents.id, securityEventId));
  if (!event) throw new NotFoundError('Security event');
  if (event.userId !== target.userId) {
    throw new ValidationError('That security event concerns a different user.');
  }
}

async function createManualCase(
  ctx: ServiceContext,
  action: ModAction,
  data: CaseInput,
): Promise<ModCaseView> {
  await authorize(ctx, CASE_CAPABILITY[action], {
    type: 'user',
    id: data.targetUserId ?? data.targetDiscordId ?? null,
  });
  const target = await loadTarget(
    ctx,
    data.targetUserId ? { userId: data.targetUserId } : { discordId: data.targetDiscordId ?? '' },
  );
  await assertCanActOn(ctx, target, action);

  const live = await loadLiveCases(ctx, target.userId);
  const blocked = await supersedeViolation(ctx, casesSupersededBy(action, live, ctx.clock.now()));
  if (blocked)
    await deny(ctx, blocked.message, { type: 'mod_case', id: blocked.caseId }, { action });
  if (isReversal(action)) {
    const lifted = caseLiftedBy(action, live, ctx.clock.now());
    const violation = overturnViolation(
      ctx.actor,
      await issuerRoles(ctx, lifted?.moderatorUserId ?? null),
    );
    if (violation) {
      await deny(ctx, violation, { type: 'mod_case', id: lifted?.id ?? null }, { action });
    }
  }
  if (data.securityEventId) await checkSecurityEventLink(ctx, data.securityEventId, target);

  const record = await executeCase(ctx, {
    action,
    target,
    reason: data.reason,
    source: data.securityEventId ? 'security_event' : data.source,
    durationSeconds: data.durationSeconds ?? null,
    deleteMessageDays: data.deleteMessageDays ?? null,
    securityEventId: data.securityEventId ?? null,
  });
  return loadCaseView(ctx, record.id);
}

/**
 * Warn a member (canModerate). The target is notified; the bot DMs the warning.
 * For every action except notes, the reason is shown to the member.
 */
export async function warnMember(ctx: ServiceContext, input: z.input<typeof warnSchema>) {
  return createManualCase(ctx, 'warn', parseInput(warnSchema, input));
}

/** Time a member out, 1 minute – 28 days (canModerate). Replaces a running timeout. */
export async function timeoutMember(ctx: ServiceContext, input: z.input<typeof timeoutSchema>) {
  return createManualCase(ctx, 'timeout', parseInput(timeoutSchema, input));
}

/** Lift a running timeout (canModerate). */
export async function untimeoutMember(ctx: ServiceContext, input: z.input<typeof untimeoutSchema>) {
  return createManualCase(ctx, 'untimeout', parseInput(untimeoutSchema, input));
}

/** Kick a member (canKickMembers). */
export async function kickMember(ctx: ServiceContext, input: z.input<typeof kickSchema>) {
  return createManualCase(ctx, 'kick', parseInput(kickSchema, input));
}

/** Ban a user, optionally deleting 0–7 days of messages (canBanMembers). */
export async function banMember(ctx: ServiceContext, input: z.input<typeof banSchema>) {
  return createManualCase(ctx, 'ban', parseInput(banSchema, input));
}

/** Lift a ban (canBanMembers). */
export async function unbanMember(ctx: ServiceContext, input: z.input<typeof unbanSchema>) {
  return createManualCase(ctx, 'unban', parseInput(unbanSchema, input));
}

/** Quarantine a member, indefinitely or for a duration (canQuarantine). */
export async function quarantineMember(
  ctx: ServiceContext,
  input: z.input<typeof quarantineSchema>,
) {
  return createManualCase(ctx, 'quarantine', parseInput(quarantineSchema, input));
}

/** Release a quarantined member (canQuarantine). */
export async function releaseMember(ctx: ServiceContext, input: z.input<typeof releaseSchema>) {
  return createManualCase(ctx, 'release', parseInput(releaseSchema, input));
}

/** Private staff note on a member's record (canModerate). Never shown to the member. */
export async function addModNote(ctx: ServiceContext, input: z.input<typeof noteSchema>) {
  return createManualCase(ctx, 'note', parseInput(noteSchema, input));
}

export const revokeCaseSchema = z.object({
  caseId: z.uuid(),
  reason: reasonSchema,
});

export interface RevokeResult {
  case: ModCaseView;
  /** The untimeout / release / unban created when the case was still in force. */
  reversal: ModCaseView | null;
}

/**
 * Revoke a case (appeal granted, issued in error, early release). A case
 * still in force is lifted through a reversal case. Needs the capability of
 * the original action (ban → canBanMembers). You cannot revoke a case about
 * yourself, about a member ranked at or above you, or one issued by
 * higher-ranked staff.
 */
export async function revokeCase(
  ctx: ServiceContext,
  input: z.input<typeof revokeCaseSchema>,
): Promise<RevokeResult> {
  const data = parseInput(revokeCaseSchema, input);
  // Baseline check first so unauthorized callers learn nothing about case existence.
  await authorize(ctx, 'canModerate', { type: 'mod_case', id: data.caseId });
  const [record] = await ctx.db.select().from(modCases).where(eq(modCases.id, data.caseId));
  if (!record) throw new NotFoundError('Case');
  await authorize(ctx, CASE_CAPABILITY[record.action], { type: 'mod_case', id: record.id });
  if (isReversal(record.action)) {
    throw new InvalidStateError('Reversal cases cannot be revoked. Issue a new action instead.');
  }
  if (record.revokedAt)
    throw new ConflictError(`${caseReference(record.number)} is already revoked.`);
  if (ctx.actor.kind === 'user' && ctx.actor.userId === record.targetUserId) {
    await deny(ctx, 'You cannot revoke a case about yourself.', {
      type: 'mod_case',
      id: record.id,
    });
  }
  const violation = overturnViolation(ctx.actor, await issuerRoles(ctx, record.moderatorUserId));
  if (violation) await deny(ctx, violation, { type: 'mod_case', id: record.id });
  const target = await loadTarget(ctx, { userId: record.targetUserId });
  // Same rank rule as issuing: a member promoted since the case is out of reach.
  // Revocation only lifts restrictions, so automated actors are not limited here.
  if (ctx.actor.kind === 'user') await assertCanActOn(ctx, target, record.action);

  const reversalId = await withTransaction(ctx, async (tx) => {
    await lockTarget(tx, record.targetUserId);
    const now = tx.clock.now();
    const rows = await tx.db
      .update(modCases)
      .set({
        revokedAt: now,
        revokedByUserId: tx.actor.kind === 'user' ? tx.actor.userId : null,
        revokeReason: data.reason,
        updatedAt: now,
      })
      .where(and(eq(modCases.id, record.id), isNull(modCases.revokedAt)))
      .returning();
    // Fresh under the target lock: the case may have ended since it was read.
    const current = rows[0];
    if (!current) throw new ConflictError(`${caseReference(record.number)} is already revoked.`);

    let reversal: ModCaseRecord | null = null;
    if (isLiveAction(current.action) && !current.endedAt) {
      const stillInForce = current.action !== 'timeout' || timeoutInForce(current, now);
      if (stillInForce) {
        reversal = await executeCase(tx, {
          action: REVERSAL_OF[current.action],
          target,
          reason: `${caseReference(record.number)} revoked: ${data.reason}`,
          source: 'manual',
          endReason: 'revoked',
        });
      } else {
        await tx.db
          .update(modCases)
          .set({ endedAt: current.expiresAt ?? now, endedReason: 'expired' })
          .where(and(eq(modCases.id, current.id), isNull(modCases.endedAt)));
      }
    }
    await recordAudit(tx, {
      action: 'moderation.case_revoked',
      targetType: 'mod_case',
      targetId: record.id,
      context: {
        case: caseReference(record.number),
        action: record.action,
        targetUserId: record.targetUserId,
        reason: data.reason,
        reversalCaseId: reversal?.id ?? null,
      },
    });
    await publishEvent(tx, {
      type: 'moderation.case_revoked',
      aggregateType: 'mod_case',
      aggregateId: record.id,
      subjectMemberId: target.memberId,
      payload: {
        caseId: record.id,
        number: record.number,
        action: record.action,
        reversalCaseId: reversal?.id ?? null,
      },
    });
    return reversal?.id ?? null;
  });
  return {
    case: await loadCaseView(ctx, record.id),
    reversal: reversalId ? await loadCaseView(ctx, reversalId) : null,
  };
}

export const markCaseSyncedSchema = z.object({
  caseId: z.uuid(),
  status: z.enum(['applied', 'failed']),
  error: z.string().max(MAX_SYNC_ERROR_INPUT).optional(),
});

/**
 * Bot callback for `discord.moderation.apply`: records whether the Discord
 * action was applied. Idempotent; an applied case stays applied. System only.
 */
export async function markCaseSynced(
  ctx: ServiceContext,
  input: z.input<typeof markCaseSyncedSchema>,
): Promise<{ discordSync: ModCaseRecord['discordSync']; changed: boolean }> {
  const data = parseInput(markCaseSyncedSchema, input);
  await requireSystemActor(ctx, { type: 'mod_case', id: data.caseId });
  const [record] = await ctx.db.select().from(modCases).where(eq(modCases.id, data.caseId));
  if (!record) throw new NotFoundError('Case');
  if (record.discordSync === 'not_required') {
    throw new InvalidStateError('This case has no Discord action.');
  }
  if (record.discordSync === 'applied') return { discordSync: 'applied', changed: false };

  const error = data.status === 'failed' ? cleanSyncError(data.error ?? 'unknown error') : null;
  return withTransaction(ctx, async (tx) => {
    const now = tx.clock.now();
    const [updated] = await tx.db
      .update(modCases)
      .set({
        discordSync: data.status,
        discordError: error,
        discordSyncedAt: data.status === 'applied' ? now : null,
        updatedAt: now,
      })
      .where(and(eq(modCases.id, record.id), inArray(modCases.discordSync, ['pending', 'failed'])))
      .returning();
    if (!updated) return { discordSync: record.discordSync, changed: false };
    if (data.status === 'applied' && updated.endedAt) {
      await healLateApply(tx, updated);
    }
    if (data.status === 'failed' && error) {
      await recordAudit(tx, {
        action: 'moderation.case_sync_failed',
        targetType: 'mod_case',
        targetId: record.id,
        context: { case: caseReference(record.number), action: record.action, error },
        result: 'failure',
      });
      await notifySyncFailure(tx, updated, error);
    }
    return { discordSync: updated.discordSync, changed: true };
  });
}

/** What the bot needs before applying a case (see the apply contract). System only. */
export interface CaseSyncState {
  caseId: string;
  action: ModCaseRecord['action'];
  /** False when the case no longer needs a Discord action (revoked, lifted, superseded, expired). */
  apply: boolean;
  reason: 'in_force' | 'ended' | 'revoked' | 'not_required';
}

export async function getCaseForSync(ctx: ServiceContext, caseId: string): Promise<CaseSyncState> {
  const id = parseInput(z.uuid(), caseId);
  await requireSystemActor(ctx, { type: 'mod_case', id });
  const [record] = await ctx.db.select().from(modCases).where(eq(modCases.id, id));
  if (!record) throw new NotFoundError('Case');
  const base = { caseId: record.id, action: record.action };
  if (record.discordSync === 'not_required')
    return { ...base, apply: false, reason: 'not_required' };
  if (record.revokedAt && isLiveAction(record.action))
    return { ...base, apply: false, reason: 'revoked' };
  if (record.endedAt && isLiveAction(record.action))
    return { ...base, apply: false, reason: 'ended' };
  return { ...base, apply: true, reason: 'in_force' };
}

/**
 * An apply reported after its case already ended (the job was mid-flight when
 * a reversal ran) left Discord more restrictive than JAVE. Re-send the
 * reversal that ended it, so Discord converges on JAVE's state.
 */
async function healLateApply(ctx: ServiceContext, record: ModCaseRecord): Promise<void> {
  const [reversal] = await ctx.db
    .select()
    .from(modCases)
    .where(and(eq(modCases.revertsCaseId, record.id), isNull(modCases.revokedAt)));
  await recordAudit(ctx, {
    action: 'moderation.case_applied_after_end',
    targetType: 'mod_case',
    targetId: record.id,
    context: { case: caseReference(record.number), reversalCaseId: reversal?.id ?? null },
    result: 'failure',
  });
  if (!reversal || reversal.discordSync === 'not_required') return;
  const target = await loadTarget(ctx, { userId: reversal.targetUserId });
  const payload = await buildApplyPayload(ctx, reversal, target, { includeDm: false });
  if (!payload) return;
  await ctx.db
    .update(modCases)
    .set({ discordSync: 'pending', discordError: null, updatedAt: ctx.clock.now() })
    .where(eq(modCases.id, reversal.id));
  await enqueueDiscordJob(ctx, moderationApplyContract, payload, {
    dedupeKey: `${applyDedupeKey(reversal.id)}:heal:${record.id}`,
  });
}
