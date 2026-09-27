import { RESTJSONErrorCodes } from 'discord.js';
import { eq } from 'drizzle-orm';
import { users } from '@jave/database';
import {
  enqueueJob,
  games,
  type JobHandler,
  type JobHandlerMap,
  PermanentJobError,
  type ServiceContext,
} from '@jave/core';
import { isDiscordError, jobFailure, UNKNOWN_OBJECT } from '../../discord/discord-errors';
import type { ChannelAccess, DiscordGateway, MessagePayload } from '../../discord/gateway';
import { KeyedLock } from '../../discord/keyed-lock';
import type { BotServices } from '../../runtime';
import { RENDER_REASON } from './constants';
import { gamePanel } from './render';

type Render = games.GameRender;

/** Dedupe-key suffix of renders queued by the bot itself (not by a state change). */
const REPOST_KEY = 'repost';
type ChannelVerdict = 'host_cannot_post' | 'bot_cannot_post';

/** Discord errors that mean the bot lost the right to post in the channel. */
const LOST_ACCESS_CODES = [
  RESTJSONErrorCodes.MissingAccess,
  RESTJSONErrorCodes.MissingPermissions,
  RESTJSONErrorCodes.UnknownChannel,
];

const ended = (render: Render) =>
  render.session.status === 'completed' || render.session.status === 'abandoned';

const lostAccess = (error: unknown) =>
  LOST_ACCESS_CODES.some((code) => isDiscordError(error, code));

/** The host's Discord id: from the players, or the user row when the host only runs the game. */
async function hostDiscordId(ctx: ServiceContext, render: Render): Promise<string | null> {
  const hostUserId = render.session.hostUserId;
  const fromPlayers = render.playerDiscordIds[hostUserId];
  if (fromPlayers) return fromPlayers;
  const [row] = await ctx.db
    .select({ discordId: users.discordId })
    .from(users)
    .where(eq(users.id, hostUserId));
  return row?.discordId ?? null;
}

/** The bot can post a panel here: a text channel it can see, send in and embed in. */
export const botCanPost = (access: ChannelAccess | null): boolean =>
  access !== null && access.textBased && access.view && access.send && access.embedLinks;

/**
 * Before anything is posted: the HOST must be able to see and post in the
 * channel (a session's channel id can come from any surface that calls core),
 * and so must the bot. The host is checked first, so a refusal never reveals
 * which channels the bot can see.
 */
async function channelVerdict(
  ctx: ServiceContext,
  gateway: DiscordGateway,
  render: Render,
  channelId: string,
): Promise<ChannelVerdict | null> {
  const discordId = await hostDiscordId(ctx, render);
  const host = discordId
    ? await gateway.channelAccess(channelId, { kind: 'member', userId: discordId })
    : null;
  if (!host || !host.view || !host.send) return 'host_cannot_post';
  if (!botCanPost(await gateway.channelAccess(channelId, { kind: 'bot' }))) {
    return 'bot_cannot_post';
  }
  return null;
}

async function rejectChannel(ctx: ServiceContext, render: Render, reason: ChannelVerdict) {
  const { status } = await games.markGameChannelUnavailable(ctx, {
    sessionId: render.session.id,
    reason,
  });
  return { rejected: reason, status };
}

async function deleteDuplicate(gateway: DiscordGateway, channelId: string, messageId: string) {
  try {
    await gateway.deleteMessage(channelId, messageId, RENDER_REASON);
  } catch (error) {
    if (!isDiscordError(error, UNKNOWN_OBJECT.message)) throw error;
  }
}

/** Post a new panel (first render, or the old one was deleted) and report it to core. */
async function postPanel(
  ctx: ServiceContext,
  gateway: DiscordGateway,
  render: Render,
  channelId: string,
  message: MessagePayload,
) {
  const verdict = await channelVerdict(ctx, gateway, render, channelId);
  if (verdict) return rejectChannel(ctx, render, verdict);
  let sent;
  try {
    sent = await gateway.sendMessage(channelId, message);
  } catch (error) {
    if (lostAccess(error)) return rejectChannel(ctx, render, 'bot_cannot_post');
    throw jobFailure(error);
  }
  const result = await games.markGameMessagePosted(ctx, {
    sessionId: render.session.id,
    channelId,
    messageId: sent.messageId,
    replacesMessageId: render.discordMessageId,
  });
  if (result.discard) {
    // Another run stored its panel first: keep one live panel, with this content.
    await deleteDuplicate(gateway, channelId, result.discard);
    if (result.messageId) await gateway.editMessage(channelId, result.messageId, message);
    return { posted: null, kept: result.messageId };
  }
  return { posted: sent.messageId };
}

function renderHandler(services: BotServices, lock: KeyedLock): JobHandler {
  return async (ctx, payload) => {
    const parsed = games.discordGamesRenderPayloadSchema.safeParse(payload);
    if (!parsed.success) throw new PermanentJobError('invalid discord.games.render payload');
    const { sessionId, version } = parsed.data;
    const run = lock.run(sessionId, async () => {
      const render = await games.getGameRender(ctx, sessionId);
      if (render.session.version > version) return { skipped: 'superseded' };
      const channelId = render.discordChannelId;
      if (!channelId) return { skipped: 'not a Discord session' };
      const message = gamePanel(render);
      const { gateway } = services;
      if (render.discordMessageId) {
        try {
          await gateway.editMessage(channelId, render.discordMessageId, message);
          return { edited: render.discordMessageId, version: render.session.version };
        } catch (error) {
          if (!isDiscordError(error, UNKNOWN_OBJECT.message)) {
            if (lostAccess(error) && !ended(render)) {
              return rejectChannel(ctx, render, 'bot_cannot_post');
            }
            throw jobFailure(error);
          }
        }
      }
      // Never post for a session that already ended: there is nothing left to play.
      if (ended(render)) return { skipped: 'ended' };
      return postPanel(ctx, gateway, render, channelId, message);
    });
    // Permanent Discord failures (missing permission, unknown channel) dead-letter at once.
    return run.catch((error: unknown) => {
      throw jobFailure(error);
    });
  };
}

/** discord.games.render, serialized per session in this process. */
export function gameJobHandlers(services: BotServices): JobHandlerMap {
  const lock = new KeyedLock();
  return { [games.DISCORD_GAMES_RENDER_JOB]: renderHandler(services, lock) };
}

/**
 * Queue a fresh render of a session's current state (after its panel was
 * deleted, for example). Re-syncs from the database, so a render that is
 * already running runs once more instead of this one being dropped.
 */
export async function enqueueRerender(
  ctx: ServiceContext,
  session: { id: string; version: number },
): Promise<number | null> {
  const payload: games.DiscordGamesRenderPayload = {
    sessionId: session.id,
    version: session.version,
  };
  return enqueueJob(ctx, games.DISCORD_GAMES_RENDER_JOB, payload, {
    dedupeKey: `${games.DISCORD_GAMES_RENDER_JOB}:${session.id}:${REPOST_KEY}`,
    rerunIfRunning: true,
  });
}
