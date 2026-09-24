import { and, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  achievementDefinitions,
  contributions,
  memberAchievements,
  memberCapabilities,
  memberNotes,
  members,
  missionAssignments,
  projectMembers,
  projects,
  trialResults,
  users,
} from '@jave/database';
import type { ServiceContext } from '../kernel/context';
import { ConflictError, NotFoundError, isUniqueViolation } from '../kernel/errors';
import { parseInput } from '../kernel/validation';
import { recordAudit } from '../audit/audit.service';
import { publishEvent } from '../events/bus';
import { authorize, can, isSelf, requireMember } from '../permissions/authorize';
import { highestRole, isStaffRole, type OrgRole } from '../permissions/roles';
import { avatarUrl, HANDLE_PATTERN } from './discord';
import { type DomainSummary, loadCatalog, summarizeDomains } from './ranks';
import { activeRoles, getMemberById, type MemberRecord } from './users.service';

export type ProfileRef = { memberId: string } | { handle: string } | { discordId: string };

export interface ProfileStats {
  trials: number;
  trialsPassed: number;
  projects: number;
  projectsShipped: number;
  contributions: number;
  missionsCompleted: number;
  achievements: number;
}

export interface ProfileAchievement {
  key: string;
  title: string;
  description: string;
  rarity: string;
  awardedAt: Date;
  verified: boolean;
}

export interface ProfileView {
  memberId: string;
  handle: string;
  displayName: string;
  headline: string | null;
  bio: string | null;
  avatarUrl: string;
  discordId: string;
  primaryDomain: string | null;
  roles: OrgRole[];
  primaryRole: OrgRole | null;
  /** VERIFIED badge: holds VERIFIED or a staff role. */
  isVerifiedMember: boolean;
  profileVisibility: MemberRecord['profileVisibility'];
  guildStatus: MemberRecord['guildStatus'];
  onboardingState: MemberRecord['onboardingState'];
  /** Only populated for staff viewers. */
  standing: MemberRecord['standing'] | null;
  joinedAt: Date | null;
  domains: DomainSummary[];
  /** False when claims are hidden from this viewer by the member's privacy settings. */
  claimsVisible: boolean;
  stats: ProfileStats;
  achievements: ProfileAchievement[];
  isSelf: boolean;
  viewerIsStaff: boolean;
}

async function findMember(ctx: ServiceContext, ref: ProfileRef) {
  const condition =
    'memberId' in ref
      ? eq(members.id, ref.memberId)
      : 'handle' in ref
        ? eq(members.handle, ref.handle.toLowerCase())
        : eq(users.discordId, ref.discordId);
  const [row] = await ctx.db
    .select({ member: members, user: users })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(and(condition, isNull(members.deletedAt)));
  return row ?? null;
}

/** Whether the viewer may see a profile at all. Invisible profiles are reported as not found. */
function canSeeProfile(ctx: ServiceContext, member: MemberRecord): boolean {
  if (isSelf(ctx.actor, member.id)) return true;
  if (can(ctx, 'canViewPrivateProfiles')) return true;
  if (member.standing === 'banned') return false;
  switch (member.profileVisibility) {
    case 'public':
      return true;
    case 'members':
      return ctx.actor.kind === 'user' && can(ctx, 'canViewMembers');
    case 'staff':
      return false;
  }
}

export async function computeProfileStats(
  ctx: ServiceContext,
  memberId: string,
): Promise<ProfileStats> {
  const [[trials], [projectRows], [contribs], [missions], [achievements]] = await Promise.all([
    ctx.db
      .select({
        total: sql<number>`count(*)::int`,
        passed: sql<number>`count(*) filter (where ${trialResults.outcome} in ('pass', 'distinction'))::int`,
      })
      .from(trialResults)
      .where(
        and(eq(trialResults.memberId, memberId), sql`${trialResults.publishedAt} is not null`),
      ),
    ctx.db
      .select({
        total: sql<number>`count(distinct ${projects.id})::int`,
        shipped: sql<number>`count(distinct ${projects.id}) filter (where ${projects.status} = 'shipped')::int`,
      })
      .from(projectMembers)
      .innerJoin(projects, eq(projects.id, projectMembers.projectId))
      .where(
        and(
          eq(projectMembers.memberId, memberId),
          isNull(projectMembers.leftAt),
          isNull(projects.deletedAt),
        ),
      ),
    ctx.db
      .select({ value: count() })
      .from(contributions)
      .where(and(eq(contributions.memberId, memberId), eq(contributions.status, 'verified'))),
    ctx.db
      .select({ value: count() })
      .from(missionAssignments)
      .where(
        and(eq(missionAssignments.memberId, memberId), eq(missionAssignments.status, 'verified')),
      ),
    ctx.db
      .select({ value: count() })
      .from(memberAchievements)
      .where(and(eq(memberAchievements.memberId, memberId), isNull(memberAchievements.revokedAt))),
  ]);
  return {
    trials: trials?.total ?? 0,
    trialsPassed: trials?.passed ?? 0,
    projects: projectRows?.total ?? 0,
    projectsShipped: projectRows?.shipped ?? 0,
    contributions: contribs?.value ?? 0,
    missionsCompleted: missions?.value ?? 0,
    achievements: achievements?.value ?? 0,
  };
}

/**
 * Profile view with privacy enforced for the current viewer:
 *  - visibility public/members/staff gates the whole profile
 *  - `showClaimsPublicly = false` hides CLAIMED ranks from everyone but self and staff
 *  - hidden achievements appear only once unlocked
 */
export async function getProfile(ctx: ServiceContext, ref: ProfileRef): Promise<ProfileView> {
  const row = await findMember(ctx, ref);
  if (!row || !canSeeProfile(ctx, row.member)) throw new NotFoundError('Profile');
  const { member, user } = row;
  const self = isSelf(ctx.actor, member.id);
  const staffViewer = can(ctx, 'canViewPrivateProfiles');
  const claimsVisible = self || staffViewer || member.showClaimsPublicly;

  const [catalog, roles, capabilityRows, stats, achievementRows] = await Promise.all([
    loadCatalog(ctx),
    activeRoles(ctx, member.id),
    ctx.db
      .select({
        facetKey: memberCapabilities.facetKey,
        claimedRank: memberCapabilities.claimedRank,
        verifiedRank: memberCapabilities.verifiedRank,
      })
      .from(memberCapabilities)
      .where(eq(memberCapabilities.memberId, member.id)),
    computeProfileStats(ctx, member.id),
    ctx.db
      .select({
        key: achievementDefinitions.key,
        title: achievementDefinitions.title,
        description: achievementDefinitions.description,
        rarity: achievementDefinitions.rarity,
        awardedAt: memberAchievements.awardedAt,
        verification: memberAchievements.verification,
      })
      .from(memberAchievements)
      .innerJoin(
        achievementDefinitions,
        eq(achievementDefinitions.key, memberAchievements.achievementKey),
      )
      .where(and(eq(memberAchievements.memberId, member.id), isNull(memberAchievements.revokedAt)))
      .orderBy(desc(memberAchievements.awardedAt))
      .limit(50),
  ]);

  const states = capabilityRows.map((r) => ({
    ...r,
    claimedRank: claimsVisible ? r.claimedRank : null,
  }));
  return {
    memberId: member.id,
    handle: member.handle,
    displayName: member.displayName,
    headline: member.headline,
    bio: member.bio,
    avatarUrl: avatarUrl(user.discordId, user.avatarHash),
    discordId: user.discordId,
    primaryDomain: member.primaryDomain,
    roles,
    primaryRole: highestRole(roles),
    isVerifiedMember: roles.some((r) => r === 'verified' || isStaffRole(r)),
    profileVisibility: member.profileVisibility,
    guildStatus: member.guildStatus,
    onboardingState: member.onboardingState,
    standing: staffViewer ? member.standing : null,
    joinedAt: member.joinedGuildAt,
    domains: summarizeDomains(catalog, states),
    claimsVisible,
    stats,
    achievements: achievementRows.map((a) => ({
      key: a.key,
      title: a.title,
      description: a.description,
      rarity: a.rarity,
      awardedAt: a.awardedAt,
      verified: a.verification === 'verified',
    })),
    isSelf: self,
    viewerIsStaff: staffViewer,
  };
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

export const updateProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(64).optional(),
  handle: z
    .string()
    .trim()
    .toLowerCase()
    .regex(HANDLE_PATTERN, 'Handle: 2–32 chars, a–z, 0–9, - or _')
    .optional(),
  headline: optionalText(160),
  bio: optionalText(2000),
  primaryDomain: z.enum(['mind', 'create', 'body', 'life', 'bio']).nullable().optional(),
  profileVisibility: z.enum(['public', 'members', 'staff']).optional(),
  showClaimsPublicly: z.boolean().optional(),
  showOnLeaderboards: z.boolean().optional(),
});

export async function updateProfile(
  ctx: ServiceContext,
  memberId: string,
  input: z.input<typeof updateProfileSchema>,
): Promise<MemberRecord> {
  if (!isSelf(ctx.actor, memberId))
    await authorize(ctx, 'canManageMembers', { type: 'member', id: memberId });
  const data = parseInput(updateProfileSchema, input);
  await getMemberById(ctx, memberId);
  const patch = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
  if (Object.keys(patch).length === 0) return getMemberById(ctx, memberId);
  try {
    const [updated] = await ctx.db
      .update(members)
      .set(patch)
      .where(eq(members.id, memberId))
      .returning();
    if (!isSelf(ctx.actor, memberId)) {
      await recordAudit(ctx, {
        action: 'member.profile_edited',
        targetType: 'member',
        targetId: memberId,
        context: { fields: Object.keys(patch) },
      });
    }
    await publishEvent(ctx, {
      type: 'member.profile_updated',
      aggregateType: 'member',
      aggregateId: memberId,
      subjectMemberId: memberId,
      payload: { fields: Object.keys(patch) },
    });
    return updated!;
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError('That handle is taken.');
    throw error;
  }
}

export const onboardingSchema = z.object({
  displayName: z.string().trim().min(1).max(64),
  headline: z.string().trim().max(160).optional(),
  primaryDomain: z.enum(['mind', 'create', 'body', 'life', 'bio']),
  profileVisibility: z.enum(['public', 'members', 'staff']).default('members'),
});

/** Complete onboarding for the acting member. Idempotent. */
export async function completeOnboarding(
  ctx: ServiceContext,
  input: z.input<typeof onboardingSchema>,
) {
  const actor = requireMember(ctx);
  const data = parseInput(onboardingSchema, input);
  const member = await getMemberById(ctx, actor.memberId);
  const first = member.onboardingState !== 'completed';
  const [updated] = await ctx.db
    .update(members)
    .set({
      displayName: data.displayName,
      headline: data.headline || null,
      primaryDomain: data.primaryDomain,
      profileVisibility: data.profileVisibility,
      onboardingState: 'completed',
      onboardedAt: member.onboardedAt ?? ctx.clock.now(),
    })
    .where(eq(members.id, member.id))
    .returning();
  if (first) {
    await publishEvent(ctx, {
      type: 'member.onboarded',
      aggregateType: 'member',
      aggregateId: member.id,
      subjectMemberId: member.id,
      payload: { primaryDomain: data.primaryDomain },
    });
  }
  return updated!;
}

export async function addMemberNote(ctx: ServiceContext, memberId: string, body: string) {
  await authorize(ctx, 'canManageMembers', { type: 'member', id: memberId });
  const text = parseInput(z.string().trim().min(1).max(4000), body);
  await getMemberById(ctx, memberId);
  const actor = ctx.actor.kind === 'user' ? ctx.actor.userId : null;
  if (!actor) throw new NotFoundError('Author');
  const [row] = await ctx.db
    .insert(memberNotes)
    .values({ memberId, authorUserId: actor, body: text })
    .returning();
  await recordAudit(ctx, { action: 'member.note_added', targetType: 'member', targetId: memberId });
  return row!;
}

export async function listMemberNotes(ctx: ServiceContext, memberId: string) {
  await authorize(ctx, 'canViewPrivateProfiles', { type: 'member', id: memberId });
  return ctx.db
    .select({
      id: memberNotes.id,
      body: memberNotes.body,
      createdAt: memberNotes.createdAt,
      authorName: sql<string>`coalesce(${users.displayName}, ${users.username})`,
    })
    .from(memberNotes)
    .innerJoin(users, eq(users.id, memberNotes.authorUserId))
    .where(and(eq(memberNotes.memberId, memberId), isNull(memberNotes.deletedAt)))
    .orderBy(desc(memberNotes.createdAt))
    .limit(100);
}

/** Lightweight lookup of display names for a set of member IDs (for rendering lists). */
export async function memberNames(ctx: ServiceContext, memberIds: string[]) {
  if (memberIds.length === 0)
    return new Map<string, { displayName: string; handle: string; discordId: string }>();
  const rows = await ctx.db
    .select({
      id: members.id,
      displayName: members.displayName,
      handle: members.handle,
      discordId: users.discordId,
    })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(inArray(members.id, [...new Set(memberIds)]));
  return new Map(rows.map((r) => [r.id, r]));
}
