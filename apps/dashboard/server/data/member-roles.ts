import 'server-only';
import { and, asc, eq, gt, isNull, or } from 'drizzle-orm';
import { can, type OrgRole, roleRank } from '@jave/core';
import { memberRoles, users } from '@jave/database';
import type { UserContext } from '../context';

export interface RoleGrantView {
  role: OrgRole;
  grantedAt: Date;
  expiresAt: Date | null;
  reason: string | null;
  grantedByName: string | null;
}

/**
 * Active role grants with provenance (who, when, why). Staff-only
 * (canViewPrivateProfiles); returns null for everyone else.
 */
export async function loadRoleGrants(
  ctx: UserContext,
  memberId: string,
): Promise<RoleGrantView[] | null> {
  if (!can(ctx, 'canViewPrivateProfiles')) return null;
  const now = ctx.clock.now();
  const rows = await ctx.db
    .select({
      role: memberRoles.role,
      grantedAt: memberRoles.grantedAt,
      expiresAt: memberRoles.expiresAt,
      reason: memberRoles.reason,
      grantedByName: users.displayName,
      grantedByUsername: users.username,
    })
    .from(memberRoles)
    .leftJoin(users, eq(users.id, memberRoles.grantedByUserId))
    .where(
      and(
        eq(memberRoles.memberId, memberId),
        isNull(memberRoles.revokedAt),
        or(isNull(memberRoles.expiresAt), gt(memberRoles.expiresAt, now)),
      ),
    )
    .orderBy(asc(memberRoles.grantedAt));
  return rows
    .map((row) => ({
      role: row.role,
      grantedAt: row.grantedAt,
      expiresAt: row.expiresAt,
      reason: row.reason,
      grantedByName: row.grantedByName ?? row.grantedByUsername ?? null,
    }))
    .sort((a, b) => roleRank(b.role) - roleRank(a.role));
}
