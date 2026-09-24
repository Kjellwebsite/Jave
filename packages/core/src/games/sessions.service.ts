import { and, eq, inArray, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { gamePlayers, gameSessions, users } from '@jave/database';
import { type ServiceContext, withTransaction } from '../kernel/context';
import { randomToken } from '../kernel/crypto';
import {
  ConflictError,
  InvalidStateError,
  isUniqueViolation,
  ValidationError,
} from '../kernel/errors';
import { parseInput } from '../kernel/validation';
import { recordAudit } from '../audit/audit.service';
import { actorUserId } from '../permissions/actor';
import { authorize, requireUser } from '../permissions/authorize';
import { requireActiveMember, requireViewer } from '../calendar/guards';
import { MAX_CONFIG_BYTES, MAX_LIVE_SESSIONS_PER_HOST, SESSION_SEED_BYTES } from './constants';
import { enqueueRender } from './discord-jobs';
import { abandonInTx, commitState, jsonByteLength, touchLockedSession } from './lifecycle';
import {
  isPlayer,
  LIVE_SESSION_STATUSES,
  loadPlayers,
  loadSession,
  nextSeat,
  type SessionRecord,
  toJsonObject,
} from './records';
import { createRng } from './rng';
import { getGame, listGames } from './registry';
import {
  abandonSessionSchema,
  createSessionSchema,
  findLiveSessionSchema,
  sessionIdSchema,
} from './schemas';
import type { GameSummary } from './types';
import { buildSessionView, type SessionView } from './views';

/** Games that can be hosted, for pickers on every surface. */
export function availableGames(ctx: ServiceContext): GameSummary[] {
  requireViewer(ctx);
  return listGames();
}

/** Counts the host's live sessions under a lock on the host's user row (serializes creates). */
async function liveSessionsHostedBy(tx: ServiceContext, userId: string): Promise<number> {
  await tx.db.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
  const [row] = await tx.db
    .select({ total: sql<number>`count(*)::int` })
    .from(gameSessions)
    .where(
      and(
        eq(gameSessions.hostUserId, userId),
        inArray(gameSessions.status, [...LIVE_SESSION_STATUSES]),
      ),
    );
  return row?.total ?? 0;
}

/**
 * Open a lobby. The game's own config schema validates `config`; one live
 * session per Discord channel / Activity instance (partial unique indexes).
 */
export async function createSession(
  ctx: ServiceContext,
  input: z.input<typeof createSessionSchema>,
): Promise<SessionView> {
  const data = parseInput(createSessionSchema, input);
  await authorize(ctx, 'canHostGames', { type: 'game_session' });
  const host = requireActiveMember(ctx);
  const game = getGame(data.gameKey);
  if (jsonByteLength(data.config) > MAX_CONFIG_BYTES) {
    throw new ValidationError('Game settings are too large.');
  }
  const config = parseInput(game.configSchema, data.config);
  const now = ctx.clock.now();

  const session = await withTransaction(ctx, async (tx) => {
    if ((await liveSessionsHostedBy(tx, host.userId)) >= MAX_LIVE_SESSIONS_PER_HOST) {
      throw new ConflictError(
        `You already host ${MAX_LIVE_SESSIONS_PER_HOST} live games. Finish or abandon one first.`,
      );
    }
    const inserted = await tx.db
      .insert(gameSessions)
      .values({
        gameKey: game.key,
        surface: data.surface,
        hostUserId: host.userId,
        discordChannelId: data.discordChannelId ?? null,
        activityInstanceId: data.activityInstanceId ?? null,
        seed: randomToken(SESSION_SEED_BYTES),
        config: toJsonObject(config),
        lastActivityAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .catch((error: unknown) => {
        if (isUniqueViolation(error)) throw new ConflictError('A game is already running here.');
        throw error;
      });
    const row = inserted[0]!;
    if (data.hostPlays) {
      await tx.db
        .insert(gamePlayers)
        .values({ sessionId: row.id, userId: host.userId, seat: 1, joinedAt: now });
    }
    await enqueueRender(tx, row);
    return row;
  });
  return buildSessionView(ctx, session, host.userId);
}

/** Join a lobby. Idempotent; refused once the game starts or is full. */
export async function joinSession(
  ctx: ServiceContext,
  input: z.input<typeof sessionIdSchema>,
): Promise<SessionView> {
  const data = parseInput(sessionIdSchema, input);
  const actor = requireActiveMember(ctx);
  const session = await withTransaction(ctx, async (tx) => {
    const current = await loadSession(tx, data.sessionId, { lock: true });
    if (current.status !== 'lobby') throw new InvalidStateError('This game has already started.');
    if (await isPlayer(tx, current.id, actor.userId)) return current;
    const game = getGame(current.gameKey);
    if ((await loadPlayers(tx, current.id)).length >= game.maxPlayers) {
      throw new InvalidStateError('This game is full.');
    }
    await tx.db.insert(gamePlayers).values({
      sessionId: current.id,
      userId: actor.userId,
      seat: await nextSeat(tx, current.id),
      joinedAt: tx.clock.now(),
    });
    return touchLockedSession(tx, current);
  });
  return buildSessionView(ctx, session, actor.userId);
}

/** Leave a lobby. Idempotent. The last player out closes the lobby. */
export async function leaveSession(
  ctx: ServiceContext,
  input: z.input<typeof sessionIdSchema>,
): Promise<SessionView> {
  const data = parseInput(sessionIdSchema, input);
  const actor = requireUser(ctx);
  const session = await withTransaction(ctx, async (tx) => {
    const current = await loadSession(tx, data.sessionId, { lock: true });
    if (current.status !== 'lobby') {
      throw new InvalidStateError('You can only leave before the game starts.');
    }
    const removed = await tx.db
      .delete(gamePlayers)
      .where(and(eq(gamePlayers.sessionId, current.id), eq(gamePlayers.userId, actor.userId)))
      .returning({ id: gamePlayers.id });
    if (removed.length === 0) return current;
    if ((await loadPlayers(tx, current.id)).length === 0) {
      return (await abandonInTx(tx, current, 'Everyone left the lobby.')) ?? current;
    }
    return touchLockedSession(tx, current);
  });
  return buildSessionView(ctx, session, actor.userId);
}

/**
 * Host (or event staff) authorization for lobby control. Checked before any
 * transaction opens: a denial writes its audit entry outside the transaction.
 */
async function authorizeHost(ctx: ServiceContext, session: SessionRecord): Promise<boolean> {
  if (actorUserId(ctx.actor) === session.hostUserId) return false;
  await authorize(ctx, 'canManageEvents', { type: 'game_session', id: session.id });
  return true;
}

/** Start the game: the engine deals from the session seed; timers begin now. */
export async function startSession(
  ctx: ServiceContext,
  input: z.input<typeof sessionIdSchema>,
): Promise<SessionView> {
  const data = parseInput(sessionIdSchema, input);
  const actor = requireActiveMember(ctx);
  const staffOverride = await authorizeHost(ctx, await loadSession(ctx, data.sessionId));
  const session = await withTransaction(ctx, async (tx) => {
    const current = await loadSession(tx, data.sessionId, { lock: true });
    if (current.status !== 'lobby') throw new InvalidStateError('This game has already started.');
    const game = getGame(current.gameKey);
    const players = await loadPlayers(tx, current.id);
    if (players.length < game.minPlayers || players.length > game.maxPlayers) {
      throw new InvalidStateError(`This game needs ${game.minPlayers}–${game.maxPlayers} players.`);
    }
    const now = tx.clock.now();
    const initial = game.init(
      current.config,
      players.map((player) => player.userId),
      createRng(current.seed),
    );
    const state = game.advance(initial, now.getTime());
    const started = await commitState(tx, game, current, state, {
      status: 'active',
      startedAt: now,
      playerCount: players.length,
    });
    if (!started) throw new ConflictError('The game changed meanwhile — try again.');
    if (staffOverride) {
      await recordAudit(tx, {
        action: 'game.started_by_staff',
        targetType: 'game_session',
        targetId: current.id,
        context: { hostUserId: current.hostUserId },
      });
    }
    return started;
  });
  return buildSessionView(ctx, session, actor.userId);
}

/** End a lobby or running game without results (host or event staff). */
export async function abandonSession(
  ctx: ServiceContext,
  input: z.input<typeof abandonSessionSchema>,
): Promise<SessionView> {
  const data = parseInput(abandonSessionSchema, input);
  const actor = requireUser(ctx);
  const staffOverride = await authorizeHost(ctx, await loadSession(ctx, data.sessionId));
  const session = await withTransaction(ctx, async (tx) => {
    const current = await loadSession(tx, data.sessionId, { lock: true });
    if (!LIVE_SESSION_STATUSES.includes(current.status)) {
      throw new InvalidStateError('This game has already ended.');
    }
    const reason = data.reason ?? (staffOverride ? 'Stopped by staff.' : 'Stopped by the host.');
    const ended = await abandonInTx(tx, current, reason);
    if (!ended) throw new ConflictError('The game changed meanwhile — try again.');
    await recordAudit(tx, {
      action: 'game.abandoned',
      targetType: 'game_session',
      targetId: current.id,
      context: { reason, byStaff: staffOverride, previousStatus: current.status },
    });
    return ended;
  });
  return buildSessionView(ctx, session, actor.userId);
}

export async function getSessionView(
  ctx: ServiceContext,
  input: z.input<typeof sessionIdSchema>,
): Promise<SessionView> {
  requireViewer(ctx);
  const data = parseInput(sessionIdSchema, input);
  return buildSessionView(ctx, await loadSession(ctx, data.sessionId), actorUserId(ctx.actor));
}

/** The lobby/active session in a Discord channel or Activity instance, if any. */
export async function findLiveSession(
  ctx: ServiceContext,
  input: z.input<typeof findLiveSessionSchema>,
): Promise<SessionView | null> {
  requireViewer(ctx);
  const data = parseInput(findLiveSessionSchema, input);
  const [row] = await ctx.db
    .select()
    .from(gameSessions)
    .where(
      and(
        inArray(gameSessions.status, [...LIVE_SESSION_STATUSES]),
        data.discordChannelId
          ? eq(gameSessions.discordChannelId, data.discordChannelId)
          : eq(gameSessions.activityInstanceId, data.activityInstanceId!),
      ),
    )
    .limit(1);
  return row ? buildSessionView(ctx, row, actorUserId(ctx.actor)) : null;
}
