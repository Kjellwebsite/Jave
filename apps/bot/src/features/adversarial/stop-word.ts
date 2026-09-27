import { adversarial, createContext, systemActor } from '@jave/core';
import type { IncomingMessage } from '../../gateway-events/types';
import type { BotServices } from '../../runtime';

/** "RED FLAG", "red flag", "red-flag", "RED_FLAG" — the words, in order, as whole words. */
const STOP_WORD_PATTERN = new RegExp(
  `\\b${adversarial.STOP_WORD.split(/\s+/).join('[\\s_-]*')}\\b`,
  'i',
);

export function mentionsStopWord(content: string): boolean {
  return STOP_WORD_PATTERN.test(content);
}

/**
 * The stop-word protocol, wired to the gateway. Core (`stopWordTyped`)
 * decides by who typed it: the operative anywhere in the server, or
 * adversarial staff in the team channel, stop the exercise at once (recorded
 * as raised by them); a participant's use of the words — they are never told
 * the stop word — alerts managers instead. Nothing is posted in the channel,
 * so a message never reveals whether the team had an operative.
 */
export async function stopWordListener(
  services: BotServices,
  message: IncomingMessage,
): Promise<void> {
  if (message.author.bot || message.guildId !== services.discord.guildId) return;
  if (!mentionsStopWord(message.content)) return;
  const ctx = createContext({
    db: services.db,
    clock: services.clock,
    cache: services.cache,
    config: services.config,
    logger: services.logger,
    actor: systemActor('adversarial:stop-word'),
  });
  await adversarial.stopWordTyped(ctx, {
    discordUserId: message.author.id,
    channelId: message.isThread ? message.parentChannelId : message.channelId,
  });
  if (ctx.effects.jobIds.length > 0) await services.runJobsNow(ctx.effects.jobIds);
}
