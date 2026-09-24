import { and, asc, eq, lt } from 'drizzle-orm';
import { z } from 'zod';
import { gameSessions } from '@jave/database';
import { type ServiceContext, withTransaction } from '../kernel/context';
import {
  type JobHandler,
  type JobHandlerMap,
  PermanentJobError,
  type RecurringJob,
} from '../jobs/worker';
import {
  ACTIVE_IDLE_TTL_MS,
  GAMES_SWEEP_BATCH_LIMIT,
  GAMES_SWEEP_EVERY_MS,
  GAMES_SWEEP_JOB,
  GAMES_TICK_JOB,
  LOBBY_IDLE_TTL_MS,
} from './constants';
import { requireSystemActor } from '../calendar/guards';
import { abandonInTx } from './lifecycle';
import { advanceSession } from './play.service';
import { loadSession, type SessionStatus } from './records';

const tickPayloadSchema = z.object({ sessionId: z.uuid() });

/** `games.tick`: advance a session's timers at a deadline the engine announced. */
const tickJobHandler: JobHandler = async (ctx, payload) => {
  requireSystemActor(ctx);
  const parsed = tickPayloadSchema.safeParse(payload);
  if (!parsed.success) throw new PermanentJobError('invalid tick payload');
  const session = await advanceSession(ctx, parsed.data.sessionId);
  return { status: session.status, version: session.version };
};

async function abandonIfIdle(
  ctx: ServiceContext,
  sessionId: string,
  status: SessionStatus,
  idleBefore: Date,
  reason: string,
): Promise<boolean> {
  return withTransaction(ctx, async (tx) => {
    const session = await loadSession(tx, sessionId, { lock: true });
    if (session.status !== status || session.lastActivityAt >= idleBefore) return false;
    return (await abandonInTx(tx, session, reason)) !== null;
  });
}

async function staleIds(ctx: ServiceContext, status: SessionStatus, idleBefore: Date) {
  const rows = await ctx.db
    .select({ id: gameSessions.id })
    .from(gameSessions)
    .where(and(eq(gameSessions.status, status), lt(gameSessions.lastActivityAt, idleBefore)))
    .orderBy(asc(gameSessions.lastActivityAt))
    .limit(GAMES_SWEEP_BATCH_LIMIT);
  return rows.map((row) => row.id);
}

/**
 * Close what nobody will finish: lobbies idle for 30 minutes, and running
 * games that made no progress for 2 hours (timers are advanced first, so a
 * game that merely missed a tick finishes normally instead).
 */
export async function sweepStaleSessions(
  ctx: ServiceContext,
): Promise<{ abandoned: number; advanced: number }> {
  requireSystemActor(ctx);
  const now = ctx.clock.now().getTime();
  let abandoned = 0;
  let advanced = 0;
  const lobbyCutoff = new Date(now - LOBBY_IDLE_TTL_MS);
  for (const id of await staleIds(ctx, 'lobby', lobbyCutoff)) {
    if (await abandonIfIdle(ctx, id, 'lobby', lobbyCutoff, 'The lobby expired.')) abandoned++;
  }
  const activeCutoff = new Date(now - ACTIVE_IDLE_TTL_MS);
  for (const id of await staleIds(ctx, 'active', activeCutoff)) {
    const session = await advanceSession(ctx, id);
    if (session.status !== 'active' || session.lastActivityAt >= activeCutoff) {
      advanced++;
      continue;
    }
    if (await abandonIfIdle(ctx, id, 'active', activeCutoff, 'The game stalled.')) abandoned++;
  }
  return { abandoned, advanced };
}

const sweepJobHandler: JobHandler = async (ctx) => ({ ...(await sweepStaleSessions(ctx)) });

export const gamesJobHandlers: JobHandlerMap = {
  [GAMES_TICK_JOB]: tickJobHandler,
  [GAMES_SWEEP_JOB]: sweepJobHandler,
};

export const gamesRecurringJobs: readonly RecurringJob[] = [
  { type: GAMES_SWEEP_JOB, everyMs: GAMES_SWEEP_EVERY_MS },
];
