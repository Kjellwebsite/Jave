import { and, eq, isNull } from 'drizzle-orm';
import { members } from '@jave/database';
import type { ServiceContext } from '../kernel/context';
import { enqueueJob } from '../jobs/queue';
import { DISCORD_ROLE_SYNC_JOB } from './users.service';

/**
 * Queue a Discord role sync for every member present in the guild. Used when
 * the JAVE → Discord role mapping changes (or sync is switched back on): a
 * new mapping must reach members whose JAVE roles did not change.
 *
 * The jobs are deliberately NOT tracked in `ctx.effects`, so an interaction
 * does not execute hundreds of syncs inline; the worker drains them at its
 * normal concurrency. Returns the number of members queued.
 */
export async function scheduleRoleResyncForAll(ctx: ServiceContext): Promise<number> {
  const background: ServiceContext = { ...ctx, effects: { jobIds: [] } };
  const rows = await ctx.db
    .select({ id: members.id })
    .from(members)
    .where(and(eq(members.guildStatus, 'present'), isNull(members.deletedAt)));
  for (const { id } of rows) {
    await enqueueJob(
      background,
      DISCORD_ROLE_SYNC_JOB,
      { memberId: id },
      { dedupeKey: `roles-sync:${id}`, rerunIfRunning: true },
    );
  }
  return rows.length;
}
