import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { members, sessions, users } from '@jave/database';
import { recordAudit } from '../audit/audit.service';
import { type ServiceContext, withTransaction } from '../kernel/context';
import { NotFoundError, ValidationError } from '../kernel/errors';
import { parseInput } from '../kernel/validation';
import { activeRoles } from '../identity/users.service';
import { deny, rankOf } from '../moderation/targets';
import { authorize, requireUser } from '../permissions/authorize';
import { MAX_REASON_LENGTH, MAX_SESSIONS_LISTED } from './constants';

/**
 * Dashboard sessions, seen from the account's side. Session tokens never leave
 * the dashboard; only their SHA-256 is stored, and nothing here returns it.
 */

export interface SessionSummary {
  id: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  /** As the browser reported it (truncated when stored). IP addresses are never shown. */
  userAgent: string | null;
}

function liveFor(ctx: ServiceContext, userId: string) {
  return and(
    eq(sessions.userId, userId),
    isNull(sessions.revokedAt),
    gt(sessions.expiresAt, ctx.clock.now()),
  );
}

/** Your own live sessions, most recently used first. */
export async function listMySessions(ctx: ServiceContext): Promise<SessionSummary[]> {
  const actor = requireUser(ctx);
  return ctx.db
    .select({
      id: sessions.id,
      createdAt: sessions.createdAt,
      lastSeenAt: sessions.lastSeenAt,
      expiresAt: sessions.expiresAt,
      userAgent: sessions.userAgent,
    })
    .from(sessions)
    .where(liveFor(ctx, actor.userId))
    .orderBy(desc(sessions.lastSeenAt), desc(sessions.id))
    .limit(MAX_SESSIONS_LISTED);
}

export const revokeMySessionSchema = z.object({ sessionId: z.uuid() });

/** End one of your own sessions (e.g. a browser you no longer use). */
export async function revokeMySession(
  ctx: ServiceContext,
  input: z.input<typeof revokeMySessionSchema>,
): Promise<void> {
  const actor = requireUser(ctx);
  const data = parseInput(revokeMySessionSchema, input);
  const [row] = await ctx.db
    .update(sessions)
    .set({ revokedAt: ctx.clock.now() })
    .where(and(eq(sessions.id, data.sessionId), liveFor(ctx, actor.userId)))
    .returning({ id: sessions.id });
  // Someone else's session and a finished one look the same: not found.
  if (!row) throw new NotFoundError('Session');
  await recordAudit(ctx, {
    action: 'session.revoked',
    targetType: 'user',
    targetId: actor.userId,
    context: { sessionId: row.id },
  });
}

export const revokeUserSessionsSchema = z.object({
  userId: z.uuid(),
  reason: z.string().trim().max(MAX_REASON_LENGTH).optional(),
});

/**
 * End every live dashboard session of an account ("sign out everywhere").
 *
 * - Your own: always allowed.
 * - Someone else's: `canQuarantine` (the account-security capability) and the
 *   moderation hierarchy — only accounts whose highest role ranks strictly
 *   below yours — with a reason. For a compromised account: its holder is
 *   signed out at once, wherever they are.
 * - System actors (a ban) may always.
 *
 * Returns how many sessions ended. Audited `session.revoked_all`.
 */
export async function revokeUserSessions(
  ctx: ServiceContext,
  input: z.input<typeof revokeUserSessionsSchema>,
): Promise<{ revoked: number }> {
  const data = parseInput(revokeUserSessionsSchema, input);
  const self = ctx.actor.kind === 'user' && ctx.actor.userId === data.userId;
  if (!self && ctx.actor.kind !== 'system') {
    await authorize(ctx, 'canQuarantine', { type: 'user', id: data.userId });
    if (!data.reason) {
      throw new ValidationError('Give a reason.', [{ path: 'reason', message: 'Required.' }]);
    }
    await assertOutranks(ctx, data.userId);
  }
  return withTransaction(ctx, async (tx) => {
    const ended = await tx.db
      .update(sessions)
      .set({ revokedAt: tx.clock.now() })
      .where(liveFor(tx, data.userId))
      .returning({ id: sessions.id });
    await recordAudit(tx, {
      action: 'session.revoked_all',
      targetType: 'user',
      targetId: data.userId,
      context: { count: ended.length, self, ...(data.reason && { reason: data.reason }) },
    });
    return { revoked: ended.length };
  });
}

async function assertOutranks(ctx: ServiceContext, userId: string): Promise<void> {
  const actor = requireUser(ctx);
  const [target] = await ctx.db
    .select({ memberId: members.id })
    .from(users)
    .leftJoin(members, eq(members.userId, users.id))
    .where(eq(users.id, userId));
  if (!target) throw new NotFoundError('User');
  const roles = target.memberId ? await activeRoles(ctx, target.memberId) : [];
  if (rankOf(roles) >= rankOf(actor.roles)) {
    await deny(ctx, 'You can only end sessions of members ranked below you.', {
      type: 'user',
      id: userId,
    });
  }
}
