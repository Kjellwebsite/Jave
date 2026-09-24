import { and, count, eq, inArray } from 'drizzle-orm';
import {
  achievementDefinitions,
  missionAssignments,
  missions,
  members,
  users,
} from '@jave/database';
import type { ServiceContext } from '../kernel/context';
import { ForbiddenError, NotFoundError, ValidationError } from '../kernel/errors';
import { can, requireMember } from '../permissions/authorize';
import type { UserActor } from '../permissions/actor';
import { isValidFacet, loadCatalog } from '../identity/ranks';
import { SLOT_STATUSES } from './rules';

export type MissionRecord = typeof missions.$inferSelect;
export type AssignmentRecord = typeof missionAssignments.$inferSelect;

/** Staff who run missions see drafts, archives and assignee identities. */
export function isMissionStaff(ctx: ServiceContext): boolean {
  return can(ctx, 'canManageMissions') || can(ctx, 'canVerifyMissions');
}

/** A member acting on their own missions must be in good standing. */
export function requireParticipant(ctx: ServiceContext): UserActor & { memberId: string } {
  const actor = requireMember(ctx);
  if (actor.standing !== 'good')
    throw new ForbiddenError('Your standing does not allow mission work right now.');
  return actor;
}

export async function loadMission(
  ctx: ServiceContext,
  missionId: string,
  options: { forUpdate?: boolean } = {},
): Promise<MissionRecord> {
  const query = ctx.db.select().from(missions).where(eq(missions.id, missionId));
  const [row] = options.forUpdate ? await query.for('update') : await query;
  if (!row) throw new NotFoundError('Mission');
  return row;
}

/** Drafts and archived missions do not exist for non-staff viewers. */
export async function loadVisibleMission(
  ctx: ServiceContext,
  missionId: string,
): Promise<MissionRecord> {
  const mission = await loadMission(ctx, missionId);
  if (!isMissionStaff(ctx) && (mission.status === 'draft' || mission.status === 'archived'))
    throw new NotFoundError('Mission');
  return mission;
}

export interface AssignmentWithMission {
  assignment: AssignmentRecord;
  mission: MissionRecord;
}

export async function loadAssignment(
  ctx: ServiceContext,
  assignmentId: string,
): Promise<AssignmentWithMission> {
  const [row] = await ctx.db
    .select({ assignment: missionAssignments, mission: missions })
    .from(missionAssignments)
    .innerJoin(missions, eq(missions.id, missionAssignments.missionId))
    .where(eq(missionAssignments.id, assignmentId));
  if (!row) throw new NotFoundError('Assignment');
  return row;
}

/**
 * Load an assignment the acting member owns. Someone else's assignment is
 * reported as not found so ids cannot be probed.
 */
export async function loadOwnAssignment(
  ctx: ServiceContext,
  assignmentId: string,
  memberId: string,
): Promise<AssignmentWithMission> {
  const row = await loadAssignment(ctx, assignmentId);
  if (row.assignment.memberId !== memberId) throw new NotFoundError('Assignment');
  return row;
}

/** Assignments that hold a slot against maxAssignees. */
export async function countSlotsTaken(ctx: ServiceContext, missionId: string): Promise<number> {
  const [row] = await ctx.db
    .select({ value: count() })
    .from(missionAssignments)
    .where(
      and(
        eq(missionAssignments.missionId, missionId),
        inArray(missionAssignments.status, [...SLOT_STATUSES]),
      ),
    );
  return row?.value ?? 0;
}

/** Every assignment on a team, whatever its state. */
export async function teamAssignments(
  ctx: ServiceContext,
  missionId: string,
  teamKey: string,
): Promise<AssignmentRecord[]> {
  return ctx.db
    .select()
    .from(missionAssignments)
    .where(
      and(eq(missionAssignments.missionId, missionId), eq(missionAssignments.teamKey, teamKey)),
    );
}

/** The member ids that share an assignment's unit of work (the team, or just the assignee). */
export async function unitMemberIds(
  ctx: ServiceContext,
  assignment: AssignmentRecord,
): Promise<string[]> {
  if (!assignment.teamKey) return [assignment.memberId];
  const team = await teamAssignments(ctx, assignment.missionId, assignment.teamKey);
  return team.map((row) => row.memberId);
}

export async function recipientUserIds(
  ctx: ServiceContext,
  memberIds: readonly string[],
): Promise<Map<string, string>> {
  if (memberIds.length === 0) return new Map();
  const rows = await ctx.db
    .select({ memberId: members.id, userId: users.id })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(inArray(members.id, [...memberIds]));
  return new Map(rows.map((row) => [row.memberId, row.userId]));
}

/** Facet and reward references must point at live catalog entries. */
export async function assertMissionReferences(
  ctx: ServiceContext,
  refs: { facetKey?: string | null; rewardAchievementKey?: string | null },
): Promise<void> {
  if (refs.facetKey) {
    const catalog = await loadCatalog(ctx);
    if (!isValidFacet(catalog, refs.facetKey)) throw new ValidationError('Unknown capability.');
  }
  if (refs.rewardAchievementKey) {
    const [definition] = await ctx.db
      .select({ active: achievementDefinitions.active })
      .from(achievementDefinitions)
      .where(eq(achievementDefinitions.key, refs.rewardAchievementKey));
    if (!definition?.active)
      throw new ValidationError('rewardAchievementKey: unknown or inactive achievement');
  }
}
