import { and, eq, inArray, or } from 'drizzle-orm';
import { adversarialRoles, members, trialTeams, users } from '@jave/database';
import { adversarial, createContext, systemActor } from '@jave/core';
import type { IncomingMessage } from '../../gateway-events/types';
import type { BotServices } from '../../runtime';

/**
 * Exercises that are running from the operative's point of view: briefed or
 * active. A planned role is unknown to its operative, and a concluded one is over.
 */
const RUNNING_STATUSES: readonly adversarial.RoleStatus[] = ['briefed', 'active'];

/** Recorded with the RED FLAG; never shown to participants. */
export const STOP_WORD_NOTE = 'Stop word typed in Discord.';

/** "RED FLAG", "red flag", "red-flag", "RED_FLAG" — the words, in order, as whole words. */
const STOP_WORD_PATTERN = new RegExp(
  `\\b${adversarial.STOP_WORD.split(/\s+/).join('[\\s_-]*')}\\b`,
  'i',
);

export function mentionsStopWord(content: string): boolean {
  return STOP_WORD_PATTERN.test(content);
}

/**
 * The stop-word protocol, wired to the gateway: when anyone types RED FLAG
 * in a team channel with a running exercise — or the operative types it
 * anywhere in the server — the exercise stops at once (core `raiseRedFlag`,
 * idempotent). Nothing is posted in the channel, so a message never reveals
 * whether the team had an operative; the operative gets the STOP DM and
 * managers are alerted.
 */
export async function stopWordListener(
  services: BotServices,
  message: IncomingMessage,
): Promise<void> {
  if (message.author.bot || message.guildId !== services.discord.guildId) return;
  if (!mentionsStopWord(message.content)) return;
  const channelId = message.isThread ? message.parentChannelId : message.channelId;
  const ctx = createContext({
    db: services.db,
    clock: services.clock,
    cache: services.cache,
    config: services.config,
    logger: services.logger,
    actor: systemActor('adversarial:stop-word'),
  });
  const running = await ctx.db
    .select({ id: adversarialRoles.id })
    .from(adversarialRoles)
    .innerJoin(members, eq(members.id, adversarialRoles.operativeMemberId))
    .innerJoin(users, eq(users.id, members.userId))
    .leftJoin(trialTeams, eq(trialTeams.id, adversarialRoles.teamId))
    .where(
      and(
        inArray(adversarialRoles.status, [...RUNNING_STATUSES]),
        or(
          eq(users.discordId, message.author.id),
          channelId ? eq(trialTeams.discordChannelId, channelId) : undefined,
        ),
      ),
    );
  for (const role of running) {
    await adversarial.raiseRedFlag(ctx, { roleId: role.id, note: STOP_WORD_NOTE });
  }
  if (ctx.effects.jobIds.length > 0) await services.runJobsNow(ctx.effects.jobIds);
}
