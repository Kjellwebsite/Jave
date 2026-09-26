import 'server-only';
import { eq } from 'drizzle-orm';
import { NotFoundError, type ServiceContext } from '@jave/core';
import { gameSessions } from '@jave/database';

/**
 * Token scope: an Activity token acts only on game sessions of the Activity
 * instance it was issued for. Sessions elsewhere (a Discord channel, another
 * instance) are reported as not found — no probing by id. This reads one
 * column; every rule about the session itself stays in core.
 */
export async function requireInstanceSession(
  ctx: Pick<ServiceContext, 'db'>,
  sessionId: string,
  instanceId: string,
): Promise<void> {
  const [row] = await ctx.db
    .select({ surface: gameSessions.surface, instanceId: gameSessions.activityInstanceId })
    .from(gameSessions)
    .where(eq(gameSessions.id, sessionId));
  if (!row || row.surface !== 'activity' || row.instanceId !== instanceId) {
    throw new NotFoundError('Game session');
  }
}
