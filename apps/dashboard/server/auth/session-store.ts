import 'server-only';
import { and, eq, gt, isNull, lt } from 'drizzle-orm';
import { DAY, MINUTE, type ServiceContext } from '@jave/core';
import { sessions, users } from '@jave/database';
import { hashSessionToken, isWellFormedSessionToken, newSessionToken } from './tokens';

export const SESSION_TTL_MS = 30 * DAY;
/** last_seen_at is refreshed at most this often per session (write throttling). */
export const SESSION_TOUCH_INTERVAL_MS = 5 * MINUTE;
const MAX_USER_AGENT_LENGTH = 256;

type SessionDeps = Pick<ServiceContext, 'db' | 'clock'>;

export interface NewSession {
  /** Raw token for the cookie. Never stored or logged. */
  token: string;
  sessionId: string;
  expiresAt: Date;
}

export interface ValidSession {
  sessionId: string;
  userId: string;
  expiresAt: Date;
}

export async function createSession(
  ctx: SessionDeps,
  input: { userId: string; userAgent?: string | null; ipHash?: string | null },
): Promise<NewSession> {
  const token = newSessionToken();
  const now = ctx.clock.now();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  const [row] = await ctx.db
    .insert(sessions)
    .values({
      userId: input.userId,
      tokenHash: hashSessionToken(token),
      userAgent: input.userAgent?.slice(0, MAX_USER_AGENT_LENGTH) ?? null,
      ipHash: input.ipHash ?? null,
      createdAt: now,
      lastSeenAt: now,
      expiresAt,
    })
    .returning({ id: sessions.id });
  return { token, sessionId: row!.id, expiresAt };
}

/**
 * Resolves a session token to its user. Revoked, expired, malformed or
 * orphaned (deleted user) sessions resolve to null. Sliding `last_seen_at`
 * is throttled so page views do not write on every request.
 */
export async function validateSession(
  ctx: SessionDeps,
  token: string,
): Promise<ValidSession | null> {
  if (!isWellFormedSessionToken(token)) return null;
  const now = ctx.clock.now();
  const [row] = await ctx.db
    .select({
      sessionId: sessions.id,
      userId: sessions.userId,
      expiresAt: sessions.expiresAt,
      lastSeenAt: sessions.lastSeenAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, hashSessionToken(token)),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, now),
        isNull(users.deletedAt),
      ),
    );
  if (!row) return null;
  const touchBefore = new Date(now.getTime() - SESSION_TOUCH_INTERVAL_MS);
  if (row.lastSeenAt < touchBefore) {
    await ctx.db
      .update(sessions)
      .set({ lastSeenAt: now })
      .where(and(eq(sessions.id, row.sessionId), lt(sessions.lastSeenAt, touchBefore)));
  }
  return { sessionId: row.sessionId, userId: row.userId, expiresAt: row.expiresAt };
}

/** Revokes the session behind `token`. Returns its user, or null if it was not live. */
export async function revokeSession(
  ctx: SessionDeps,
  token: string,
): Promise<{ userId: string; sessionId: string } | null> {
  if (!isWellFormedSessionToken(token)) return null;
  const [row] = await ctx.db
    .update(sessions)
    .set({ revokedAt: ctx.clock.now() })
    .where(and(eq(sessions.tokenHash, hashSessionToken(token)), isNull(sessions.revokedAt)))
    .returning({ userId: sessions.userId, sessionId: sessions.id });
  return row ?? null;
}
