import { and, eq } from 'drizzle-orm';
import { members, users } from '@jave/database';
import {
  activeRoles,
  getSettings,
  type JobHandler,
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
        guildStatus: members.guildStatus,
      })
      .from(members)
      .innerJoin(users, eq(users.id, members.userId))
      .where(and(eq(members.id, memberId)));
    if (!row) throw new PermanentJobError(`member ${memberId} not found`);
    const discordMember = await services.gateway.fetchMember(row.discordId);
    if (!discordMember) return { skipped: 'not in guild' };
    const desired = row.standing === 'banned' ? [] : await activeRoles(ctx, memberId);
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
