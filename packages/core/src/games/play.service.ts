import type { z } from 'zod';
import { gameMoves } from '@jave/database';
import { type ServiceContext, withTransaction } from '../kernel/context';
import {
  ConflictError,
  ForbiddenError,
  InvalidStateError,
  isUniqueViolation,
  type JaveError,
  ValidationError,
} from '../kernel/errors';
import { parseInput } from '../kernel/validation';
import { requireActiveMember } from '../calendar/guards';
import { MAX_CAS_ATTEMPTS, MAX_MOVE_BYTES, USER_TICK_OVERDUE_MS } from './constants';
import { abandonInTx, commitState, jsonByteLength } from './lifecycle';
import { isPlayer, loadSession, type SessionRecord } from './records';
import { findGame, getGame } from './registry';
import { sessionIdSchema, submitMoveSchema } from './schemas';
import type { MoveValidation } from './types';
import { buildSessionView, type SessionView } from './views';

function rejectionError(verdict: Extract<MoveValidation, { ok: false }>): JaveError {
  switch (verdict.code) {
    case 'not_player':
      return new ForbiddenError(verdict.reason);
    case 'closed':
    case 'wrong_round':
      return new InvalidStateError(verdict.reason);
    case 'duplicate':
      return new ConflictError(verdict.reason);
    case 'invalid':
      return new ValidationError(verdict.reason);
  }
}

function toMoveRecord(move: unknown): Record<string, unknown> {
  return typeof move === 'object' && move !== null && !Array.isArray(move)
    ? (move as Record<string, unknown>)
    : { value: move };
}

export interface MoveResult {
  sessionId: string;
  round: number;
  version: number;
  view: SessionView;
}

/**
 * Submit a move. Server time decides everything: timers are advanced to
 * `now` before validation, so a move after the round closed is refused no
 * matter what the client shows. One move per player per round (unique
 * index). Concurrent moves race on `game_sessions.version`; the loser
 * retries on fresh state, unless the client pinned `expectedVersion`, in
 * which case a stale version is rejected.
 */
export async function submitMove(
  ctx: ServiceContext,
  input: z.input<typeof submitMoveSchema>,
): Promise<MoveResult> {
  const data = parseInput(submitMoveSchema, input);
  const actor = requireActiveMember(ctx);
  if (jsonByteLength(data.move) > MAX_MOVE_BYTES) throw new ValidationError('Move is too large.');

  for (let attempt = 1; ; attempt++) {
    const session = await loadSession(ctx, data.sessionId);
    if (session.status !== 'active') throw new InvalidStateError('This game is not running.');
    if (!(await isPlayer(ctx, session.id, actor.userId))) {
      throw new ForbiddenError('You are not playing in this game.');
    }
    if (data.expectedVersion !== undefined && data.expectedVersion !== session.version) {
      throw new ConflictError('The game moved on — refresh and try again.', {
        version: session.version,
      });
    }
    const game = getGame(session.gameKey);
    const move = parseInput(game.moveSchema, data.move);
    const now = ctx.clock.now().getTime();
    const current = game.advance(session.state, now);
    const verdict = game.validateMove(current, actor.userId, move, now);
    if (!verdict.ok) throw rejectionError(verdict);
    const applied = game.applyMove(current, actor.userId, move, now);

    const committed = await withTransaction(ctx, async (tx) => {
      const next = await commitState(tx, game, session, applied.state);
      if (!next) return null;
      try {
        await tx.db.insert(gameMoves).values({
          sessionId: session.id,
          userId: actor.userId,
          round: applied.round,
          move: toMoveRecord(move),
          correct: applied.correct,
          points: Math.round(applied.points),
          createdAt: tx.clock.now(),
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw new ConflictError('You already moved this round.');
        throw error;
      }
      return next;
    });
    if (committed) {
      return {
        sessionId: committed.id,
        round: applied.round,
        version: committed.version,
        view: await buildSessionView(ctx, committed, actor.userId),
      };
    }
    if (data.expectedVersion !== undefined || attempt >= MAX_CAS_ATTEMPTS) {
      throw new ConflictError('The game moved on — refresh and try again.');
    }
  }
}

const GAME_UNAVAILABLE_REASON = 'This game is no longer available.';

/**
 * Advance a session's timers to now (idempotent). Internal: no authorization
 * — callers are the `games.tick` job, the sweep and `tickSession`, which
 * authorize first. Not exported from the module.
 *
 * `overdueByMs` > 0 only advances when the next deadline passed at least that
 * long ago: player-initiated ticks then cannot race the worker to reveal new
 * information (a new question, GO) to themselves first.
 */
export async function advanceSession(
  ctx: ServiceContext,
  sessionId: string,
  options: { overdueByMs?: number } = {},
): Promise<SessionRecord> {
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
    const session = await loadSession(ctx, sessionId);
    if (session.status !== 'active') return session;
    const game = findGame(session.gameKey);
    if (game) {
      const now = ctx.clock.now().getTime();
      const deadline = game.nextDeadline(session.state);
      if (options.overdueByMs && (deadline === null || deadline > now - options.overdueByMs)) {
        return session;
      }
      const next = game.advance(session.state, now);
      if (next === session.state) return session;
      const committed = await withTransaction(ctx, (tx) => commitState(tx, game, session, next));
      if (committed) return committed;
    } else {
      const ended = await withTransaction(ctx, (tx) =>
        abandonInTx(tx, session, GAME_UNAVAILABLE_REASON),
      );
      if (ended) return ended;
    }
  }
  return loadSession(ctx, sessionId);
}

/**
 * Surfaces (bot, Activity) may nudge timers for a session the actor is in.
 * The system advances everything due; hosts and players only advance
 * transitions the worker is late on (see `USER_TICK_OVERDUE_MS`).
 */
export async function tickSession(
  ctx: ServiceContext,
  input: z.input<typeof sessionIdSchema>,
): Promise<SessionView> {
  const data = parseInput(sessionIdSchema, input);
  if (ctx.actor.kind === 'system') {
    return buildSessionView(ctx, await advanceSession(ctx, data.sessionId), null);
  }
  const actor = requireActiveMember(ctx);
  const session = await loadSession(ctx, data.sessionId);
  if (session.hostUserId !== actor.userId && !(await isPlayer(ctx, session.id, actor.userId))) {
    throw new ForbiddenError('Only the host and players can advance this game.');
  }
  const advanced = await advanceSession(ctx, session.id, { overdueByMs: USER_TICK_OVERDUE_MS });
  return buildSessionView(ctx, advanced, actor.userId);
}
