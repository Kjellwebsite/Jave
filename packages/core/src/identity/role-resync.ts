import { and, eq, isNull } from 'drizzle-orm';
import { members } from '@jave/database';
import type { ServiceContext } from '../kernel/context';
import { enqueueJob } from '../jobs/queue';
import { DISCORD_ROLE_SYNC_JOB } from './users.service';

/**
 * Job contract `discord.roles.retire` (handled in apps/bot):
 * payload `{ memberId, roleId }`. Remove the Discord role `roleId` from the
 * member if they hold it, unless it is mapped again (or is the quarantine
 * role) by the time the job runs, or role sync is off. Idempotent; Manage
 * Roles. Queued when a role mapping is replaced or cleared: role sync only
 * removes roles that are currently mapped, so without it a retired role would
 * stay on its holders forever, including members demoted since.
 */
export const DISCORD_ROLE_RETIRE_JOB = 'discord.roles.retire';

export interface RoleResyncOptions {
  /** Discord role ids JAVE stopped managing with this change. */
  retire?: readonly string[];
}

/**
 * Queue a Discord role sync for every member present in the guild. Used when
 * the JAVE → Discord role mapping changes (or sync is switched back on): a
 * new mapping must reach members whose JAVE roles did not change. With
 * `retire`, also queue one `discord.roles.retire` job per member and role.
 *
 * The jobs are deliberately NOT tracked in `ctx.effects`, so an interaction
 * does not execute hundreds of syncs inline; the worker drains them at its
 * normal concurrency. Returns the number of members queued.
 */
export async function scheduleRoleResyncForAll(
  ctx: ServiceContext,
  options: RoleResyncOptions = {},
): Promise<number> {
  const background: ServiceContext = { ...ctx, effects: { jobIds: [] } };
  const retire = [...new Set(options.retire ?? [])];
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
    for (const roleId of retire) {
      await enqueueJob(
        background,
        DISCORD_ROLE_RETIRE_JOB,
        { memberId: id, roleId },
        { dedupeKey: `roles-retire:${roleId}:${id}`, rerunIfRunning: true },
      );
    }
  }
  return rows.length;
}
