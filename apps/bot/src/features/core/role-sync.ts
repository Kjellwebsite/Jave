import { eq, sql } from 'drizzle-orm';
import { members, users } from '@jave/database';
import {
  activeRoles,
  getSettingsFresh,
  isSnowflake,
  type JobHandler,
  type MemberStanding,
  type OrgRole,
  PermanentJobError,
  type ServiceContext,
  type Settings,
  withTransaction,
} from '@jave/core';
import { DiscordActionError } from '../../discord/gateway';
import type { BotServices } from '../../runtime';
import { type RoleScreen, screenRoleAdds } from './role-screen';

export interface RoleSyncPlan {
  add: string[];
  remove: string[];
}

/**
 * pg_advisory_xact_lock namespace serializing one member's role jobs (sync
 * and retire). Core uses 424_201 (AI ledger) and 424_202 (settings).
 */
const MEMBER_ROLES_LOCK_NAMESPACE = 424_203;

/**
 * Run one member's read-decide-act role work under a per-member lock. A sync
 * that read the mapping just before a change could otherwise add a role right
 * after the concurrent retire job removed it; serialized, whichever runs
 * second reads the mapping and the member's roles after the first acted.
 */
function withMemberRolesLock<T>(
  ctx: ServiceContext,
  memberId: string,
  work: (tx: ServiceContext) => Promise<T>,
): Promise<T> {
  return withTransaction(ctx, async (tx) => {
    await tx.db.execute(
      sql`select pg_advisory_xact_lock(${MEMBER_ROLES_LOCK_NAMESPACE}::int, hashtext(${memberId}))`,
    );
    return work(tx);
  });
}

/** Audit-log reasons Discord shows for role changes JAVE makes. */
const SYNC_REASON = 'JAVE role sync';
const RETIRE_REASON = 'JAVE role sync: mapping retired';

/**
 * Pure: which mapped Discord roles to add/remove. Only roles that appear in
 * the JAVE→Discord mapping are ever touched; everything else on the member
 * (quarantine role, boosters, unrelated roles) is left alone. One Discord
 * role may back several JAVE roles; it is kept while any of them is held.
 */
export function planRoleSync(
  desired: readonly OrgRole[],
  mapping: Partial<Record<OrgRole, string>>,
  current: readonly string[],
): RoleSyncPlan {
  const managed = new Set(Object.values(mapping).filter((id): id is string => Boolean(id)));
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

/** Discord refusals that retrying cannot fix dead-letter the job. */
async function discordCall<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof DiscordActionError && error.permanent)
      throw new PermanentJobError(error.message);
    throw error;
  }
}

async function memberRow(ctx: ServiceContext, memberId: string) {
  const [row] = await ctx.db
    .select({
      discordId: users.discordId,
      standing: members.standing,
      deletedAt: members.deletedAt,
    })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(eq(members.id, memberId));
  if (!row) throw new PermanentJobError(`member ${memberId} not found`);
  return row;
}

async function screenAdds(
  services: BotServices,
  add: string[],
  desired: readonly OrgRole[],
  settings: Settings<'roles'>,
): Promise<RoleScreen> {
  if (add.length === 0) return { allowed: [], withheld: [] };
  const [roles, bot] = await Promise.all([
    services.gateway.listRoles(),
    services.gateway.botMember(),
  ]);
  return screenRoleAdds(add, {
    desired,
    mapping: settings.discordRoleIds,
    roles,
    botHighestRolePosition: bot.highestRolePosition,
  });
}

/**
 * `discord.roles.sync` — make a member's mapped Discord roles match their
 * JAVE roles. The mapping is read fresh: the dashboard may have changed it
 * (and queued this job) moments ago, within the bot's settings cache lifetime.
 */
export function roleSyncHandler(services: BotServices): JobHandler {
  return async (jobCtx, payload) => {
    const memberId = typeof payload.memberId === 'string' ? payload.memberId : null;
    if (!memberId) throw new PermanentJobError('memberId missing');
    return withMemberRolesLock(jobCtx, memberId, (ctx) => syncMember(services, ctx, memberId));
  };
}

async function syncMember(services: BotServices, ctx: ServiceContext, memberId: string) {
  const settings = await getSettingsFresh(ctx, 'roles');
  if (!settings.syncToDiscord) return { skipped: 'sync disabled' };
  const row = await memberRow(ctx, memberId);
  const discordMember = await discordCall(() => services.gateway.fetchMember(row.discordId));
  if (!discordMember) return { skipped: 'not in guild' };
  const stripped = STRIPPED_STANDINGS.includes(row.standing) || row.deletedAt !== null;
  const desired = stripped ? [] : await activeRoles(ctx, memberId);
  const plan = planRoleSync(desired, settings.discordRoleIds, discordMember.roleIds);
  const screen = await discordCall(() => screenAdds(services, plan.add, desired, settings));
  if (screen.withheld.length > 0) {
    ctx.logger.warn({ memberId, withheld: screen.withheld }, 'role sync withheld mapped roles');
  }
  await discordCall(async () => {
    if (screen.allowed.length)
      await services.gateway.addRoles(row.discordId, screen.allowed, SYNC_REASON);
    if (plan.remove.length)
      await services.gateway.removeRoles(row.discordId, plan.remove, SYNC_REASON);
  });
  return { added: screen.allowed, removed: plan.remove, withheld: screen.withheld };
}

/** True while `roleId` is still something role sync or quarantine manages. */
function stillManaged(settings: Settings<'roles'>, roleId: string): boolean {
  return (
    settings.quarantineRoleId === roleId ||
    Object.values(settings.discordRoleIds).some((id) => id === roleId)
  );
}

/**
 * `discord.roles.retire` — a mapping was replaced or cleared: remove the
 * Discord role JAVE no longer manages from the member. Skipped when the role
 * is managed again by the time the job runs, or when role sync is off.
 */
export function roleRetireHandler(services: BotServices): JobHandler {
  return async (jobCtx, payload) => {
    const memberId = typeof payload.memberId === 'string' ? payload.memberId : null;
    const roleId = typeof payload.roleId === 'string' ? payload.roleId : null;
    if (!memberId || !roleId || !isSnowflake(roleId))
      throw new PermanentJobError('memberId or roleId missing');
    return withMemberRolesLock(jobCtx, memberId, (ctx) =>
      retireRole(services, ctx, memberId, roleId),
    );
  };
}

async function retireRole(
  services: BotServices,
  ctx: ServiceContext,
  memberId: string,
  roleId: string,
) {
  const settings = await getSettingsFresh(ctx, 'roles');
  if (!settings.syncToDiscord) return { skipped: 'sync disabled' };
  if (stillManaged(settings, roleId)) return { skipped: 'still managed' };
  const row = await memberRow(ctx, memberId);
  const discordMember = await discordCall(() => services.gateway.fetchMember(row.discordId));
  if (!discordMember) return { skipped: 'not in guild' };
  if (!discordMember.roleIds.includes(roleId)) return { skipped: 'not held' };
  await discordCall(() => services.gateway.removeRoles(row.discordId, [roleId], RETIRE_REASON));
  return { removed: [roleId] };
}
