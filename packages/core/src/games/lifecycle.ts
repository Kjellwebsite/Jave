import { and, eq } from 'drizzle-orm';
import { gamePlayers, type gameSessions } from '@jave/database';
import type { ServiceContext } from '../kernel/context';
import { ConflictError } from '../kernel/errors';
import { publishEvent } from '../events/bus';
import { enqueueJob } from '../jobs/queue';
import { GAMES_TICK_JOB, MIN_RANKED_PLAYERS } from './constants';
import { enqueueRender } from './discord-jobs';
import { rankPlacements } from './placements';
import { compareAndSetSession, loadPlayers, type SessionRecord, toJsonObject } from './records';
import type { AnyGameDefinition } from './types';

/** Serialized size of a JSON value; unserializable values count as infinite. */
export function jsonByteLength(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value) ?? '');
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export async function scheduleTick(
  ctx: ServiceContext,
  session: SessionRecord,
  deadline: number | null,
): Promise<void> {
  if (deadline === null || !Number.isFinite(deadline)) return;
  await enqueueJob(
    ctx,
    GAMES_TICK_JOB,
    { sessionId: session.id },
    { runAt: new Date(deadline), dedupeKey: `${GAMES_TICK_JOB}:${session.id}:${deadline}` },
  );
}

/**
 * Final scores and placements (standard competition ranking), then one
 * `game.completed` per player. Sessions with fewer than two players are
 * practice: recorded, but `ranked: false` and never a win.
 */
async function recordResults(
  tx: ServiceContext,
  game: AnyGameDefinition,
  session: SessionRecord,
  state: unknown,
): Promise<void> {
  const players = await loadPlayers(tx, session.id);
  const ranked = players.length >= MIN_RANKED_PLAYERS;
  const standings = rankPlacements(
    players.map((player) => player.userId),
    game.scores(state),
  );
  const memberOf = new Map(players.map((player) => [player.userId, player.memberId]));
  for (const standing of standings) {
    const score = Math.round(standing.score);
    await tx.db
      .update(gamePlayers)
      .set({ score, placement: standing.placement })
      .where(and(eq(gamePlayers.sessionId, session.id), eq(gamePlayers.userId, standing.playerId)));
    await publishEvent(tx, {
      type: 'game.completed',
      aggregateType: 'game_session',
      aggregateId: session.id,
      subjectMemberId: memberOf.get(standing.playerId) ?? null,
      payload: {
        gameKey: session.gameKey,
        score,
        placement: standing.placement,
        players: players.length,
        ranked,
        won: ranked && standing.placement === 1,
      },
    });
  }
}

/**
 * Persist a new engine state with the optimistic version check, finishing
 * the session when the engine says so, and schedule the follow-up work
 * (next timer tick, Discord render). Returns null when another writer won.
 */
export async function commitState(
  tx: ServiceContext,
  game: AnyGameDefinition,
  session: SessionRecord,
  state: unknown,
  extra: Partial<typeof gameSessions.$inferInsert> = {},
): Promise<SessionRecord | null> {
  const finished = game.isFinished(state);
  const next = await compareAndSetSession(tx, session, {
    ...extra,
    state: toJsonObject(state),
    ...(finished && { status: 'completed', endedAt: tx.clock.now(), endReason: 'finished' }),
  });
  if (!next) return null;
  if (finished) await recordResults(tx, game, next, state);
  else await scheduleTick(tx, next, game.nextDeadline(state));
  await enqueueRender(tx, next);
  return next;
}

/**
 * Bump the version for a lobby change made under the session row lock
 * (join, leave) and re-render. The lock makes a lost race impossible.
 */
export async function touchLockedSession(
  tx: ServiceContext,
  session: SessionRecord,
  changes: Partial<typeof gameSessions.$inferInsert> = {},
): Promise<SessionRecord> {
  const next = await compareAndSetSession(tx, session, changes);
  if (!next) throw new ConflictError('The game changed meanwhile — try again.');
  await enqueueRender(tx, next);
  return next;
}

/** End a live session without results. Returns null when another writer won. */
export async function abandonInTx(
  tx: ServiceContext,
  session: SessionRecord,
  reason: string,
): Promise<SessionRecord | null> {
  const next = await compareAndSetSession(tx, session, {
    status: 'abandoned',
    endedAt: tx.clock.now(),
    endReason: reason,
  });
  if (next) await enqueueRender(tx, next);
  return next;
}
