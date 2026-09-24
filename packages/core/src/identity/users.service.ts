import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNull,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import { z } from 'zod';
import { guildMemberEvents, memberRoles, members, users } from '@jave/database';
import type { ServiceContext } from '../kernel/context';
import type { Database } from '@jave/database';
import { NotFoundError, isUniqueViolation } from '../kernel/errors';
import { snowflakeToDate } from '../kernel/ids';
import { type Page, pageSchema } from '../kernel/pagination';
import { parseInput } from '../kernel/validation';
import { recordAudit } from '../audit/audit.service';
import { publishEvent } from '../events/bus';
import { enqueueJob } from '../jobs/queue';
import type { UserActor } from '../permissions/actor';
import { authorize } from '../permissions/authorize';
import { capabilitiesForRoles, RESTRICTED_CAPABILITIES } from '../permissions/capabilities';
import { highestRole, type OrgRole, ROLE_KEYS } from '../permissions/roles';
import { avatarUrl, type DiscordProfile, handleFromUsername } from './discord';

export type UserRecord = typeof users.$inferSelect;
export type MemberRecord = typeof members.$inferSelect;

export const DISCORD_ROLE_SYNC_JOB = 'discord.roles.sync';

/** Insert or refresh a Discord account. Only writes when something changed. */
export async function upsertDiscordUser(
  ctx: ServiceContext,
  profile: DiscordProfile,
): Promise<UserRecord> {
  const [existing] = await ctx.db
    .select()
    .from(users)
    .where(eq(users.discordId, profile.discordId));
  const values = {
    username: profile.username.slice(0, 64),
    displayName: profile.displayName?.slice(0, 64) ?? null,
    avatarHash: profile.avatarHash ?? null,
  };
  if (existing) {
    const changed =
      existing.username !== values.username ||
      existing.displayName !== values.displayName ||
      existing.avatarHash !== values.avatarHash ||
      existing.deletedAt !== null;
    if (!changed) return existing;
    const [updated] = await ctx.db
      .update(users)
      .set({ ...values, deletedAt: null })
      .where(eq(users.id, existing.id))
      .returning();
    return updated!;
  }
  try {
    const [created] = await ctx.db
      .insert(users)
      .values({
        discordId: profile.discordId,
        ...values,
        isBot: profile.isBot ?? false,
        discordCreatedAt: snowflakeToDate(profile.discordId),
      })
      .returning();
    return created!;
  } catch (error) {
    // Concurrent first contact: the other writer won.
    if (!isUniqueViolation(error)) throw error;
    const [row] = await ctx.db.select().from(users).where(eq(users.discordId, profile.discordId));
    if (!row) throw error;
    return row;
  }
}

async function availableHandle(db: Database, desired: string): Promise<string> {
  const rows = await db
    .select({ handle: members.handle })
    .from(members)
    .where(or(eq(members.handle, desired), ilike(members.handle, `${desired}-%`)));
  const taken = new Set(rows.map((r) => r.handle));
  if (!taken.has(desired)) return desired;
  for (let i = 2; i < 10_000; i++) {
    const candidate = `${desired}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${desired}-${Date.now().toString(36)}`;
}

/** Active (non-revoked, non-expired) roles for a member. */
export async function activeRoles(
  ctx: Pick<ServiceContext, 'db' | 'clock'>,
  memberId: string,
): Promise<OrgRole[]> {
  const now = ctx.clock.now();
  const rows = await ctx.db
    .select({ role: memberRoles.role })
    .from(memberRoles)
    .where(
      and(
        eq(memberRoles.memberId, memberId),
        isNull(memberRoles.revokedAt),
        or(isNull(memberRoles.expiresAt), gt(memberRoles.expiresAt, now)),
      ),
    );
  return rows.map((r) => r.role);
}

/**
 * Ensure a JAVELIN member record exists for a user. New members receive the
 * MEMBER role; configured founder IDs are bootstrapped to FOUNDER.
 */
export async function ensureMember(
  ctx: ServiceContext,
  user: UserRecord,
  options: { inGuild: boolean; joinedAt?: Date } = { inGuild: true },
): Promise<MemberRecord> {
  const [existing] = await ctx.db.select().from(members).where(eq(members.userId, user.id));
  let member = existing;
  if (!member) {
    const handle = await availableHandle(ctx.db, handleFromUsername(user.username));
    try {
      const [created] = await ctx.db
        .insert(members)
        .values({
          userId: user.id,
          handle,
          displayName: (user.displayName ?? user.username).slice(0, 64),
          guildStatus: options.inGuild ? 'present' : 'never_joined',
          joinedGuildAt: options.inGuild ? (options.joinedAt ?? ctx.clock.now()) : null,
        })
        .returning();
      member = created!;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const [row] = await ctx.db.select().from(members).where(eq(members.userId, user.id));
      if (!row) throw error;
      return row;
    }
    if (options.inGuild) {
      await ctx.db
        .insert(memberRoles)
        .values({ memberId: member.id, role: 'member', reason: 'joined' })
        .onConflictDoNothing();
    }
  }
  if (ctx.config.founderDiscordIds.includes(user.discordId)) {
    const roles = await activeRoles(ctx, member.id);
    if (!roles.includes('founder')) {
      await ctx.db
        .insert(memberRoles)
        .values({
          memberId: member.id,
          role: 'founder',
          reason: 'bootstrap: JAVE_FOUNDER_DISCORD_IDS',
        })
        .onConflictDoNothing();
      await recordAudit(ctx, {
        action: 'role.bootstrap_granted',
        targetType: 'member',
        targetId: member.id,
        context: { role: 'founder' },
      });
      await enqueueJob(
        ctx,
        DISCORD_ROLE_SYNC_JOB,
        { memberId: member.id },
        { dedupeKey: `roles-sync:${member.id}` },
      );
    }
  }
  return member;
}

/** First-contact helper for the bot: user row + member row, idempotent. */
export async function syncDiscordUser(
  ctx: ServiceContext,
  profile: DiscordProfile,
  options: { inGuild: boolean },
): Promise<{ user: UserRecord; member: MemberRecord }> {
  const user = await upsertDiscordUser(ctx, profile);
  const member = await ensureMember(ctx, user, { inGuild: options.inGuild });
  return { user, member };
}

/** Build the authorization actor for a user from their current roles and standing. */
export async function resolveUserActor(
  ctx: Pick<ServiceContext, 'db' | 'clock'>,
  userId: string,
): Promise<UserActor> {
  const [row] = await ctx.db
    .select({ user: users, member: members })
    .from(users)
    .leftJoin(members, eq(members.userId, users.id))
    .where(eq(users.id, userId));
  if (!row) throw new NotFoundError('User');
  const { user, member } = row;
  const roles = member && !member.deletedAt ? await activeRoles(ctx, member.id) : [];
  const standing = member?.standing ?? 'good';
  let capabilities = capabilitiesForRoles(roles);
  if (standing === 'banned' || standing === 'quarantined') capabilities = new Set();
  if (standing === 'restricted') {
    capabilities = new Set([...capabilities].filter((c) => RESTRICTED_CAPABILITIES.includes(c)));
  }
  return {
    kind: 'user',
    userId: user.id,
    discordId: user.discordId,
    memberId: member && !member.deletedAt ? member.id : null,
    displayName: member?.displayName ?? user.displayName ?? user.username,
    roles,
    standing,
    capabilities,
  };
}

export async function findUserByDiscordId(
  ctx: ServiceContext,
  discordId: string,
): Promise<UserRecord | null> {
  const [row] = await ctx.db.select().from(users).where(eq(users.discordId, discordId));
  return row ?? null;
}

export async function findMemberByDiscordId(
  ctx: ServiceContext,
  discordId: string,
): Promise<(MemberRecord & { discordId: string }) | null> {
  const [row] = await ctx.db
    .select({ member: members, discordId: users.discordId })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(and(eq(users.discordId, discordId), isNull(members.deletedAt)));
  return row ? { ...row.member, discordId: row.discordId } : null;
}

export async function getMemberById(ctx: ServiceContext, memberId: string): Promise<MemberRecord> {
  const [row] = await ctx.db
    .select()
    .from(members)
    .where(and(eq(members.id, memberId), isNull(members.deletedAt)));
  if (!row) throw new NotFoundError('Member');
  return row;
}

/** Record a guild join (bot: guildMemberAdd). */
export async function recordGuildJoin(
  ctx: ServiceContext,
  profile: DiscordProfile,
): Promise<{ user: UserRecord; member: MemberRecord; accountAgeDays: number; rejoin: boolean }> {
  const now = ctx.clock.now();
  const user = await upsertDiscordUser(ctx, profile);
  const [previous] = await ctx.db.select().from(members).where(eq(members.userId, user.id));
  const member = await ensureMember(ctx, user, { inGuild: true, joinedAt: now });
  const rejoin = Boolean(previous && previous.guildStatus !== 'present');
  if (rejoin) {
    await ctx.db
      .update(members)
      .set({ guildStatus: 'present', joinedGuildAt: now, leftGuildAt: null })
      .where(eq(members.id, member.id));
    await enqueueJob(
      ctx,
      DISCORD_ROLE_SYNC_JOB,
      { memberId: member.id },
      { dedupeKey: `roles-sync:${member.id}` },
    );
  }
  const accountAgeDays = Math.floor(
    (now.getTime() - snowflakeToDate(profile.discordId).getTime()) / 86_400_000,
  );
  await ctx.db
    .insert(guildMemberEvents)
    .values({ userId: user.id, type: 'join', accountAgeDays, occurredAt: now });
  await publishEvent(ctx, {
    type: 'member.joined',
    aggregateType: 'member',
    aggregateId: member.id,
    subjectMemberId: member.id,
    payload: { accountAgeDays, rejoin },
  });
  return { user, member: { ...member, guildStatus: 'present' }, accountAgeDays, rejoin };
}

/** Record a guild leave (bot: guildMemberRemove). Unknown users are ignored. */
export async function recordGuildLeave(
  ctx: ServiceContext,
  discordId: string,
): Promise<MemberRecord | null> {
  const user = await findUserByDiscordId(ctx, discordId);
  if (!user) return null;
  const now = ctx.clock.now();
  await ctx.db
    .insert(guildMemberEvents)
    .values({ userId: user.id, type: 'leave', occurredAt: now });
  const [member] = await ctx.db
    .update(members)
    .set({ guildStatus: 'departed', leftGuildAt: now })
    .where(eq(members.userId, user.id))
    .returning();
  if (!member) return null;
  await publishEvent(ctx, {
    type: 'member.left',
    aggregateType: 'member',
    aggregateId: member.id,
    subjectMemberId: member.id,
  });
  return member;
}

export const listMembersSchema = pageSchema.extend({
  search: z.string().trim().max(64).optional(),
  role: z.enum(ROLE_KEYS as [OrgRole, ...OrgRole[]]).optional(),
  guildStatus: z.enum(['present', 'departed', 'never_joined']).optional(),
  standing: z.enum(['good', 'restricted', 'quarantined', 'banned']).optional(),
  sort: z.enum(['joined_desc', 'joined_asc', 'name']).default('joined_desc'),
});

export interface MemberListItem {
  id: string;
  handle: string;
  displayName: string;
  discordId: string;
  avatarUrl: string;
  roles: OrgRole[];
  primaryRole: OrgRole | null;
  guildStatus: MemberRecord['guildStatus'];
  standing: MemberRecord['standing'];
  onboardingState: MemberRecord['onboardingState'];
  joinedGuildAt: Date | null;
  verifiedCapabilities: number;
}

export async function listMembers(
  ctx: ServiceContext,
  input: z.input<typeof listMembersSchema>,
): Promise<Page<MemberListItem>> {
  await authorize(ctx, 'canViewMembers');
  const q = parseInput(listMembersSchema, input);
  const filters: SQL[] = [isNull(members.deletedAt)];
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
  if (q.standing) filters.push(eq(members.standing, q.standing));
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
        standing: members.standing,
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
      avatarUrl: avatarUrl(row.discordId, row.avatarHash, 64),
      roles: row.roles,
      primaryRole: highestRole(row.roles),
      guildStatus: row.guildStatus,
      standing: row.standing,
      onboardingState: row.onboardingState,
      joinedGuildAt: row.joinedGuildAt,
      verifiedCapabilities: row.verifiedCapabilities,
    })),
    total: total?.value ?? 0,
    limit: q.limit,
    offset: q.offset,
  };
}
