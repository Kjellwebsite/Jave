import { and, asc, eq, sql } from 'drizzle-orm';
import { gamePlayers, gameSessions, members, users } from '@jave/database';
import type { ServiceContext } from '../kernel/context';
import { NotFoundError } from '../kernel/errors';

export type SessionRecord = typeof gameSessions.$inferSelect;
export type SessionStatus = SessionRecord['status'];
export type SessionSurface = SessionRecord['surface'];

export const LIVE_SESSION_STATUSES: readonly SessionStatus[] = ['lobby', 'active'];

export async function loadSession(
  ctx: Pick<ServiceContext, 'db'>,
  sessionId: string,
  options: { lock?: boolean } = {},
): Promise<SessionRecord> {
  const query = ctx.db.select().from(gameSessions).where(eq(gameSessions.id, sessionId));
  const [row] = options.lock ? await query.for('update') : await query;
  if (!row) throw new NotFoundError('Game session');
  return row;
}

export interface PlayerRow {
  userId: string;
  seat: number;
  memberId: string | null;
  discordId: string;
  displayName: string;
  score: number;
  placement: number | null;
  joinedAt: Date;
}

/** Players by seat, i.e. join order — the engine's player order. */
export async function loadPlayers(
  ctx: Pick<ServiceContext, 'db'>,
  sessionId: string,
): Promise<PlayerRow[]> {
  return ctx.db
    .select({
      userId: gamePlayers.userId,
      seat: gamePlayers.seat,
      memberId: members.id,
      discordId: users.discordId,
      displayName: sql<string>`coalesce(${members.displayName}, ${users.displayName}, ${users.username})`,
      score: gamePlayers.score,
      placement: gamePlayers.placement,
      joinedAt: gamePlayers.joinedAt,
    })
    .from(gamePlayers)
    .innerJoin(users, eq(users.id, gamePlayers.userId))
    .leftJoin(members, eq(members.userId, gamePlayers.userId))
    .where(eq(gamePlayers.sessionId, sessionId))
    .orderBy(asc(gamePlayers.seat));
}

/** Next free seat; call under the session row lock. */
export async function nextSeat(
  ctx: Pick<ServiceContext, 'db'>,
  sessionId: string,
): Promise<number> {
  const [row] = await ctx.db
    .select({ last: sql<number>`coalesce(max(${gamePlayers.seat}), 0)::int` })
    .from(gamePlayers)
    .where(eq(gamePlayers.sessionId, sessionId));
  return (row?.last ?? 0) + 1;
}

export async function isPlayer(
  ctx: Pick<ServiceContext, 'db'>,
  sessionId: string,
  userId: string,
): Promise<boolean> {
  const [row] = await ctx.db
    .select({ id: gamePlayers.id })
    .from(gamePlayers)
    .where(and(eq(gamePlayers.sessionId, sessionId), eq(gamePlayers.userId, userId)));
  return Boolean(row);
}

/** Engine state and config must be plain JSON objects to live in jsonb columns. */
export function toJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('game engine produced a non-object value');
  }
  return value as Record<string, unknown>;
}

/**
 * Optimistic write: succeeds only if nobody else changed the session since
 * `session.version` was read. Returns the new row, or null on a lost race.
 */
export async function compareAndSetSession(
  ctx: ServiceContext,
  session: SessionRecord,
  changes: Partial<typeof gameSessions.$inferInsert>,
): Promise<SessionRecord | null> {
  const now = ctx.clock.now();
  const [row] = await ctx.db
    .update(gameSessions)
    .set({ ...changes, version: session.version + 1, lastActivityAt: now, updatedAt: now })
    .where(and(eq(gameSessions.id, session.id), eq(gameSessions.version, session.version)))
    .returning();
  return row ?? null;
}
