import { and, asc, count, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { achievementDefinitions, missionAssignments, missions, members } from '@jave/database';
import type { ServiceContext } from '../kernel/context';
import type { Page } from '../kernel/pagination';
import { parseInput } from '../kernel/validation';
import { actorMemberId } from '../permissions/actor';
import { authorize, isSelf, requireMember } from '../permissions/authorize';
import { getProfile } from '../identity/profile.service';
import {
  type AssignmentStatus,
  formatMissionNumber,
  type MissionStatus,
  type MissionType,
  remainingSlots,
  SLOT_STATUSES,
} from './rules';
import {
  listOpenMissionsSchema,
  memberHistorySchema,
  missionIdSchema,
  myMissionsSchema,
  reviewQueueSchema,
} from './schemas';
import {
  type AssignmentRecord,
  isMissionStaff,
  loadVisibleMission,
  type MissionRecord,
} from './store';

/** Submitted rows scanned when building the review queue. */
export const REVIEW_QUEUE_SCAN_LIMIT = 500;
/** Upper bound on assignments returned by listMyMissions. */
export const MY_MISSIONS_LIMIT = 200;

export type MissionReward =
  { hidden: false; key: string; title: string; rarity: string } | { hidden: true; rarity: string };

export interface MissionSummary {
  id: string;
  number: string;
  title: string;
  brief: string;
  type: MissionType;
  status: MissionStatus;
  facetKey: string | null;
  evidenceRequired: boolean;
  reward: MissionReward | null;
  rewardNote: string | null;
  maxAssignees: number | null;
  selfAssignable: boolean;
  deadlineAt: Date | null;
  durationHours: number | null;
  publishedAt: Date | null;
}

type RewardRow = Pick<
  typeof achievementDefinitions.$inferSelect,
  'key' | 'title' | 'rarity' | 'visibility'
> | null;

function toReward(reward: RewardRow, revealHidden: boolean): MissionReward | null {
  if (!reward) return null;
  if (reward.visibility === 'hidden' && !revealHidden)
    return { hidden: true, rarity: reward.rarity };
  return { hidden: false, key: reward.key, title: reward.title, rarity: reward.rarity };
}

function toSummary(mission: MissionRecord, reward: RewardRow, staff: boolean): MissionSummary {
  return {
    id: mission.id,
    number: formatMissionNumber(mission.number),
    title: mission.title,
    brief: mission.brief,
    type: mission.type,
    status: mission.status,
    facetKey: mission.facetKey,
    evidenceRequired: mission.evidenceRequired,
    reward: toReward(reward, staff),
    rewardNote: mission.rewardNote,
    maxAssignees: mission.maxAssignees,
    selfAssignable: mission.selfAssignable,
    deadlineAt: mission.deadlineAt,
    durationHours: mission.durationHours,
    publishedAt: mission.publishedAt,
  };
}

const rewardColumns = {
  key: achievementDefinitions.key,
  title: achievementDefinitions.title,
  rarity: achievementDefinitions.rarity,
  visibility: achievementDefinitions.visibility,
};

async function slotsTakenFor(ctx: ServiceContext, missionIds: string[]) {
  if (missionIds.length === 0) return new Map<string, number>();
  const rows = await ctx.db
    .select({ missionId: missionAssignments.missionId, taken: count() })
    .from(missionAssignments)
    .where(
      and(
        inArray(missionAssignments.missionId, missionIds),
        inArray(missionAssignments.status, [...SLOT_STATUSES]),
      ),
    )
    .groupBy(missionAssignments.missionId);
  return new Map(rows.map((row) => [row.missionId, row.taken]));
}

/** The assignee's own view of an assignment. */
export interface OwnAssignmentView {
  id: string;
  status: AssignmentStatus;
  teamKey: string | null;
  assignedAt: Date;
  acceptedAt: Date | null;
  dueAt: Date | null;
  submittedAt: Date | null;
  submission: string | null;
  evidenceTitle: string | null;
  evidenceUrl: string | null;
  attempts: number;
  feedback: string | null;
  verifiedAt: Date | null;
}

function toOwnView(row: AssignmentRecord): OwnAssignmentView {
  return {
    id: row.id,
    status: row.status,
    teamKey: row.teamKey,
    assignedAt: row.assignedAt,
    acceptedAt: row.acceptedAt,
    dueAt: row.dueAt,
    submittedAt: row.submittedAt,
    submission: row.submission,
    evidenceTitle: row.submissionEvidenceTitle,
    evidenceUrl: row.submissionEvidenceUrl,
    attempts: row.attempts,
    feedback: row.feedback,
    verifiedAt: row.verifiedAt,
  };
}

export interface OpenMissionItem extends MissionSummary {
  slotsLeft: number | null;
  myAssignment: { id: string; status: AssignmentStatus } | null;
}

/** Open missions for any member, newest first, with the viewer's own status. */
export async function listOpenMissions(
  ctx: ServiceContext,
  input: z.input<typeof listOpenMissionsSchema> = {},
): Promise<Page<OpenMissionItem>> {
  const query = parseInput(listOpenMissionsSchema, input);
  const actor = requireMember(ctx);
  const staff = isMissionStaff(ctx);
  const where = and(
    eq(missions.status, 'open'),
    query.type ? eq(missions.type, query.type) : undefined,
  );
  const [rows, [total]] = await Promise.all([
    ctx.db
      .select({ mission: missions, reward: rewardColumns })
      .from(missions)
      .leftJoin(
        achievementDefinitions,
        eq(achievementDefinitions.key, missions.rewardAchievementKey),
      )
      .where(where)
      .orderBy(desc(missions.publishedAt), desc(missions.number))
      .limit(query.limit)
      .offset(query.offset),
    ctx.db.select({ value: count() }).from(missions).where(where),
  ]);
  const ids = rows.map((row) => row.mission.id);
  const [taken, mine] = await Promise.all([
    slotsTakenFor(ctx, ids),
    ids.length === 0
      ? Promise.resolve([])
      : ctx.db
          .select({
            id: missionAssignments.id,
            missionId: missionAssignments.missionId,
            status: missionAssignments.status,
          })
          .from(missionAssignments)
          .where(
            and(
              inArray(missionAssignments.missionId, ids),
              eq(missionAssignments.memberId, actor.memberId),
            ),
          ),
  ]);
  const mineByMission = new Map(mine.map((row) => [row.missionId, row]));
  return {
    items: rows.map(({ mission, reward }) => {
      const own = mineByMission.get(mission.id);
      return {
        ...toSummary(mission, reward, staff),
        slotsLeft: remainingSlots(mission.maxAssignees, taken.get(mission.id) ?? 0),
        myAssignment: own ? { id: own.id, status: own.status } : null,
      };
    }),
    total: total?.value ?? 0,
    limit: query.limit,
    offset: query.offset,
  };
}

const ACTIVE_STATUSES: readonly AssignmentStatus[] = [
  'assigned',
  'accepted',
  'submitted',
  'rejected',
];

export interface MyMissionItem {
  mission: MissionSummary;
  assignment: OwnAssignmentView;
}

/** The acting member's missions: active (default), completed, or all. */
export async function listMyMissions(
  ctx: ServiceContext,
  input: z.input<typeof myMissionsSchema> = {},
): Promise<MyMissionItem[]> {
  const { scope } = parseInput(myMissionsSchema, input);
  const actor = requireMember(ctx);
  const statusFilter =
    scope === 'active'
      ? inArray(missionAssignments.status, [...ACTIVE_STATUSES])
      : scope === 'completed'
        ? eq(missionAssignments.status, 'verified')
        : undefined;
  const rows = await ctx.db
    .select({ assignment: missionAssignments, mission: missions, reward: rewardColumns })
    .from(missionAssignments)
    .innerJoin(missions, eq(missions.id, missionAssignments.missionId))
    .leftJoin(achievementDefinitions, eq(achievementDefinitions.key, missions.rewardAchievementKey))
    .where(and(eq(missionAssignments.memberId, actor.memberId), statusFilter))
    .orderBy(sql`${missionAssignments.dueAt} asc nulls last`, desc(missionAssignments.assignedAt))
    .limit(MY_MISSIONS_LIMIT);
  return rows.map(({ assignment, mission, reward }) => ({
    mission: toSummary(mission, reward, false),
    assignment: toOwnView(assignment),
  }));
}

export interface StaffAssignmentView extends OwnAssignmentView {
  memberId: string;
  memberHandle: string;
  memberDisplayName: string;
  submittedByMemberId: string | null;
  reviewedAt: Date | null;
}

export interface MissionDetail {
  mission: MissionSummary;
  assigneeCount: number;
  slotsLeft: number | null;
  /** The viewer's own assignment, if any. */
  myAssignment: OwnAssignmentView | null;
  /** Staff only (canManageMissions / canVerifyMissions); null for everyone else. */
  assignments: StaffAssignmentView[] | null;
}

/**
 * Mission detail. Members see open and closed missions with counts and their
 * own assignment only; assignee identities and submissions are staff-only.
 */
export async function getMissionDetail(
  ctx: ServiceContext,
  input: z.input<typeof missionIdSchema>,
): Promise<MissionDetail> {
  const { missionId } = parseInput(missionIdSchema, input);
  const staff = isMissionStaff(ctx);
  if (!staff) requireMember(ctx);
  const mission = await loadVisibleMission(ctx, missionId);
  const viewer = actorMemberId(ctx.actor);
  const [[reward], rows] = await Promise.all([
    mission.rewardAchievementKey
      ? ctx.db
          .select(rewardColumns)
          .from(achievementDefinitions)
          .where(eq(achievementDefinitions.key, mission.rewardAchievementKey))
      : Promise.resolve([null]),
    ctx.db
      .select({ assignment: missionAssignments, handle: members.handle, name: members.displayName })
      .from(missionAssignments)
      .innerJoin(members, eq(members.id, missionAssignments.memberId))
      .where(eq(missionAssignments.missionId, missionId))
      .orderBy(asc(missionAssignments.assignedAt)),
  ]);
  const holding = rows.filter((row) =>
    (SLOT_STATUSES as readonly string[]).includes(row.assignment.status),
  ).length;
  const own = rows.find((row) => row.assignment.memberId === viewer)?.assignment ?? null;
  return {
    mission: toSummary(mission, reward ?? null, staff),
    assigneeCount: holding,
    slotsLeft: remainingSlots(mission.maxAssignees, holding),
    myAssignment: own ? toOwnView(own) : null,
    assignments: staff
      ? rows.map(({ assignment, handle, name }) => ({
          ...toOwnView(assignment),
          memberId: assignment.memberId,
          memberHandle: handle,
          memberDisplayName: name,
          submittedByMemberId: assignment.submittedByMemberId,
          reviewedAt: assignment.reviewedAt,
        }))
      : null,
  };
}

export interface MissionHistoryItem {
  missionId: string;
  number: string;
  title: string;
  type: MissionType;
  facetKey: string | null;
  status: AssignmentStatus;
  assignedAt: Date;
  verifiedAt: Date | null;
  /** Self and staff only. */
  assignment: OwnAssignmentView | null;
}

/**
 * A member's mission record. The member and mission staff see every
 * assignment with its detail. Everyone else sees only verified missions, and
 * only when the member's profile is visible to them (identity rules).
 */
export async function getMemberMissionHistory(
  ctx: ServiceContext,
  input: z.input<typeof memberHistorySchema>,
): Promise<MissionHistoryItem[]> {
  const query = parseInput(memberHistorySchema, input);
  const full = isSelf(ctx.actor, query.memberId) || isMissionStaff(ctx);
  if (!full) await getProfile(ctx, { memberId: query.memberId });
  const rows = await ctx.db
    .select({ assignment: missionAssignments, mission: missions })
    .from(missionAssignments)
    .innerJoin(missions, eq(missions.id, missionAssignments.missionId))
    .where(
      and(
        eq(missionAssignments.memberId, query.memberId),
        full ? undefined : eq(missionAssignments.status, 'verified'),
      ),
    )
    .orderBy(desc(missionAssignments.assignedAt))
    .limit(query.limit);
  return rows.map(({ assignment, mission }) => ({
    missionId: mission.id,
    number: formatMissionNumber(mission.number),
    title: mission.title,
    type: mission.type,
    facetKey: mission.facetKey,
    status: assignment.status,
    assignedAt: assignment.assignedAt,
    verifiedAt: assignment.verifiedAt,
    assignment: full ? toOwnView(assignment) : null,
  }));
}

export interface ReviewQueueItem {
  /** Review this id: for team missions it stands for the whole team. */
  assignmentId: string;
  missionId: string;
  missionNumber: string;
  missionTitle: string;
  teamKey: string | null;
  members: { memberId: string; handle: string; displayName: string }[];
  submittedAt: Date | null;
  submission: string | null;
  evidenceTitle: string | null;
  evidenceUrl: string | null;
  attempts: number;
  /** True when the reviewer is part of this unit and therefore may not review it. */
  isOwn: boolean;
}

/** Submissions awaiting review, oldest first, one entry per unit (team or individual). */
export async function listSubmissionsForReview(
  ctx: ServiceContext,
  input: z.input<typeof reviewQueueSchema> = {},
): Promise<Page<ReviewQueueItem>> {
  const query = parseInput(reviewQueueSchema, input);
  await authorize(ctx, 'canVerifyMissions', { type: 'mission_assignment' });
  const viewer = actorMemberId(ctx.actor);
  const rows = await ctx.db
    .select({
      assignment: missionAssignments,
      mission: missions,
      handle: members.handle,
      name: members.displayName,
    })
    .from(missionAssignments)
    .innerJoin(missions, eq(missions.id, missionAssignments.missionId))
    .innerJoin(members, eq(members.id, missionAssignments.memberId))
    .where(eq(missionAssignments.status, 'submitted'))
    .orderBy(asc(missionAssignments.submittedAt), asc(missionAssignments.id))
    .limit(REVIEW_QUEUE_SCAN_LIMIT);
  // The reviewer's own units, whatever their own assignment's state (an abandoned teammate
  // is still part of the team and may not review it).
  const ownTeams = viewer
    ? await ctx.db
        .select({ missionId: missionAssignments.missionId, teamKey: missionAssignments.teamKey })
        .from(missionAssignments)
        .where(and(eq(missionAssignments.memberId, viewer), isNotNull(missionAssignments.teamKey)))
    : [];
  const ownTeamKeys = new Set(ownTeams.map((row) => `${row.missionId}:${row.teamKey}`));
  const units = new Map<string, ReviewQueueItem>();
  for (const { assignment, mission, handle, name } of rows) {
    const unitKey = assignment.teamKey ? `${mission.id}:${assignment.teamKey}` : assignment.id;
    const entry = units.get(unitKey) ?? {
      assignmentId: assignment.id,
      missionId: mission.id,
      missionNumber: formatMissionNumber(mission.number),
      missionTitle: mission.title,
      teamKey: assignment.teamKey,
      members: [],
      submittedAt: assignment.submittedAt,
      submission: assignment.submission,
      evidenceTitle: assignment.submissionEvidenceTitle,
      evidenceUrl: assignment.submissionEvidenceUrl,
      attempts: assignment.attempts,
      isOwn: ownTeamKeys.has(unitKey),
    };
    entry.members.push({ memberId: assignment.memberId, handle, displayName: name });
    entry.isOwn = entry.isOwn || assignment.memberId === viewer;
    units.set(unitKey, entry);
  }
  const all = [...units.values()];
  return {
    items: all.slice(query.offset, query.offset + query.limit),
    total: all.length,
    limit: query.limit,
    offset: query.offset,
  };
}
