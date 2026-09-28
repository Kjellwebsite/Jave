import { RESTJSONErrorCodes } from 'discord.js';
import { type JobHandler, moderation, PermanentJobError, type ServiceContext } from '@jave/core';
import { DiscordActionError, type MessagePayload } from '../../discord/gateway';
import type { BotServices } from '../../runtime';
import { panel } from '../../ui/components';
import { screenRoleAdds } from '../core/role-screen';
import { userText } from '../../ui/format';
import { BRAND, COLORS, GLYPH } from '../../ui/theme';

type ApplyPayload = moderation.ModerationApplyPayload;

/** Discord outcomes that are facts about the member, not faults to retry or page anyone about. */
const ROUTINE_CODES = new Set<number | string>([
  RESTJSONErrorCodes.UnknownMember,
  RESTJSONErrorCodes.UnknownUser,
]);
const DM_TITLE_MAX = 200;

type Outcome = { status: 'applied' } | { status: 'failed'; error: string; routine: boolean };

/** The DM notice as an embed: first line is the headline, the rest is escaped body text. */
export function noticeEmbed(dmText: string, caseNumber: number): MessagePayload {
  const [headline = '', ...rest] = dmText.split('\n');
  return {
    embeds: [
      panel({
        kicker: BRAND.organization,
        title: userText(headline, DM_TITLE_MAX),
        description: userText(rest.join('\n'), 1800),
        color: COLORS.warning,
        footer: `${moderation.caseReference(caseNumber)} ${GLYPH.dot} Reply to staff through a ticket to appeal.`,
      }),
    ],
  };
}

/**
 * Best-effort notice before a restrictive action. Sent only on the first
 * attempt, so a retried job never DMs twice; failures never block the action.
 */
async function bestEffortDm(
  services: BotServices,
  payload: ApplyPayload,
  firstAttempt: boolean,
  log: ServiceContext['logger'],
): Promise<void> {
  if (!payload.dmText || !firstAttempt) return;
  try {
    await services.gateway.sendDirectMessage(
      payload.targetDiscordId,
      noticeEmbed(payload.dmText, payload.caseNumber),
    );
  } catch (error) {
    log.warn({ err: error, caseId: payload.caseId }, 'moderation notice DM failed');
  }
}

async function applyQuarantine(services: BotServices, payload: ApplyPayload): Promise<Outcome> {
  const { gateway } = services;
  if (payload.quarantineFallback === 'timeout') {
    if (!payload.timeoutUntil) throw new PermanentJobError('quarantine fallback without an end');
    await gateway.timeout(
      payload.targetDiscordId,
      new Date(payload.timeoutUntil),
      payload.auditReason,
    );
    return { status: 'applied' };
  }
  if (!payload.quarantineRoleId) throw new PermanentJobError('quarantine without a role');
  const member = await gateway.fetchMember(payload.targetDiscordId);
  if (!member) return { status: 'failed', error: 'Member is not in the server.', routine: true };
  const strip = (payload.managedRoleIds ?? []).filter(
    (id) => id !== payload.quarantineRoleId && member.roleIds.includes(id),
  );
  if (strip.length > 0)
    await gateway.removeRoles(payload.targetDiscordId, strip, payload.auditReason);
  if (member.roleIds.includes(payload.quarantineRoleId)) return { status: 'applied' };
  const withheld = await quarantineRoleWithheld(services, payload.quarantineRoleId);
  if (withheld) return { status: 'failed', error: withheld, routine: false };
  await gateway.addRoles(payload.targetDiscordId, [payload.quarantineRoleId], payload.auditReason);
  return { status: 'applied' };
}

/**
 * The quarantine role goes to people JAVE restricts, so it must be a plain
 * role: the same last check as role sync, with no staff entitlement (the
 * setting can come from the dashboard, which cannot inspect Discord roles).
 */
async function quarantineRoleWithheld(
  services: BotServices,
  roleId: string,
): Promise<string | null> {
  const [roles, bot] = await Promise.all([
    services.gateway.listRoles(),
    services.gateway.botMember(),
  ]);
  const screen = screenRoleAdds([roleId], {
    desired: [],
    mapping: {},
    roles,
    botHighestRolePosition: bot.highestRolePosition,
  });
  const [withheld] = screen.withheld;
  if (!withheld) return null;
  return withheld.reason === 'hierarchy'
    ? 'The quarantine role is at or above JAVE’s highest role; Discord refuses it.'
    : `The quarantine role is not a plain role (${withheld.reason}); JAVE never hands it out. Choose a role without elevated permissions.`;
}

async function applyRelease(services: BotServices, payload: ApplyPayload): Promise<Outcome> {
  const { gateway } = services;
  if (payload.quarantineFallback === 'timeout') {
    await gateway.timeout(payload.targetDiscordId, null, payload.auditReason);
    return { status: 'applied' };
  }
  if (!payload.quarantineRoleId) throw new PermanentJobError('release without a role');
  const member = await gateway.fetchMember(payload.targetDiscordId);
  // Not in the server: nothing restricts them in Discord, which is the released state.
  if (member?.roleIds.includes(payload.quarantineRoleId)) {
    await gateway.removeRoles(
      payload.targetDiscordId,
      [payload.quarantineRoleId],
      payload.auditReason,
    );
  }
  return { status: 'applied' };
}

async function perform(
  services: BotServices,
  payload: ApplyPayload,
  firstAttempt: boolean,
  log: ServiceContext['logger'],
): Promise<Outcome> {
  const { gateway } = services;
  const target = payload.targetDiscordId;
  switch (payload.action) {
    case 'warn': {
      if (!payload.dmText) throw new PermanentJobError('warn without dmText');
      const sent = await gateway.sendDirectMessage(
        target,
        noticeEmbed(payload.dmText, payload.caseNumber),
      );
      return sent
        ? { status: 'applied' }
        : {
            status: 'failed',
            error: 'DMs closed: the warning could not be delivered.',
            routine: true,
          };
    }
    case 'timeout':
      if (!payload.timeoutUntil) throw new PermanentJobError('timeout without timeoutUntil');
      await bestEffortDm(services, payload, firstAttempt, log);
      await gateway.timeout(target, new Date(payload.timeoutUntil), payload.auditReason);
      return { status: 'applied' };
    case 'untimeout':
      await gateway.timeout(target, null, payload.auditReason);
      return { status: 'applied' };
    case 'kick':
      await bestEffortDm(services, payload, firstAttempt, log);
      await gateway.kick(target, payload.auditReason);
      return { status: 'applied' };
    case 'ban':
      await bestEffortDm(services, payload, firstAttempt, log);
      await gateway.ban(target, {
        reason: payload.auditReason,
        deleteMessageSeconds: payload.deleteMessageSeconds ?? 0,
      });
      return { status: 'applied' };
    case 'unban':
      try {
        await gateway.unban(target, payload.auditReason);
      } catch (error) {
        // Already unbanned in Discord: the state JAVE wants.
        if (error instanceof DiscordActionError && error.code === RESTJSONErrorCodes.UnknownBan) {
          return { status: 'applied' };
        }
        throw error;
      }
      return { status: 'applied' };
    case 'quarantine':
      await bestEffortDm(services, payload, firstAttempt, log);
      return applyQuarantine(services, payload);
    case 'release':
      return applyRelease(services, payload);
  }
}

async function report(
  ctx: ServiceContext,
  services: BotServices,
  caseId: string,
  outcome: Outcome,
): Promise<void> {
  await moderation.markCaseSynced(ctx, {
    caseId,
    status: outcome.status,
    ...(outcome.status === 'failed' && { error: outcome.error }),
  });
  // Callbacks may enqueue follow-ups (sync-failure DMs, a healing reversal).
  await services
    .runJobsNow(ctx.effects.jobIds)
    .catch((error: unknown) =>
      ctx.logger.error({ err: error }, 'moderation follow-up jobs failed'),
    );
}

/**
 * `discord.moderation.apply` — apply one case in Discord and report back
 * through `markCaseSynced`. Idempotent: role and timeout operations converge,
 * notices are sent on the first attempt only, and a case that ended while
 * the job waited is skipped (`getCaseForSync`).
 */
export function moderationApplyHandler(services: BotServices): JobHandler {
  return async (ctx, rawPayload, job) => {
    const parsed = moderation.moderationApplyPayloadSchema.safeParse(rawPayload);
    if (!parsed.success) throw new PermanentJobError('invalid discord.moderation.apply payload');
    const payload = parsed.data;
    const sync = await moderation.getCaseForSync(ctx, payload.caseId);
    if (!sync.apply) return { skipped: sync.reason };

    const firstAttempt = job.attempts <= 1;
    const lastAttempt = job.attempts >= job.maxAttempts;
    let outcome: Outcome;
    try {
      outcome = await perform(services, payload, firstAttempt, ctx.logger);
    } catch (error) {
      if (!(error instanceof DiscordActionError)) throw error;
      if (!error.permanent && !lastAttempt) throw error; // transient: retry with backoff
      outcome = {
        status: 'failed',
        error: error.message,
        routine: error.code !== null && ROUTINE_CODES.has(error.code),
      };
    }
    await report(ctx, services, payload.caseId, outcome);
    if (outcome.status === 'failed' && !outcome.routine) {
      // Recorded and staff notified; dead-letter so the misconfiguration shows in queue health.
      throw new PermanentJobError(outcome.error);
    }
    return { action: payload.action, status: outcome.status };
  };
}
