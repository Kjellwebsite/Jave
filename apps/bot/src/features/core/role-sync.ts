import { and, eq } from 'drizzle-orm';
import { members, users } from '@jave/database';
import {
  activeRoles,
  getSettings,
  type JobHandler,
  type MemberStanding,
  type OrgRole,
  PermanentJobError,
} from '@jave/core';
import { DiscordActionError } from '../../discord/gateway';
import type { BotServices } from '../../runtime';

export interface RoleSyncPlan {
  add: string[];
  remove: string[];
}

/**
 * Pure: which mapped Discord roles to add/remove. Only roles that appear in
 * the JAVE→Discord mapping are ever touched; everything else on the member
 * (quarantine role, boosters, unrelated roles) is left alone.
 */
export function planRoleSync(
  desired: readonly OrgRole[],
  mapping: Partial<Record<OrgRole, string>>,
  current: readonly string[],
): RoleSyncPlan {
  const managed = new Map<string, OrgRole>();
  for (const [role, id] of Object.entries(mapping) as [OrgRole, string][]) managed.set(id, role);
  const want = new Set(desired.map((r) => mapping[r]).filter((id): id is string => Boolean(id)));
  const have = new Set(current);
  return {
    add: [...want].filter((id) => !have.has(id)),
    remove: [...have].filter((id) => managed.has(id) && !want.has(id)),
  };
}

/**
 * Standings under which a member holds none of the JAVE-managed Discord
 * roles. Quarantine and ban strip them; release and unban set the standing
 * back and enqueue a sync, which restores them from the member's JAVE roles.
 */
export const STRIPPED_STANDINGS: readonly MemberStanding[] = ['quarantined', 'banned'];

export function roleSyncHandler(services: BotServices): JobHandler {
  return async (ctx, payload) => {
    const memberId = typeof payload.memberId === 'string' ? payload.memberId : null;
    if (!memberId) throw new PermanentJobError('memberId missing');
    const settings = await getSettings(ctx, 'roles');
    if (!settings.syncToDiscord) return { skipped: 'sync disabled' };
    const [row] = await ctx.db
      .select({
        discordId: users.discordId,
        standing: members.standing,
        deletedAt: members.deletedAt,
      })
      .from(members)
      .innerJoin(users, eq(users.id, members.userId))
      .where(and(eq(members.id, memberId)));
    if (!row) throw new PermanentJobError(`member ${memberId} not found`);
    const discordMember = await services.gateway.fetchMember(row.discordId);
    if (!discordMember) return { skipped: 'not in guild' };
    const stripped = STRIPPED_STANDINGS.includes(row.standing) || row.deletedAt !== null;
    const desired = stripped ? [] : await activeRoles(ctx, memberId);
    const plan = planRoleSync(desired, settings.discordRoleIds, discordMember.roleIds);
    try {
      if (plan.add.length)
        await services.gateway.addRoles(row.discordId, plan.add, 'JAVE role sync');
      if (plan.remove.length)
        await services.gateway.removeRoles(row.discordId, plan.remove, 'JAVE role sync');
    } catch (error) {
      if (error instanceof DiscordActionError && error.permanent)
        throw new PermanentJobError(error.message);
      throw error;
    }
    return { added: plan.add, removed: plan.remove };
  };
}
