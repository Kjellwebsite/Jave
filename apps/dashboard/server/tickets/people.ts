import 'server-only';
import { and, asc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import { can, ROLE_CAPABILITIES, ROLE_KEYS, type OrgRole, type ServiceContext } from '@jave/core';
import { memberRoles, members, users } from '@jave/database';

export interface PersonOption {
  userId: string;
  displayName: string;
}

/** Transfer targets and the assignee filter never list more people than this. */
export const HANDLER_LIST_LIMIT = 100;

/** Roles that currently grant canHandleTickets (derived from the capability map). */
export const HANDLER_ROLES: readonly OrgRole[] = ROLE_KEYS.filter((role) =>
  ROLE_CAPABILITIES[role].includes('canHandleTickets'),
);

const displayName = sql<string>`coalesce(${members.displayName}, ${users.displayName}, ${users.username})`;

/**
 * People who can handle tickets right now: an active, unexpired grant of a
 * handling role and good standing (restricted, quarantined and banned
 * members lose the capability). For the transfer picker and the assignee
 * filter; handlers only (empty for everyone else). Core re-validates the
 * target of every transfer.
 */
export async function listTicketHandlers(ctx: ServiceContext): Promise<PersonOption[]> {
  if (!can(ctx, 'canHandleTickets')) return [];
  const now = ctx.clock.now();
  return ctx.db
    .selectDistinct({ userId: users.id, displayName })
    .from(memberRoles)
    .innerJoin(members, eq(members.id, memberRoles.memberId))
    .innerJoin(users, eq(users.id, members.userId))
    .where(
      and(
        inArray(memberRoles.role, [...HANDLER_ROLES]),
        isNull(memberRoles.revokedAt),
        or(isNull(memberRoles.expiresAt), gt(memberRoles.expiresAt, now)),
        isNull(members.deletedAt),
        eq(members.standing, 'good'),
      ),
    )
    .orderBy(asc(displayName))
    .limit(HANDLER_LIST_LIMIT);
}

/**
 * Display names for user ids referenced by staff-only timeline entries
 * (transfer targets, released assignees). Handlers only.
 */
export async function peopleNames(
  ctx: ServiceContext,
  userIds: readonly string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0 || !can(ctx, 'canHandleTickets')) return new Map();
  const rows = await ctx.db
    .select({ userId: users.id, displayName })
    .from(users)
    .leftJoin(members, eq(members.userId, users.id))
    .where(inArray(users.id, ids));
  return new Map(rows.map((row) => [row.userId, row.displayName]));
}
