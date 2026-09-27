import { createContext, games, systemActor } from '@jave/core';
import type { MessageBulkDeletion, MessageDeletion } from '../../gateway-events/types';
import type { BotServices } from '../../runtime';
import { enqueueRerender } from './render-job';

/**
 * A live game's panel was deleted (by a moderator, a purge, or by mistake):
 * post it again right away. Without this a lobby nobody can see would sit
 * until the sweep expires it. Ended sessions are left alone, and so is every
 * other message in the channel.
 */
async function repostIfPanel(
  services: BotServices,
  channelId: string,
  deletedIds: readonly string[],
): Promise<void> {
  const ctx = createContext({
    db: services.db,
    clock: services.clock,
    cache: services.cache,
    config: services.config,
    logger: services.logger,
    actor: systemActor('gateway:game-panel-deleted'),
  });
  const live = await games.findLiveSession(ctx, { discordChannelId: channelId });
  if (!live) return;
  const render = await games.getGameRender(ctx, live.id);
  if (!render.discordMessageId || !deletedIds.includes(render.discordMessageId)) return;
  await enqueueRerender(ctx, render.session);
  await services.runJobsNow(ctx.effects.jobIds);
}

export async function repostDeletedPanel(
  services: BotServices,
  deletion: MessageDeletion,
): Promise<void> {
  if (deletion.guildId !== services.discord.guildId) return;
  await repostIfPanel(services, deletion.channelId, [deletion.id]);
}

export async function repostPurgedPanel(
  services: BotServices,
  deletion: MessageBulkDeletion,
): Promise<void> {
  if (deletion.guildId !== services.discord.guildId) return;
  await repostIfPanel(services, deletion.channelId, deletion.ids);
}
