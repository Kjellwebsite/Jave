import { and, desc, eq, gt, ne } from 'drizzle-orm';
import { z } from 'zod';
import { guildMemberEvents } from '@jave/database';
import { recordAudit } from '../audit/audit.service';
import { publishEvent } from '../events/bus';
import { syncDiscordUser } from '../identity/users.service';
import { DAY } from '../kernel/clock';
import { type ServiceContext, withActor, withTransaction } from '../kernel/context';
import { ConflictError, InvalidStateError } from '../kernel/errors';
import { snowflakeToDate } from '../kernel/ids';
import { parseInput } from '../kernel/validation';
import { notifyCapabilityHolders } from '../notifications/notifications.service';
import { systemActor } from '../permissions/actor';
import { authorize } from '../permissions/authorize';
import { getSettings, updateSettings } from '../settings/settings.service';
import { executeCase, loadLiveCases, lockTarget, reapplyCase } from './case-engine';
import {
  ALERT_RECIPIENT_LIMIT,
  DISCORD_AUDIT_REASON_MAX,
  MAX_REASON_LENGTH,
  MIN_REASON_LENGTH,
} from './constants';
import { securityReference } from './copy';
import { enqueueDiscordJob, moderationLockdownContract } from './discord-jobs';
import { evaluateJoin, type JoinEvaluation } from './engine/join';
import { buildEvidence, createSecurityEvent, discordProfileSchema } from './security.service';
import { holdsStaffRole, loadTarget, requireSystemActor } from './targets';

const MS_PER_SECOND = 1000;

export const setRaidModeSchema = z.object({
  enabled: z.boolean(),
  reason: z.string().trim().min(MIN_REASON_LENGTH, 'Give a reason').max(MAX_REASON_LENGTH),
});

export interface RaidModeResult {
  raidMode: boolean;
  changed: boolean;
}

async function applyRaidMode(
  tx: ServiceContext,
  enabled: boolean,
  reason: string,
  automatic: boolean,
): Promise<void> {
  const label = tx.actor.kind === 'user' ? `user:${tx.actor.userId}` : 'automatic';
  // Settings writes need canManageSettings; raid mode is authorized by canManageSecurity
  // (checked by the caller), so the write itself runs as an internal process.
  await updateSettings(withActor(tx, systemActor(`raid-mode:${label}`)), 'security', {
    raidMode: enabled,
  });
  await recordAudit(tx, {
    action: 'security.raid_mode_changed',
    targetType: 'settings',
    targetId: 'security',
    context: { enabled, reason, automatic },
  });
  await publishEvent(tx, {
    type: 'security.raid_mode_changed',
    aggregateType: 'settings',
    aggregateId: 'security',
    payload: { enabled, automatic },
  });
  const channels = await getSettings(tx, 'channels');
  const noticeChannelId = channels.securityAlerts ?? channels.staffAlerts;
  await enqueueDiscordJob(
    tx,
    moderationLockdownContract,
    {
      enabled,
      reason: reason.slice(0, DISCORD_AUDIT_REASON_MAX),
      ...(noticeChannelId && { noticeChannelId }),
    },
    { dedupeKey: `raid-lockdown:${enabled}` },
  );
  await notifyCapabilityHolders(
    tx,
    'canViewSecurityEvents',
    {
      type: 'security.alert',
      title: enabled ? 'RAID MODE — ON' : 'RAID MODE — OFF',
      body: enabled
        ? `${automatic ? 'Join burst detected. ' : ''}New joins are quarantined until raid mode is switched off.`
        : 'New joins are no longer held.',
      severity: enabled ? 'critical' : 'notice',
      dedupeKey: `raid-mode:${enabled}:${tx.clock.now().getTime()}`,
      data: { raidMode: enabled, automatic },
    },
    {
      limit: ALERT_RECIPIENT_LIMIT,
      excludeUserIds: tx.actor.kind === 'user' ? [tx.actor.userId] : [],
    },
  );
}

/** Switch raid mode on or off (canManageSecurity). Audited; staff are alerted. */
export async function setRaidMode(
  ctx: ServiceContext,
  input: z.input<typeof setRaidModeSchema>,
): Promise<RaidModeResult> {
  const data = parseInput(setRaidModeSchema, input);
  await authorize(ctx, 'canManageSecurity', { type: 'settings', id: 'security' });
  const current = await getSettings(ctx, 'security');
  if (current.raidMode === data.enabled) return { raidMode: data.enabled, changed: false };
  await withTransaction(ctx, (tx) => applyRaidMode(tx, data.enabled, data.reason, false));
  return { raidMode: data.enabled, changed: true };
}

export const screenJoinSchema = z.object({ discordUser: discordProfileSchema });

export interface ScreenJoinResult {
  evaluation: JoinEvaluation;
  securityEventId: string | null;
  /** Quarantine case opened for this join (raid hold or suspicious account). */
  caseId: string | null;
  /** Raid mode was switched on automatically by this join. */
  raidModeEnabled: boolean;
  /** An existing quarantine or ban was re-sent to Discord (rejoin). */
  reapplied: 'quarantine' | 'ban' | null;
}

/**
 * Screen a guild join (system only; the bot calls it on guildMemberAdd).
 * Safe to call before or after identity's recordGuildJoin.
 * - Re-applies a live quarantine or ban when the user rejoins.
 * - Detects join bursts and, when settings.security.autoRaidMode is on,
 *   switches raid mode on and alerts staff.
 * - Records suspicious joins as security events.
 * - While raid mode is on (or for suspicious joins when
 *   quarantineSuspiciousJoins is set) new joins are quarantined. Staff are
 *   never quarantined automatically.
 */
export async function screenJoin(
  ctx: ServiceContext,
  input: z.input<typeof screenJoinSchema>,
): Promise<ScreenJoinResult> {
  const data = parseInput(screenJoinSchema, input);
  await requireSystemActor(ctx, { type: 'join_screening', id: null });
  const { user } = await syncDiscordUser(ctx, data.discordUser, { inGuild: true });
  const settings = await getSettings(ctx, 'security');
  const now = ctx.clock.now();
  const cutoff = new Date(now.getTime() - settings.joinBurstWindowSeconds * MS_PER_SECOND);
  const otherJoins = await ctx.db
    .select({ at: guildMemberEvents.occurredAt })
    .from(guildMemberEvents)
    .where(
      and(
        eq(guildMemberEvents.type, 'join'),
        gt(guildMemberEvents.occurredAt, cutoff),
        ne(guildMemberEvents.userId, user.id),
      ),
    )
    .orderBy(desc(guildMemberEvents.occurredAt))
    .limit(settings.joinBurstCount);
  const evaluation = evaluateJoin({
    accountAgeDays: (now.getTime() - snowflakeToDate(user.discordId).getTime()) / DAY,
    hasAvatar: Boolean(user.avatarHash),
    username: user.username,
    displayName: user.displayName,
    recentJoins: [...otherJoins.map((row) => row.at), now],
    now,
    settings,
  });
  const target = { ...(await loadTarget(ctx, { userId: user.id })), inGuild: true };
  const staff = holdsStaffRole(target.roles);

  return withTransaction(ctx, async (tx): Promise<ScreenJoinResult> => {
    await lockTarget(tx, user.id);
    const result: ScreenJoinResult = {
      evaluation,
      securityEventId: null,
      caseId: null,
      raidModeEnabled: false,
      reapplied: null,
    };
    const live = await loadLiveCases(tx, user.id);
    if (live.ban && (await reapplyCase(tx, live.ban, target))) result.reapplied = 'ban';
    else if (live.quarantine && (await reapplyCase(tx, live.quarantine, target))) {
      result.reapplied = 'quarantine';
    }
    if (live.ban || live.quarantine) return result;

    let raidActive = settings.raidMode;
    if (evaluation.raidDetected && !raidActive && settings.autoRaidMode) {
      const burstBucket = Math.floor(
        now.getTime() / (settings.joinBurstWindowSeconds * MS_PER_SECOND),
      );
      const { event, created } = await createSecurityEvent(tx, {
        userId: null,
        trigger: 'join_burst',
        riskScore: evaluation.riskScore,
        source: 'join_screening',
        evidence: buildEvidence({
          signals: evaluation.signals.filter((s) => s.key === 'join_burst'),
        }),
        actionTaken: 'lockdown',
        channelId: null,
        reportedByUserId: null,
        dedupeKey: `raid:${burstBucket}`,
        // The critical RAID MODE — ON alert below covers it.
        notifyStaff: false,
      });
      if (created) {
        await applyRaidMode(
          tx,
          true,
          `Join burst detected (${securityReference(event.number)}).`,
          true,
        );
        result.raidModeEnabled = true;
      }
      raidActive = true;
    }

    const hold =
      !staff && (raidActive || (evaluation.suspicious && settings.quarantineSuspiciousJoins));
    if (evaluation.suspicious) {
      const { event } = await createSecurityEvent(tx, {
        userId: user.id,
        trigger: 'suspicious_account',
        riskScore: evaluation.riskScore,
        source: 'join_screening',
        evidence: buildEvidence({ signals: evaluation.signals }),
        actionTaken: hold ? 'quarantine' : 'flagged',
        channelId: null,
        reportedByUserId: null,
        dedupeKey: `join:${user.id}:${now.getTime()}`,
        // During a raid the raid alert covers individual joins.
        notifyStaff: !raidActive,
      });
      result.securityEventId = event.id;
    }
    if (hold) {
      try {
        const record = await executeCase(tx, {
          action: 'quarantine',
          target,
          reason: raidActive
            ? 'Raid mode: new joins are held for review.'
            : 'Suspicious new account held for review.',
          source: result.securityEventId ? 'security_event' : 'system',
          securityEventId: result.securityEventId,
        });
        result.caseId = record.id;
      } catch (error) {
        if (!(error instanceof ConflictError || error instanceof InvalidStateError)) throw error;
      }
    }
    return result;
  });
}
