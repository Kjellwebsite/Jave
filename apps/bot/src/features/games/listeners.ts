import { createContext, games, systemActor } from '@jave/core';
import type { MessageDeletion } from '../../gateway-events/types';
import type { BotServices } from '../../runtime';
import { enqueueRerender } from './render-job';

/**
 * A live game's panel was deleted (by a moderator, or by mistake): post it
 * again right away. Without this a lobby nobody can see would sit until the
 * sweep expires it. Ended sessions are left alone.
 */
export async function repostDeletedPanel(
  services: BotServices,
  deletion: MessageDeletion,
): Promise<void> {
  if (deletion.guildId !== services.discord.guildId) return;
  const ctx = createContext({
    db: services.db,
    clock: services.clock,
    cache: services.cache,
    config: services.config,
    logger: services.logger,
    actor: systemActor('gateway:game-panel-deleted'),
  });
  const live = await games.findLiveSession(ctx, { discordChannelId: deletion.channelId });
  if (!live) return;
  const render = await games.getGameRender(ctx, live.id);
  if (render.discordMessageId !== deletion.id) return;
  await enqueueRerender(ctx, render.session);
  await services.runJobsNow(ctx.effects.jobIds);
}
