import { and, eq, inArray, ne, or, type SQL } from 'drizzle-orm';
import { members } from '@jave/database';
import type { ServiceContext } from '../kernel/context';
import { can } from '../permissions/authorize';

/**
 * Staff (canViewPrivateProfiles) see every member, including moderation
 * standing and staff-only profiles. Everyone else sees what core
 * getProfile would show them.
 */
export function viewsPrivateProfiles(ctx: Pick<ServiceContext, 'actor'>): boolean {
  return can(ctx, 'canViewPrivateProfiles');
}

/**
 * The SQL form of getProfile's canSeeProfile, for lists: undefined for staff
 * (no restriction); otherwise never banned members or staff-only profiles,
 * `members` profiles only for signed-in members with canViewMembers, and the
 * viewer's own row always.
 */
export function visibleProfilesCondition(ctx: Pick<ServiceContext, 'actor'>): SQL | undefined {
  if (viewsPrivateProfiles(ctx)) return undefined;
  const signedInMember = ctx.actor.kind === 'user' && can(ctx, 'canViewMembers');
  const visibility = signedInMember
    ? inArray(members.profileVisibility, ['public', 'members'])
    : eq(members.profileVisibility, 'public');
  const visible = and(ne(members.standing, 'banned'), visibility)!;
  const selfId = ctx.actor.kind === 'user' ? ctx.actor.memberId : null;
  return selfId ? or(eq(members.id, selfId), visible)! : visible;
}
