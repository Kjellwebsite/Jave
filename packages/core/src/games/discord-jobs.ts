import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { gameSessions } from '@jave/database';
import { type ServiceContext, withTransaction } from '../kernel/context';
import { ValidationError } from '../kernel/errors';
import { parseInput } from '../kernel/validation';
import { enqueueJob } from '../jobs/queue';
import { requireSystemActor } from '../calendar/guards';
import {
  compareAndSetSession,
  LIVE_SESSION_STATUSES,
  loadPlayers,
  loadSession,
  type SessionRecord,
} from './records';
import { gameChannelUnavailableSchema, markGameMessageSchema } from './schemas';
import { type SessionView, toSessionView } from './views';

/**
 * `discord.games.render` — show the current state of a Discord game session.
 *
 * Enqueued (in the same transaction) after every change to a session whose
 * surface is 'discord': creation, join/leave, start, each accepted move, each
 * timer transition, finish and abandon. One job per version; payload
 * `{ sessionId, version }`.
 *
 * The bot must:
 * 1. Load `getGameRender(ctx, sessionId)`. If `render.session.version > payload.version`,
 *    return `{ skipped: 'superseded' }` — a newer render job is queued.
 * 2. Build one panel from `render.session` (spectator view — never per-player data):
 *    - lobby: game name, host, players `n/max`, buttons `games:join:<id>`, `games:leave:<id>`,
 *      `games:start:<id>` (start is re-authorized by core: host or event staff only);
 *    - trivia `question`: prompt, the four options as buttons
 *      `games:move:<id>:<round>:<choice>`, answered count, closing time as a Discord timestamp;
 *    - trivia `reveal`: the correct option highlighted, the fact line, scoreboard; no buttons;
 *    - reaction `wait`/`go`: a single `games:move:<id>:<round>:tap` button;
 *    - completed/abandoned: final standings (or the end reason); no buttons.
 *    All player/user text through `userText()`; `allowedMentions: { parse: [] }`.
 * 3. If `discordMessageId` is null:
 *    - never post for an ended session (completed/abandoned): return skipped;
 *    - verify the HOST can View Channel and Send Messages in `discordChannelId` — non-Discord
 *      surfaces let a member name any channel id — and that the bot can post there; if not,
 *      call `markGameChannelUnavailable(ctx, { sessionId, reason })` and stop;
 *    - otherwise send the panel and report it with
 *      `markGameMessagePosted(ctx, { sessionId, channelId, messageId })`.
 *    If `discordMessageId` is set, edit that message. A deleted message (Unknown Message) is
 *    re-posted after the same checks and re-reported.
 * 4. Button clicks call `games.joinSession / leaveSession / startSession / submitMove`
 *    as the clicking user (ephemeral replies for errors). The custom id never authorizes;
 *    `submitMove` rejects non-players, closed rounds and duplicates.
 *
 * Discord permissions in the session channel: View Channel, Send Messages, Embed Links,
 * Read Message History (to edit its own message).
 */
export const DISCORD_GAMES_RENDER_JOB = 'discord.games.render';
export const discordGamesRenderPayloadSchema = z.object({
  sessionId: z.uuid(),
  version: z.number().int().min(0),
});
export type DiscordGamesRenderPayload = z.infer<typeof discordGamesRenderPayloadSchema>;

export async function enqueueRender(ctx: ServiceContext, session: SessionRecord): Promise<void> {
  if (session.surface !== 'discord' || !session.discordChannelId) return;
  const payload: DiscordGamesRenderPayload = { sessionId: session.id, version: session.version };
  await enqueueJob(ctx, DISCORD_GAMES_RENDER_JOB, payload, {
    dedupeKey: `${DISCORD_GAMES_RENDER_JOB}:${session.id}:v${session.version}`,
  });
}

export interface GameRender {
  session: SessionView;
  discordChannelId: string | null;
  discordMessageId: string | null;
  /** Player Discord ids in join order, for rendering names as non-pinging mentions. */
  playerDiscordIds: Record<string, string>;
}

/** Everything the bot needs to render a session. System actor only; spectator view. */
export async function getGameRender(ctx: ServiceContext, sessionId: string): Promise<GameRender> {
  requireSystemActor(ctx);
  const session = await loadSession(ctx, parseInput(z.uuid(), sessionId));
  const players = await loadPlayers(ctx, session.id);
  return {
    session: toSessionView(session, players, null),
    discordChannelId: session.discordChannelId,
    discordMessageId: session.discordMessageId,
    playerDiscordIds: Object.fromEntries(players.map((p) => [p.userId, p.discordId])),
  };
}

/** Callback for `discord.games.render`: remember the message the bot posted. */
export async function markGameMessagePosted(
  ctx: ServiceContext,
  input: z.input<typeof markGameMessageSchema>,
): Promise<void> {
  requireSystemActor(ctx);
  const data = parseInput(markGameMessageSchema, input);
  const session = await loadSession(ctx, data.sessionId);
  if (session.discordChannelId !== data.channelId) {
    throw new ValidationError('The message is not in the session channel.');
  }
  await ctx.db
    .update(gameSessions)
    .set({ discordMessageId: data.messageId })
    .where(eq(gameSessions.id, session.id));
}

const CHANNEL_UNAVAILABLE_REASONS = {
  host_cannot_post: 'The host cannot post in that channel.',
  bot_cannot_post: 'JAVE cannot post in that channel.',
} as const;

/**
 * Callback for `discord.games.render`: the session channel failed the bot's
 * checks. Ends the session without enqueueing a render — nothing may be
 * posted there.
 */
export async function markGameChannelUnavailable(
  ctx: ServiceContext,
  input: z.input<typeof gameChannelUnavailableSchema>,
): Promise<{ status: SessionRecord['status'] }> {
  requireSystemActor(ctx);
  const data = parseInput(gameChannelUnavailableSchema, input);
  return withTransaction(ctx, async (tx) => {
    const session = await loadSession(tx, data.sessionId, { lock: true });
    if (!LIVE_SESSION_STATUSES.includes(session.status)) return { status: session.status };
    const ended = await compareAndSetSession(tx, session, {
      status: 'abandoned',
      endedAt: tx.clock.now(),
      endReason: CHANNEL_UNAVAILABLE_REASONS[data.reason],
    });
    return { status: ended?.status ?? session.status };
  });
}
