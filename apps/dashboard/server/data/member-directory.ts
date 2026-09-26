import 'server-only';
import { and, asc, count, desc, eq, ilike, inArray, isNull, ne, or, type SQL, sql } from 'drizzle-orm';
import type { z } from 'zod';
import {
  authorize,
  avatarUrl,
  can,
  highestRole,
  listMembers,
  listMembersSchema,
  type MemberListItem,
  type OrgRole,
  type Page,
  parseInput,
  type ServiceContext,
} from '@jave/core';
import { memberRoles, members, users } from '@jave/database';

const DIRECTORY_AVATAR_SIZE = 64;

export type DirectoryQuery = z.input<typeof listMembersSchema>;

/** A directory row as the viewer may see it. Moderation standing is staff-only (null otherwise). */
export type DirectoryMember = Omit<MemberListItem, 'standing'> & {
  standing: MemberListItem['standing'] | null;
};

export interface MemberDirectory {
  page: Page<DirectoryMember>;
  /** Staff view (canViewPrivateProfiles): standing, the standing filter and staff-only profiles. */
  staffView: boolean;
}

/**
 * The member directory under the same privacy rules as a member's profile
 * (core getProfile / canSeeProfile):
 *  - staff (canViewPrivateProfiles) get core `listMembers` unchanged;
 *  - everyone else never sees or filters by moderation standing, and lists
 *    only members whose profile they could open — never banned members or
 *    staff-only profiles (their own row always stays visible).
 * Authorization (canViewMembers) is enforced on both paths.
 */
export async function loadMemberDirectory(
  ctx: ServiceContext,
  query: DirectoryQuery,
): Promise<MemberDirectory> {
  if (can(ctx, 'canViewPrivateProfiles')) {
    return { page: await listMembers(ctx, query), staffView: true };
  }
  return { page: await listVisibleMembers(ctx, query), staffView: false };
}

/** Rows a non-staff viewer may see: mirrors core canSeeProfile for viewers without canViewPrivateProfiles. */
function visibleToViewer(ctx: ServiceContext): SQL {
  const visibility =
    ctx.actor.kind === 'user'
      ? inArray(members.profileVisibility, ['public', 'members'])
      : eq(members.profileVisibility, 'public');
  const visible = and(ne(members.standing, 'banned'), visibility)!;
  const selfId = ctx.actor.kind === 'user' ? ctx.actor.memberId : null;
  return selfId ? or(eq(members.id, selfId), visible)! : visible;
}

/**
 * The non-staff directory query. Search, role, guild-status, sort and
 * paging mirror core `listMembers`; the standing filter is ignored and
 * standing is never returned.
 */
async function listVisibleMembers(
  ctx: ServiceContext,
  input: DirectoryQuery,
): Promise<Page<DirectoryMember>> {
  await authorize(ctx, 'canViewMembers');
  const q = parseInput(listMembersSchema, { ...input, standing: undefined });
  const filters: SQL[] = [isNull(members.deletedAt), visibleToViewer(ctx)];
  if (q.search) {
    const pattern = `%${q.search.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    filters.push(
      or(
        ilike(members.displayName, pattern),
        ilike(members.handle, pattern),
        ilike(users.username, pattern),
      )!,
    );
  }
  if (q.guildStatus) filters.push(eq(members.guildStatus, q.guildStatus));
  if (q.role) {
    filters.push(
      inArray(
        members.id,
        ctx.db
          .select({ id: memberRoles.memberId })
          .from(memberRoles)
          .where(and(eq(memberRoles.role, q.role), isNull(memberRoles.revokedAt))),
      ),
    );
  }
  const where = and(...filters);
  const order =
    q.sort === 'name'
      ? [asc(members.displayName)]
      : q.sort === 'joined_asc'
        ? [asc(members.joinedGuildAt), asc(members.createdAt)]
        : [desc(members.joinedGuildAt), desc(members.createdAt)];

  const [rows, [total]] = await Promise.all([
    ctx.db
      .select({
        id: members.id,
        handle: members.handle,
        displayName: members.displayName,
        discordId: users.discordId,
        avatarHash: users.avatarHash,
        guildStatus: members.guildStatus,
        onboardingState: members.onboardingState,
        joinedGuildAt: members.joinedGuildAt,
        roles: sql<
          OrgRole[]
        >`coalesce((select array_agg(mr.role::text) from member_roles mr where mr.member_id = ${members.id} and mr.revoked_at is null and (mr.expires_at is null or mr.expires_at > now())), '{}')`,
        verifiedCapabilities: sql<number>`(select count(*)::int from member_capabilities mc where mc.member_id = ${members.id} and mc.verified_rank is not null)`,
      })
      .from(members)
      .innerJoin(users, eq(users.id, members.userId))
      .where(where)
      .orderBy(...order)
      .limit(q.limit)
      .offset(q.offset),
    ctx.db
      .select({ value: count() })
      .from(members)
      .innerJoin(users, eq(users.id, members.userId))
      .where(where),
  ]);
  return {
    items: rows.map((row) => ({
      id: row.id,
      handle: row.handle,
      displayName: row.displayName,
      discordId: row.discordId,
      avatarUrl: avatarUrl(row.discordId, row.avatarHash, DIRECTORY_AVATAR_SIZE),
      roles: row.roles,
      primaryRole: highestRole(row.roles),
      guildStatus: row.guildStatus,
      standing: null,
      onboardingState: row.onboardingState,
      joinedGuildAt: row.joinedGuildAt,
      verifiedCapabilities: row.verifiedCapabilities,
    })),
    total: total?.value ?? 0,
    limit: q.limit,
    offset: q.offset,
  };
}
