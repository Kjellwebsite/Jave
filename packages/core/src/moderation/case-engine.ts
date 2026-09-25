import { and, eq, inArray, isNull } from 'drizzle-orm';
import {
  members,
  type modCaseEndReason,
  modCases,
  type modSource,
  securityEvents,
  users,
} from '@jave/database';
import { recordAudit } from '../audit/audit.service';
import { publishEvent } from '../events/bus';
import { DISCORD_ROLE_SYNC_JOB } from '../identity/users.service';
import { cancelJob, enqueueJob } from '../jobs/queue';
import { HOUR } from '../kernel/clock';
import { type ServiceContext, withTransaction } from '../kernel/context';
import { sha256Hex } from '../kernel/crypto';
import {
  ConflictError,
  ForbiddenError,
  InvalidStateError,
  isUniqueViolation,
} from '../kernel/errors';
import { redactString, truncate } from '../kernel/redact';
import { notify, notifyCapabilityHolders } from '../notifications/notifications.service';
import type { MemberStanding } from '../permissions/actor';
import { getSettings } from '../settings/settings.service';
import { enqueueAlertRefresh, type SecurityActionKey } from './alerts';
import { MAX_SYNC_ERROR_LENGTH, MAX_TIMEOUT_SECONDS } from './constants';
import { auditReasonFor, caseReference, dmTextFor, type ModAction, noticeFor } from './copy';
import {
  enqueueDiscordJob,
  moderationApplyContract,
  type ModerationApplyPayload,
  SECONDS_PER_DAY,
} from './discord-jobs';
import {
  hierarchyViolation,
  issuerRoles,
  type ModerationTarget,
  overturnViolation,
} from './targets';

export type ModCaseRecord = typeof modCases.$inferSelect;
export type ModSource = (typeof modSource.enumValues)[number];
export type CaseEndReason = (typeof modCaseEndReason.enumValues)[number];
type DiscordSyncState = ModCaseRecord['discordSync'];

/** Actions that stay in force until they end (expiry, lift, supersede, revoke). */
export const LIVE_ACTIONS = ['timeout', 'quarantine', 'ban'] as const;
export type LiveAction = (typeof LIVE_ACTIONS)[number];

/** The reversal that lifts each live action. */
export const REVERSAL_OF: Record<LiveAction, ModAction> = {
  timeout: 'untimeout',
  quarantine: 'release',
  ban: 'unban',
};
const LIFTED_BY: Partial<Record<ModAction, LiveAction>> = {
  untimeout: 'timeout',
  release: 'quarantine',
  unban: 'ban',
};

export function isReversal(action: ModAction): boolean {
  return action in LIFTED_BY;
}

export function isLiveAction(action: ModAction): action is LiveAction {
  return (LIVE_ACTIONS as readonly string[]).includes(action);
}

const SECURITY_ACTION_FOR: Record<ModAction, SecurityActionKey> = {
  warn: 'flagged',
  note: 'flagged',
  timeout: 'timeout',
  untimeout: 'flagged',
  kick: 'kick',
  ban: 'ban',
  unban: 'flagged',
  quarantine: 'quarantine',
  release: 'flagged',
};

export type LiveCases = Record<LiveAction, ModCaseRecord | null>;

/** Live (not yet ended) timeout / quarantine / ban cases for a user. */
export async function loadLiveCases(ctx: ServiceContext, userId: string): Promise<LiveCases> {
  const rows = await ctx.db
    .select()
    .from(modCases)
    .where(
      and(
        eq(modCases.targetUserId, userId),
        isNull(modCases.endedAt),
        inArray(modCases.action, [...LIVE_ACTIONS]),
      ),
    );
  const find = (action: LiveAction) => rows.find((row) => row.action === action) ?? null;
  return { timeout: find('timeout'), quarantine: find('quarantine'), ban: find('ban') };
}

/** A live timeout is in force until its expiry (Discord lifts it on its own). */
export function timeoutInForce(record: ModCaseRecord | null, now: Date): boolean {
  return Boolean(record?.expiresAt && record.expiresAt.getTime() > now.getTime());
}

/** The live case a reversal action would lift, if any. */
export function caseLiftedBy(action: ModAction, live: LiveCases, now: Date): ModCaseRecord | null {
  const lifted = LIFTED_BY[action];
  if (!lifted) return null;
  const record = live[lifted];
  if (lifted === 'timeout' && !timeoutInForce(record, now)) return null;
  return record;
}

async function endCase(
  ctx: ServiceContext,
  record: ModCaseRecord,
  reason: CaseEndReason,
  now: Date,
): Promise<void> {
  const rows = await ctx.db
    .update(modCases)
    .set({ endedAt: now, endedReason: reason })
    .where(and(eq(modCases.id, record.id), isNull(modCases.endedAt)))
    .returning({ id: modCases.id });
  if (rows.length === 0) {
    throw new ConflictError('This case changed while you were acting on it. Refresh and retry.');
  }
  // A still-queued apply for this case must not run after it ended (e.g. a
  // retried ban landing after the unban). Running jobs re-check via getCaseForSync.
  await cancelJob(ctx, applyDedupeKey(record.id));
}

/** Dedupe key of a case's discord.moderation.apply job. */
export function applyDedupeKey(caseId: string): string {
  return `mod-case:${caseId}`;
}

/** Live cases this action ends by superseding them (not reversals). */
export function casesSupersededBy(action: ModAction, live: LiveCases, now: Date): ModCaseRecord[] {
  switch (action) {
    case 'timeout':
      return live.timeout && timeoutInForce(live.timeout, now) ? [live.timeout] : [];
    case 'ban':
      return [live.quarantine, timeoutInForce(live.timeout, now) ? live.timeout : null].filter(
        (record): record is ModCaseRecord => record !== null,
      );
    default:
      return [];
  }
}

/**
 * Superseding a case ends it just like lifting it does, so the overturn rule
 * applies: staff cannot end a decision issued by someone who outranks them —
 * not by reversing it, and not by replacing it with a shorter timeout or a
 * ban they can later lift themselves. Returns a denial message or null.
 */
export async function supersedeViolation(
  ctx: ServiceContext,
  superseded: readonly ModCaseRecord[],
): Promise<{ message: string; caseId: string } | null> {
  for (const record of superseded) {
    const violation = overturnViolation(ctx.actor, await issuerRoles(ctx, record.moderatorUserId));
    if (violation) {
      return {
        message: 'A decision by higher-ranked staff is in force. Ask them to change it.',
        caseId: record.id,
      };
    }
  }
  return null;
}

export interface CaseSpec {
  action: ModAction;
  target: ModerationTarget;
  reason: string;
  source: ModSource;
  durationSeconds?: number | null;
  deleteMessageDays?: number | null;
  securityEventId?: string | null;
  /** Reversals: how the lifted case ended (default 'lifted'). */
  endReason?: CaseEndReason;
}

interface SyncPlan {
  state: DiscordSyncState;
  error: string | null;
}

function planDiscordSync(action: ModAction, target: ModerationTarget): SyncPlan {
  switch (action) {
    case 'note':
      return { state: 'not_required', error: null };
    case 'ban':
    case 'unban':
      return { state: 'pending', error: null };
    case 'quarantine':
    case 'release':
      // Without a quarantine role the bot falls back to a Discord timeout
      // (see buildApplyPayload), so the member is still restricted in Discord.
      return { state: target.inGuild ? 'pending' : 'not_required', error: null };
    default:
      return { state: target.inGuild ? 'pending' : 'not_required', error: null };
  }
}

/** Validate state and end the cases this action supersedes or lifts. Returns the lifted case id. */
async function settleLiveCases(
  ctx: ServiceContext,
  spec: CaseSpec,
  now: Date,
): Promise<string | null> {
  const live = await loadLiveCases(ctx, spec.target.userId);
  // Re-checked here, under the target lock: callers authorized against a
  // snapshot, and a higher-ranked case may have landed since.
  const blocked = await supersedeViolation(ctx, casesSupersededBy(spec.action, live, now));
  if (blocked) throw new ForbiddenError(blocked.message);
  switch (spec.action) {
    case 'timeout':
      if (!spec.target.inGuild) throw new InvalidStateError('Member is not in the server.');
      if (live.ban) throw new InvalidStateError('Member is banned.');
      if (live.timeout) {
        await endCase(
          ctx,
          live.timeout,
          timeoutInForce(live.timeout, now) ? 'superseded' : 'expired',
          now,
        );
      }
      return null;
    case 'kick':
      if (!spec.target.inGuild) throw new InvalidStateError('Member is not in the server.');
      return null;
    case 'quarantine':
      if (live.ban) throw new InvalidStateError('Member is banned.');
      if (live.quarantine) throw new InvalidStateError('Member is already quarantined.');
      return null;
    case 'ban':
      if (live.ban) throw new ConflictError('Member is already banned.');
      if (live.quarantine) await endCase(ctx, live.quarantine, 'superseded', now);
      if (live.timeout) await endCase(ctx, live.timeout, 'superseded', now);
      return null;
    case 'untimeout':
    case 'release':
    case 'unban': {
      const lifted = caseLiftedBy(spec.action, live, now);
      if (!lifted) {
        if (spec.action === 'unban' && spec.target.standing === 'banned') return null;
        const state = { untimeout: 'timed out', release: 'quarantined', unban: 'banned' }[
          spec.action
        ];
        throw new InvalidStateError(`Member is not ${state}.`);
      }
      await endCase(ctx, lifted, spec.endReason ?? 'lifted', now);
      return lifted.id;
    }
    case 'warn':
    case 'note':
      return null;
  }
}

/** Standing transitions owned by moderation. Other standings are left untouched. */
const STANDING_TRANSITIONS: Partial<
  Record<ModAction, { to: MemberStanding; from: MemberStanding[] }>
> = {
  quarantine: { to: 'quarantined', from: ['good', 'restricted'] },
  release: { to: 'good', from: ['quarantined'] },
  ban: { to: 'banned', from: ['good', 'restricted', 'quarantined'] },
  unban: { to: 'good', from: ['banned'] },
};

async function updateStanding(ctx: ServiceContext, spec: CaseSpec): Promise<void> {
  const transition = STANDING_TRANSITIONS[spec.action];
  if (!transition || !spec.target.memberId) return;
  await ctx.db
    .update(members)
    .set({ standing: transition.to })
    .where(and(eq(members.id, spec.target.memberId), inArray(members.standing, transition.from)));
}

/** Build the discord.moderation.apply payload for a case. */
export async function buildApplyPayload(
  ctx: ServiceContext,
  record: ModCaseRecord,
  target: ModerationTarget,
  options: { includeDm: boolean },
): Promise<ModerationApplyPayload | null> {
  if (record.action === 'note') return null;
  const [roles, branding] = await Promise.all([
    getSettings(ctx, 'roles'),
    getSettings(ctx, 'branding'),
  ]);
  const notice = noticeFor({
    action: record.action,
    reason: record.reason,
    organizationName: branding.organizationName,
    durationSeconds: record.durationSeconds,
    expiresAt: record.expiresAt,
  });
  const dmActions: readonly ModAction[] = ['warn', 'timeout', 'kick', 'ban', 'quarantine'];
  return {
    caseId: record.id,
    caseNumber: record.number,
    action: record.action,
    targetDiscordId: target.discordId,
    auditReason: auditReasonFor(record.number, record.reason),
    ...(record.action === 'timeout' &&
      record.expiresAt && { timeoutUntil: record.expiresAt.toISOString() }),
    ...(record.action === 'ban' && {
      deleteMessageSeconds: (record.deleteMessageDays ?? 0) * SECONDS_PER_DAY,
    }),
    ...((record.action === 'quarantine' || record.action === 'release') &&
      roles.quarantineRoleId && { quarantineRoleId: roles.quarantineRoleId }),
    // No quarantine role configured: quarantine is enforced as a Discord
    // timeout (capped at Discord's 28-day limit) and release lifts it.
    ...(record.action === 'quarantine' &&
      !roles.quarantineRoleId && {
        quarantineFallback: 'timeout' as const,
        timeoutUntil: quarantineFallbackUntil(record, ctx.clock.now()).toISOString(),
      }),
    ...(record.action === 'release' &&
      !roles.quarantineRoleId && { quarantineFallback: 'timeout' as const }),
    ...(record.action === 'quarantine' && {
      managedRoleIds: [
        ...new Set(Object.values(roles.discordRoleIds).filter((id): id is string => Boolean(id))),
      ],
    }),
    ...(options.includeDm &&
      notice &&
      dmActions.includes(record.action) && {
        dmText: dmTextFor(notice, branding.organizationName),
      }),
  };
}

/** When a timeout standing in for a quarantine ends: the quarantine's expiry, at most 28 days out. */
export function quarantineFallbackUntil(record: ModCaseRecord, now: Date): Date {
  const cap = now.getTime() + MAX_TIMEOUT_SECONDS * 1000;
  return new Date(Math.min(record.expiresAt?.getTime() ?? cap, cap));
}

/** One aggregated alert per failure cause per hour for automated cases. */
export const SYNC_FAILURE_ALERT_WINDOW_MS = HOUR;

/**
 * Tell the issuing moderator that Discord sync failed. Automated cases have no
 * issuer: all moderators get ONE alert per failure cause per hour, so a raid
 * with a misconfiguration does not bury staff in per-case DMs.
 */
export async function notifySyncFailure(
  ctx: ServiceContext,
  record: ModCaseRecord,
  error: string,
): Promise<void> {
  const input = {
    type: 'moderation.sync_failed' as const,
    title: `DISCORD SYNC FAILED — ${caseReference(record.number)}`,
    body: `${record.action.toUpperCase()} could not be applied in Discord: ${error}`,
    dedupeKey: `mod-case:${record.id}:sync-failed:${record.updatedAt.getTime()}`,
    data: { caseId: record.id, caseNumber: record.number },
  };
  if (record.moderatorUserId) {
    await notify(ctx, { ...input, recipientUserId: record.moderatorUserId });
    return;
  }
  const cause = sha256Hex(`${record.action}:${error}`).slice(0, 16);
  const window = Math.floor(ctx.clock.now().getTime() / SYNC_FAILURE_ALERT_WINDOW_MS);
  await notifyCapabilityHolders(ctx, 'canModerate', {
    ...input,
    title: 'DISCORD SYNC FAILED — AUTOMOD',
    body: `${record.action.toUpperCase()} could not be applied in Discord: ${error}\nFirst seen on ${caseReference(record.number)}. Further failures with this cause in the next hour are not re-sent.`,
    dedupeKey: `mod-sync-failed:${cause}:${window}`,
  });
}

export function cleanSyncError(error: string): string {
  return truncate(redactString(error), MAX_SYNC_ERROR_LENGTH);
}

/**
 * Serialize moderation writes for one user: every transaction that changes a
 * user's cases takes this row lock first, so concurrent actions (ban vs
 * quarantine, sweep vs manual release) see each other's live cases.
 */
export async function lockTarget(ctx: ServiceContext, userId: string): Promise<void> {
  await ctx.db.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
}

/**
 * Record a moderation case and everything that must commit with it: live-case
 * bookkeeping, member standing, audit, domain event, Discord job, the
 * target's notice and the security-event link.
 *
 * Callers authorize (capability + hierarchy) before calling. Automated actors
 * are re-checked here as a last line of defense: they never take punitive
 * action against staff. Runs in its own transaction, or as a savepoint inside
 * the caller's.
 */
export async function executeCase(ctx: ServiceContext, spec: CaseSpec): Promise<ModCaseRecord> {
  if (ctx.actor.kind !== 'user') {
    const violation = hierarchyViolation(ctx.actor, spec.target, spec.action);
    if (violation) {
      // Reaching this is a caller bug, not a user attempt. Callers may hold a
      // transaction, so no durable audit write here (it could not commit anyway).
      ctx.logger.error(
        { action: spec.action, targetUserId: spec.target.userId },
        'automated moderation blocked by hierarchy',
      );
      throw new ForbiddenError(violation);
    }
  }
  return withTransaction(ctx, async (tx) => {
    await lockTarget(tx, spec.target.userId);
    const now = tx.clock.now();
    const revertsCaseId = await settleLiveCases(tx, spec, now);
    const sync = planDiscordSync(spec.action, spec.target);
    const expiresAt = spec.durationSeconds
      ? new Date(now.getTime() + spec.durationSeconds * 1000)
      : null;

    let record: ModCaseRecord;
    try {
      const [row] = await tx.db
        .insert(modCases)
        .values({
          action: spec.action,
          targetUserId: spec.target.userId,
          moderatorUserId: tx.actor.kind === 'user' ? tx.actor.userId : null,
          reason: spec.reason,
          durationSeconds: spec.durationSeconds ?? null,
          expiresAt,
          deleteMessageDays: spec.action === 'ban' ? (spec.deleteMessageDays ?? 0) : null,
          source: spec.source,
          securityEventId: spec.securityEventId ?? null,
          revertsCaseId,
          discordSync: sync.state,
          discordError: sync.error,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      record = row!;
    } catch (error) {
      if (isUniqueViolation(error, 'mod_cases_live_uq')) {
        throw new ConflictError('Another moderator acted on this member at the same time.');
      }
      throw error;
    }

    await updateStanding(tx, spec);
    const reference = caseReference(record.number);
    await recordAudit(tx, {
      action: 'moderation.case_created',
      targetType: 'user',
      targetId: spec.target.userId,
      context: {
        caseId: record.id,
        case: reference,
        action: record.action,
        source: record.source,
        reason: record.reason,
        durationSeconds: record.durationSeconds,
        deleteMessageDays: record.deleteMessageDays,
        securityEventId: record.securityEventId,
        revertsCaseId,
      },
    });
    await publishEvent(tx, {
      type: 'moderation.case_created',
      aggregateType: 'mod_case',
      aggregateId: record.id,
      subjectMemberId: spec.target.memberId,
      payload: {
        caseId: record.id,
        number: record.number,
        action: record.action,
        source: record.source,
        targetUserId: spec.target.userId,
        durationSeconds: record.durationSeconds,
        expiresAt: record.expiresAt?.toISOString() ?? null,
        securityEventId: record.securityEventId,
        revertsCaseId,
      },
    });

    if (sync.state === 'pending') {
      const payload = await buildApplyPayload(tx, record, spec.target, { includeDm: true });
      if (payload) {
        await enqueueDiscordJob(tx, moderationApplyContract, payload, {
          dedupeKey: applyDedupeKey(record.id),
        });
      }
    } else if (sync.state === 'failed' && sync.error) {
      await notifySyncFailure(tx, record, sync.error);
    }
    if (spec.action === 'release' && spec.target.memberId && spec.target.inGuild) {
      await enqueueJob(
        tx,
        DISCORD_ROLE_SYNC_JOB,
        { memberId: spec.target.memberId },
        { dedupeKey: `roles-sync:${spec.target.memberId}` },
      );
    }

    const branding = await getSettings(tx, 'branding');
    const notice = noticeFor({
      action: record.action,
      reason: record.reason,
      organizationName: branding.organizationName,
      durationSeconds: record.durationSeconds,
      expiresAt: record.expiresAt,
    });
    if (notice) {
      await notify(tx, {
        recipientUserId: spec.target.userId,
        type: 'moderation.notice',
        title: notice.title,
        body: notice.body,
        dedupeKey: `mod-case:${record.id}:notice`,
        data: { caseId: record.id, caseNumber: record.number, action: record.action },
      });
    }

    if (spec.securityEventId && tx.actor.kind === 'user') {
      const [event] = await tx.db
        .update(securityEvents)
        .set({
          status: 'actioned',
          actionTaken: SECURITY_ACTION_FOR[spec.action],
          reviewedByUserId: tx.actor.userId,
          reviewedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(securityEvents.id, spec.securityEventId),
            inArray(securityEvents.status, ['open', 'acknowledged']),
          ),
        )
        .returning();
      if (event) await enqueueAlertRefresh(tx, event);
    }
    return record;
  });
}

/** Re-send a live case to Discord (e.g. a quarantined or banned member rejoined). */
export async function reapplyCase(
  ctx: ServiceContext,
  record: ModCaseRecord,
  target: ModerationTarget,
): Promise<boolean> {
  const payload = await buildApplyPayload(ctx, record, target, { includeDm: false });
  if (!payload) return false;
  await ctx.db
    .update(modCases)
    .set({ discordSync: 'pending', discordError: null, updatedAt: ctx.clock.now() })
    .where(eq(modCases.id, record.id));
  const jobId = await enqueueDiscordJob(ctx, moderationApplyContract, payload, {
    dedupeKey: applyDedupeKey(record.id),
  });
  return jobId !== null;
}
