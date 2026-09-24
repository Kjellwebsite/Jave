import { and, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { memberRoles } from '@jave/database';
import type { ServiceContext } from '../kernel/context';
import { ConflictError, ForbiddenError, ValidationError } from '../kernel/errors';
import { parseInput } from '../kernel/validation';
import { recordAudit } from '../audit/audit.service';
import { publishEvent } from '../events/bus';
import { enqueueJob } from '../jobs/queue';
import { authorize, isSelf } from '../permissions/authorize';
import {
  highestRole,
  type OrgRole,
  PROGRESSION_ROLES,
  ROLE_KEYS,
  roleRank,
} from '../permissions/roles';
import { activeRoles, DISCORD_ROLE_SYNC_JOB, getMemberById } from './users.service';

const roleSchema = z.enum(ROLE_KEYS as [OrgRole, ...OrgRole[]]);

export const grantRoleSchema = z.object({
  memberId: z.uuid(),
  role: roleSchema,
  reason: z.string().trim().min(3, 'Give a reason').max(500),
  expiresAt: z.coerce.date().optional(),
});

export const revokeRoleSchema = z.object({
  memberId: z.uuid(),
  role: roleSchema,
  reason: z.string().trim().min(3, 'Give a reason').max(500),
});

/**
 * Hierarchy rule: you may only grant or revoke roles strictly below your own
 * highest role. Founders may manage every role. Nobody may change their own
 * roles (system actors excepted).
 */
function assertCanManageRole(ctx: ServiceContext, memberId: string, role: OrgRole): void {
  if (ctx.actor.kind === 'system') return;
  if (ctx.actor.kind !== 'user') throw new ForbiddenError();
  if (isSelf(ctx.actor, memberId)) throw new ForbiddenError('You cannot change your own roles.');
  const top = highestRole(ctx.actor.roles);
  if (!top) throw new ForbiddenError();
  if (top === 'founder') return;
  if (roleRank(role) >= roleRank(top)) {
    throw new ForbiddenError(`Only roles below ${top.toUpperCase()} can be managed by you.`);
  }
}

async function scheduleSync(ctx: ServiceContext, memberId: string) {
  await enqueueJob(
    ctx,
    DISCORD_ROLE_SYNC_JOB,
    { memberId },
    { dedupeKey: `roles-sync:${memberId}` },
  );
}

/**
 * Grant a role. Progression roles (member → applicant → trial → verified) are
 * exclusive: granting one retires the others.
 */
export async function grantRole(
  ctx: ServiceContext,
  input: z.input<typeof grantRoleSchema>,
): Promise<void> {
  const data = parseInput(grantRoleSchema, input);
  await authorize(ctx, 'canAssignRoles', { type: 'member', id: data.memberId });
  assertCanManageRole(ctx, data.memberId, data.role);
  await grantRoleUnchecked(ctx, data);
}

/**
 * Grant without capability checks. For domain workflows that have already
 * authorized a higher-level action (e.g. accepting an application grants TRIAL).
 */
export async function grantRoleUnchecked(
  ctx: ServiceContext,
  data: { memberId: string; role: OrgRole; reason: string; expiresAt?: Date },
): Promise<boolean> {
  await getMemberById(ctx, data.memberId);
  const current = await activeRoles(ctx, data.memberId);
  if (current.includes(data.role)) return false;
  if (data.expiresAt && data.expiresAt <= ctx.clock.now())
    throw new ValidationError('Expiry must be in the future.');
  const now = ctx.clock.now();
  const actorUserId = ctx.actor.kind === 'user' ? ctx.actor.userId : null;

  if (PROGRESSION_ROLES.includes(data.role)) {
    const retire = PROGRESSION_ROLES.filter((r) => r !== data.role && current.includes(r));
    if (retire.length > 0) {
      await ctx.db
        .update(memberRoles)
        .set({ revokedAt: now, revokedByUserId: actorUserId })
        .where(
          and(
            eq(memberRoles.memberId, data.memberId),
            inArray(memberRoles.role, retire),
            isNull(memberRoles.revokedAt),
          ),
        );
    }
  }
  await ctx.db.insert(memberRoles).values({
    memberId: data.memberId,
    role: data.role,
    reason: data.reason,
    grantedByUserId: actorUserId,
    grantedAt: now,
    expiresAt: data.expiresAt ?? null,
  });
  await recordAudit(ctx, {
    action: 'role.granted',
    targetType: 'member',
    targetId: data.memberId,
    context: { role: data.role, reason: data.reason, expiresAt: data.expiresAt?.toISOString() },
  });
  await publishEvent(ctx, {
    type: 'member.role_granted',
    aggregateType: 'member',
    aggregateId: data.memberId,
    subjectMemberId: data.memberId,
    payload: { role: data.role },
  });
  await scheduleSync(ctx, data.memberId);
  return true;
}

export async function revokeRole(
  ctx: ServiceContext,
  input: z.input<typeof revokeRoleSchema>,
): Promise<void> {
  const data = parseInput(revokeRoleSchema, input);
  await authorize(ctx, 'canAssignRoles', { type: 'member', id: data.memberId });
  assertCanManageRole(ctx, data.memberId, data.role);
  const revoked = await revokeRoleUnchecked(ctx, data);
  if (!revoked) throw new ConflictError(`Member does not hold ${data.role.toUpperCase()}.`);
}

export async function revokeRoleUnchecked(
  ctx: ServiceContext,
  data: { memberId: string; role: OrgRole; reason: string },
): Promise<boolean> {
  const now = ctx.clock.now();
  const rows = await ctx.db
    .update(memberRoles)
    .set({ revokedAt: now, revokedByUserId: ctx.actor.kind === 'user' ? ctx.actor.userId : null })
    .where(
      and(
        eq(memberRoles.memberId, data.memberId),
        eq(memberRoles.role, data.role),
        isNull(memberRoles.revokedAt),
      ),
    )
    .returning({ id: memberRoles.id });
  if (rows.length === 0) return false;
  await recordAudit(ctx, {
    action: 'role.revoked',
    targetType: 'member',
    targetId: data.memberId,
    context: { role: data.role, reason: data.reason },
  });
  await publishEvent(ctx, {
    type: 'member.role_revoked',
    aggregateType: 'member',
    aggregateId: data.memberId,
    subjectMemberId: data.memberId,
    payload: { role: data.role },
  });
  await scheduleSync(ctx, data.memberId);
  return true;
}

/** Roles the current actor is allowed to grant (for UI pickers). */
export function assignableRoles(ctx: ServiceContext): OrgRole[] {
  if (ctx.actor.kind === 'system') return [...ROLE_KEYS];
  if (ctx.actor.kind !== 'user' || !ctx.actor.capabilities.has('canAssignRoles')) return [];
  const top = highestRole(ctx.actor.roles);
  if (!top) return [];
  if (top === 'founder') return [...ROLE_KEYS];
  return ROLE_KEYS.filter((role) => roleRank(role) < roleRank(top));
}
