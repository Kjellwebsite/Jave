import { and, eq, exists, gt, inArray, isNull, ne, not, or, type SQL, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { memberRoles, members, users } from '@jave/database';
import { recordAudit } from '../audit/audit.service';
import type { ServiceContext } from '../kernel/context';
import { ForbiddenError, NotFoundError } from '../kernel/errors';
import { activeRoles } from '../identity/users.service';
import type { Actor, MemberStanding } from '../permissions/actor';
import { highestRole, isStaffRole, type OrgRole, ROLES, roleRank } from '../permissions/roles';
import type { ModAction } from './copy';

/** A user a moderation action can target, with the data authorization needs. */
export interface ModerationTarget {
  userId: string;
  discordId: string;
  username: string;
  displayName: string;
  memberId: string | null;
  standing: MemberStanding | null;
  inGuild: boolean;
  joinedGuildAt: Date | null;
  roles: OrgRole[];
}

export type TargetRef = { userId: string } | { discordId: string };

export async function loadTarget(ctx: ServiceContext, ref: TargetRef): Promise<ModerationTarget> {
  const condition = 'userId' in ref ? eq(users.id, ref.userId) : eq(users.discordId, ref.discordId);
  const [row] = await ctx.db
    .select({ user: users, member: members })
    .from(users)
    .leftJoin(members, and(eq(members.userId, users.id), isNull(members.deletedAt)))
    .where(condition);
  if (!row) throw new NotFoundError('User');
  const { user, member } = row;
  return {
    userId: user.id,
    discordId: user.discordId,
    username: user.username,
    displayName: member?.displayName ?? user.displayName ?? user.username,
    memberId: member?.id ?? null,
    standing: member?.standing ?? null,
    inGuild: member?.guildStatus === 'present',
    joinedGuildAt: member?.joinedGuildAt ?? null,
    roles: member ? await activeRoles(ctx, member.id) : [],
  };
}

/** Actions that punish or restrict. Automated actors never apply these to staff. */
export const PUNITIVE_ACTIONS: ReadonlySet<ModAction> = new Set([
  'warn',
  'timeout',
  'kick',
  'ban',
  'quarantine',
]);

/** Highest role rank, or 0 without roles. */
export function rankOf(roles: readonly OrgRole[]): number {
  const top = highestRole(roles);
  return top ? roleRank(top) : 0;
}

export function holdsStaffRole(roles: readonly OrgRole[]): boolean {
  return roles.some((role) => isStaffRole(role));
}

/**
 * Hierarchy rule (pure). Returns a denial message, or null when allowed.
 * - Nobody acts on themselves.
 * - A user acts only on members whose highest role ranks strictly below
 *   theirs (so founders can only be actioned out-of-band, and a moderator
 *   can never touch core).
 * - Automated actors (system, integrations) never take punitive action
 *   against staff.
 */
export function hierarchyViolation(
  actor: Actor,
  target: Pick<ModerationTarget, 'userId' | 'roles'>,
  action: ModAction,
): string | null {
  switch (actor.kind) {
    case 'user': {
      if (actor.userId === target.userId) return 'You cannot take moderation action on yourself.';
      if (rankOf(target.roles) >= rankOf(actor.roles)) {
        return 'You can only act on members ranked below you.';
      }
      return null;
    }
    case 'system':
    case 'integration':
      return PUNITIVE_ACTIONS.has(action) && holdsStaffRole(target.roles)
        ? 'Automated moderation never applies to staff.'
        : null;
    case 'anonymous':
      return 'Sign in required.';
  }
}

/**
 * Overturn rule (pure): lifting or revoking a case issued by someone who
 * outranks you is denied. Automated actors and automod cases are exempt.
 */
export function overturnViolation(
  actor: Actor,
  issuerRoles: readonly OrgRole[] | null,
): string | null {
  if (actor.kind !== 'user' || !issuerRoles) return null;
  return rankOf(issuerRoles) > rankOf(actor.roles)
    ? 'This case was issued by higher-ranked staff.'
    : null;
}

/** Record a durable access denial and throw. */
export async function deny(
  ctx: ServiceContext,
  message: string,
  target: { type: string; id: string | null },
  context: Record<string, unknown> = {},
): Promise<never> {
  await recordAudit(
    ctx,
    {
      action: 'access.denied',
      targetType: target.type,
      targetId: target.id,
      context: { ...context, rule: message },
      result: 'denied',
    },
    { durable: true },
  ).catch((error: unknown) => ctx.logger.error({ err: error }, 'failed to audit denial'));
  throw new ForbiddenError(message);
}

export async function assertCanActOn(
  ctx: ServiceContext,
  target: ModerationTarget,
  action: ModAction,
): Promise<void> {
  const violation = hierarchyViolation(ctx.actor, target, action);
  if (violation) await deny(ctx, violation, { type: 'user', id: target.userId }, { action });
}

/** Roles of the user who issued a case (null for automod/system cases). */
export async function issuerRoles(
  ctx: ServiceContext,
  moderatorUserId: string | null,
): Promise<OrgRole[] | null> {
  if (!moderatorUserId) return null;
  const [member] = await ctx.db
    .select({ id: members.id })
    .from(members)
    .where(and(eq(members.userId, moderatorUserId), isNull(members.deletedAt)));
  return member ? activeRoles(ctx, member.id) : [];
}

/** Only internal processes (the bot worker, sweeps) may call Discord callbacks. */
export async function requireSystemActor(
  ctx: ServiceContext,
  target: { type: string; id: string | null },
): Promise<void> {
  if (ctx.actor.kind !== 'system') {
    await deny(ctx, 'Only JAVE internal processes can do that.', target);
  }
}

/**
 * Roles ranked at or above the actor's highest role. Moderation records about
 * members holding one of these are hidden from the actor (founders see all).
 */
export function rolesAtOrAbove(actorRoles: readonly OrgRole[]): OrgRole[] {
  const mine = rankOf(actorRoles);
  return ROLES.filter((role) => role.rank >= mine).map((role) => role.key);
}

/**
 * SQL condition hiding moderation records whose subject is the caller, or a
 * member who ranks at or above the caller. Staff cannot read investigations
 * into themselves or into their superiors — including who reported them.
 * Returns undefined for internal actors (the bot worker, sweeps), which see all.
 * Rows without a subject (e.g. raid events) stay visible.
 */
export function visibleSubjectCondition(
  ctx: ServiceContext,
  subjectColumn: AnyPgColumn,
): SQL | undefined {
  if (ctx.actor.kind !== 'user') return undefined;
  const self = ne(subjectColumn, ctx.actor.userId);
  if (ctx.actor.roles.includes('founder')) return or(isNull(subjectColumn), self);
  const hidden = rolesAtOrAbove(ctx.actor.roles);
  // Typed operators (not raw template values) so timestamps bind correctly on every driver.
  const outranks = exists(
    ctx.db
      .select({ one: sql`1` })
      .from(memberRoles)
      .innerJoin(members, eq(members.id, memberRoles.memberId))
      .where(
        and(
          eq(members.userId, subjectColumn),
          isNull(memberRoles.revokedAt),
          or(isNull(memberRoles.expiresAt), gt(memberRoles.expiresAt, ctx.clock.now())),
          inArray(memberRoles.role, hidden),
        ),
      ),
  );
  return or(isNull(subjectColumn), and(self, not(outranks)));
}

/** True when the caller may see moderation records about `subjectUserId`. */
export async function canSeeSubject(
  ctx: ServiceContext,
  subjectUserId: string | null,
): Promise<boolean> {
  if (ctx.actor.kind !== 'user' || !subjectUserId) return true;
  if (ctx.actor.userId === subjectUserId) return false;
  if (ctx.actor.roles.includes('founder')) return true;
  const target = await loadTarget(ctx, { userId: subjectUserId });
  return rankOf(target.roles) < rankOf(ctx.actor.roles);
}
