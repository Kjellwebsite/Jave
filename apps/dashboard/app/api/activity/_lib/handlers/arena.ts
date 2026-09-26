import 'server-only';
import { z } from 'zod';
import { can, ConflictError, games, InvalidStateError, ValidationError } from '@jave/core';
import { type ActivityCaller, authenticate } from '../auth';
import type { ArenaResponse } from '../contract';
import { activityHandler } from '../handler';
import { json, readJsonBody } from '../http';
import { BODY_LIMITS, spendActivityBudget } from '../limits';
import { toArenaSession } from '../mappers/arena';
import { requireInstanceSession } from '../scope';

const TRIVIA_KEY = games.trivia.TRIVIA_KEY;
const MAX_DIFFICULTY_LENGTH = 16;
/** One retry after losing the create race to another player in the same instance. */
const OPEN_ATTEMPTS = 2;

const sessionIdSchema = z.uuid();
const sessionRequestSchema = z.object({ sessionId: sessionIdSchema }).strict();
const moveRequestSchema = z
  .object({
    sessionId: sessionIdSchema,
    round: z.number().int().min(1).max(games.trivia.TRIVIA_MAX_ROUNDS),
    choice: z.number().int().min(0).max(3),
  })
  .strict();
/** Ranges are enforced by the trivia engine's own config schema in core. */
const openRequestSchema = z
  .object({
    config: z
      .object({
        rounds: z.number().int().optional(),
        secondsPerQuestion: z.number().int().optional(),
        difficulty: z.string().max(MAX_DIFFICULTY_LENGTH).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

function canHost(caller: ActivityCaller): boolean {
  const { actor } = caller.ctx;
  return actor.memberId !== null && actor.standing === 'good' && can(caller.ctx, 'canHostGames');
}

async function liveSession(caller: ActivityCaller) {
  return games.findLiveSession(caller.ctx, { activityInstanceId: caller.claims.iid });
}

function respond(
  caller: ActivityCaller,
  session: games.SessionView | null,
  liveSessionId: string | null,
): Response {
  if (session && session.gameKey !== TRIVIA_KEY) {
    throw new InvalidStateError('This Activity is running another game.');
  }
  return json<ArenaResponse>({
    serverNow: caller.ctx.clock.now().getTime(),
    session: session ? toArenaSession(session, caller.ctx.actor.userId) : null,
    liveSessionId,
    canHost: canHost(caller),
  });
}

/** Live views are live; an ended session answers with the instance's current live one. */
async function respondWithLive(caller: ActivityCaller, session: games.SessionView) {
  const live =
    session.status === 'lobby' || session.status === 'active'
      ? session.id
      : ((await liveSession(caller))?.id ?? null);
  return respond(caller, session, live);
}

/**
 * GET /api/activity/trivia/session[?sessionId=] — the viewer's state of a
 * session in this instance, or of the instance's live session. Polled at 1 Hz.
 */
export const handleArenaState = activityHandler(
  'activity.arena.state',
  async (request, deps, base) => {
    const caller = await authenticate(request, deps, base);
    await spendActivityBudget(caller.ctx, 'poll', caller.ctx.actor.userId);
    const requested = new URL(request.url).searchParams.get('sessionId');
    if (requested === null) {
      const live = await liveSession(caller);
      return respond(caller, live, live?.id ?? null);
    }
    const parsed = sessionIdSchema.safeParse(requested);
    if (!parsed.success) throw new ValidationError('Unknown game session.');
    const sessionId = parsed.data;
    await requireInstanceSession(caller.ctx, sessionId, caller.claims.iid);
    return respondWithLive(caller, await games.getSessionView(caller.ctx, { sessionId }));
  },
);

/**
 * POST /api/activity/trivia/session — join the instance's open lobby, or open
 * one (surface `activity`) when nothing is live. A running game is returned
 * as is (spectator view for non-players).
 */
export const handleArenaOpen = activityHandler(
  'activity.arena.open',
  async (request, deps, base) => {
    const caller = await authenticate(request, deps, base);
    await spendActivityBudget(caller.ctx, 'lobby', caller.ctx.actor.userId);
    const body = await readJsonBody(request, openRequestSchema, BODY_LIMITS.session);
    for (let attempt = 1; ; attempt++) {
      const live = await liveSession(caller);
      if (live) {
        if (live.gameKey !== TRIVIA_KEY) return respond(caller, live, live.id);
        const joinable = live.status === 'lobby' && !live.youArePlayer;
        const view = joinable ? await games.joinSession(caller.ctx, { sessionId: live.id }) : live;
        return respond(caller, view, view.id);
      }
      try {
        const created = await games.createSession(caller.ctx, {
          gameKey: TRIVIA_KEY,
          surface: 'activity',
          activityInstanceId: caller.claims.iid,
          config: body.config ?? {},
          hostPlays: true,
        });
        return respond(caller, created, created.id);
      } catch (error) {
        // Another player opened the lobby first: join theirs instead.
        if (!(error instanceof ConflictError) || attempt >= OPEN_ATTEMPTS) throw error;
      }
    }
  },
);

type SessionAction = (
  caller: ActivityCaller,
  body: z.output<typeof sessionRequestSchema>,
) => Promise<games.SessionView>;

function sessionEndpoint(route: string, kind: 'lobby' | 'poll', action: SessionAction) {
  return activityHandler(route, async (request, deps, base) => {
    const caller = await authenticate(request, deps, base);
    await spendActivityBudget(caller.ctx, kind, caller.ctx.actor.userId);
    const body = await readJsonBody(request, sessionRequestSchema, BODY_LIMITS.session);
    await requireInstanceSession(caller.ctx, body.sessionId, caller.claims.iid);
    return respondWithLive(caller, await action(caller, body));
  });
}

/** POST /api/activity/trivia/start — host (or event staff) starts the lobby. */
export const handleArenaStart = sessionEndpoint('activity.arena.start', 'lobby', (caller, body) =>
  games.startSession(caller.ctx, body),
);

/** POST /api/activity/trivia/leave — leave the lobby (the last player out closes it). */
export const handleArenaLeave = sessionEndpoint('activity.arena.leave', 'lobby', (caller, body) =>
  games.leaveSession(caller.ctx, body),
);

/**
 * POST /api/activity/trivia/tick — host or player nudges overdue timers. Core
 * only advances transitions overdue by ≥ 2 s, so nobody sees a question first.
 */
export const handleArenaTick = sessionEndpoint('activity.arena.tick', 'poll', (caller, body) =>
  games.tickSession(caller.ctx, body),
);

/** POST /api/activity/trivia/move — lock in an answer for the open round. */
export const handleArenaMove = activityHandler(
  'activity.arena.move',
  async (request, deps, base) => {
    const caller = await authenticate(request, deps, base);
    await spendActivityBudget(caller.ctx, 'move', caller.ctx.actor.userId);
    const body = await readJsonBody(request, moveRequestSchema, BODY_LIMITS.move);
    await requireInstanceSession(caller.ctx, body.sessionId, caller.claims.iid);
    const result = await games.submitMove(caller.ctx, {
      sessionId: body.sessionId,
      move: { round: body.round, choice: body.choice },
    });
    return respondWithLive(caller, result.view);
  },
);
