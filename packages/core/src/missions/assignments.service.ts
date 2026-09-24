import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import { missionAssignments, members } from '@jave/database';
import { type ServiceContext, withTransaction } from '../kernel/context';
import { ConflictError, InvalidStateError, ValidationError } from '../kernel/errors';
import { parseInput } from '../kernel/validation';
import { recordAudit } from '../audit/audit.service';
import { publishEvent } from '../events/bus';
import { notify } from '../notifications/notifications.service';
import { actorUserId } from '../permissions/actor';
import { authorize } from '../permissions/authorize';
import {
  type AssignmentStatus,
  formatMissionNumber,
  isPast,
  REASSIGNABLE_STATUSES,
  resolveDueAt,
  WORKING_STATUSES,
} from './rules';
import { assignMissionSchema, assignmentIdSchema, missionIdSchema } from './schemas';
import {
  type AssignmentRecord,
  countSlotsTaken,
  loadMission,
  loadOwnAssignment,
  loadVisibleMission,
  type MissionRecord,
  requireParticipant,
} from './store';

export type AssignSkipReason =
  'not_found' | 'ineligible' | 'already_assigned' | 'completed' | 'mission_full';

export interface AssignResult {
  assigned: AssignmentRecord[];
  skipped: { memberId: string; reason: AssignSkipReason }[];
}

/** Values that (re)start an assignment from scratch. */
function freshAssignment(values: {
  status: AssignmentStatus;
  teamKey: string | null;
  assignedByUserId: string | null;
  now: Date;
  dueAt: Date | null;
}) {
  return {
    status: values.status,
    teamKey: values.teamKey,
    assignedByUserId: values.assignedByUserId,
    assignedAt: values.now,
    acceptedAt: values.status === 'accepted' ? values.now : null,
    dueAt: values.dueAt,
    submittedAt: null,
    submission: null,
    submissionEvidenceTitle: null,
    submissionEvidenceUrl: null,
    submittedByMemberId: null,
    attempts: 0,
    evidenceId: null,
    verifiedByUserId: null,
    verifiedAt: null,
    reviewedByUserId: null,
    reviewedAt: null,
    feedback: null,
    reminderDueAt: null,
  };
}

/** "2026-03-04T12:00" — the minute-precision prefix of an ISO timestamp. */
const ISO_MINUTE_LENGTH = 16;

function assignedCopy(mission: MissionRecord, dueAt: Date | null): string {
  const due = dueAt
    ? ` Due ${dueAt.toISOString().slice(0, ISO_MINUTE_LENGTH).replace('T', ' ')} UTC.`
    : '';
  return `${formatMissionNumber(mission.number)} — ${mission.title}.${due} Accept it to start.`;
}

/**
 * Staff assign an OPEN mission to members (canManageMissions). Team missions
 * need a team key; members sharing it submit together. Members that cannot
 * take the mission are reported in `skipped` rather than failing the batch.
 * Previously abandoned or expired assignments are restarted.
 */
export async function assignMission(
  ctx: ServiceContext,
  input: z.input<typeof assignMissionSchema>,
): Promise<AssignResult> {
  const data = parseInput(assignMissionSchema, input);
  await authorize(ctx, 'canManageMissions', { type: 'mission', id: data.missionId });
  const mission = await loadMission(ctx, data.missionId);
  if (mission.status !== 'open')
    throw new InvalidStateError('Publish the mission before assigning it.');
  if (mission.type === 'team' && !data.teamKey)
    throw new ValidationError('teamKey: team missions need a team key');
  if (mission.type !== 'team' && data.teamKey)
    throw new ValidationError('teamKey: only team missions take a team key');
  const now = ctx.clock.now();
  const assigner = actorUserId(ctx.actor);

  return withTransaction(ctx, async (tx) => {
    // Re-read under lock: a concurrent close or cap change must win over this batch.
    const locked = await loadMission(tx, mission.id, { forUpdate: true });
    if (locked.status !== 'open')
      throw new InvalidStateError('Publish the mission before assigning it.');
    const dueAt = resolveDueAt({
      now,
      explicitDueAt: data.dueAt ?? null,
      durationHours: data.durationHours ?? locked.durationHours,
      deadlineAt: locked.deadlineAt,
    });
    const [targets, prior] = await Promise.all([
      tx.db
        .select({ id: members.id, userId: members.userId, standing: members.standing })
        .from(members)
        .where(and(inArray(members.id, data.memberIds), isNull(members.deletedAt))),
      tx.db
        .select()
        .from(missionAssignments)
        .where(
          and(
            eq(missionAssignments.missionId, mission.id),
            inArray(missionAssignments.memberId, data.memberIds),
          ),
        ),
    ]);
    const targetById = new Map(targets.map((row) => [row.id, row]));
    const priorByMember = new Map(prior.map((row) => [row.memberId, row]));
    let taken = await countSlotsTaken(tx, mission.id);
    const result: AssignResult = { assigned: [], skipped: [] };

    for (const memberId of data.memberIds) {
      const member = targetById.get(memberId);
      const previous = priorByMember.get(memberId);
      const skip = (reason: AssignSkipReason) => result.skipped.push({ memberId, reason });
      if (!member) {
        skip('not_found');
        continue;
      }
      if (member.standing !== 'good') {
        skip('ineligible');
        continue;
      }
      if (previous && !(REASSIGNABLE_STATUSES as readonly string[]).includes(previous.status)) {
        skip(previous.status === 'verified' ? 'completed' : 'already_assigned');
        continue;
      }
      if (locked.maxAssignees !== null && taken >= locked.maxAssignees) {
        skip('mission_full');
        continue;
      }
      const values = freshAssignment({
        status: 'assigned',
        teamKey: data.teamKey ?? null,
        assignedByUserId: assigner,
        now,
        dueAt,
      });
      const [row] = previous
        ? await tx.db
            .update(missionAssignments)
            .set(values)
            .where(eq(missionAssignments.id, previous.id))
            .returning()
        : await tx.db
            .insert(missionAssignments)
            .values({ missionId: mission.id, memberId, ...values, createdAt: now })
            .returning();
      const assignment = row!;
      taken++;
      result.assigned.push(assignment);
      await publishEvent(tx, {
        type: 'mission.assigned',
        aggregateType: 'mission',
        aggregateId: mission.id,
        subjectMemberId: memberId,
        payload: {
          assignmentId: assignment.id,
          teamKey: assignment.teamKey,
          dueAt: dueAt?.toISOString() ?? null,
          selfAssigned: false,
        },
      });
      await notify(tx, {
        recipientUserId: member.userId,
        type: 'mission.assigned',
        title: 'MISSION ASSIGNED',
        body: assignedCopy(locked, dueAt),
        data: { missionId: mission.id, assignmentId: assignment.id },
        dedupeKey: `mission-assigned:${assignment.id}:${now.getTime()}`,
      });
    }
    if (result.assigned.length > 0) {
      await recordAudit(tx, {
        action: 'mission.assigned',
        targetType: 'mission',
        targetId: mission.id,
        context: {
          memberIds: result.assigned.map((a) => a.memberId),
          teamKey: data.teamKey ?? null,
          dueAt: dueAt?.toISOString() ?? null,
          skipped: result.skipped,
        },
      });
    }
    return result;
  });
}

/**
 * A member takes an OPEN, self-assignable mission (the Discord ACCEPT button).
 * Starts ACCEPTED. Refused after the deadline, when full, when the member
 * already holds or completed it, or when they previously walked away from it.
 */
export async function selfAssignMission(
  ctx: ServiceContext,
  input: z.input<typeof missionIdSchema>,
): Promise<AssignmentRecord> {
  const { missionId } = parseInput(missionIdSchema, input);
  const actor = requireParticipant(ctx);
  const mission = await loadVisibleMission(ctx, missionId);
  if (mission.status !== 'open') throw new InvalidStateError('This mission is not open.');
  if (mission.type === 'team' || !mission.selfAssignable)
    throw new InvalidStateError('This mission is assigned by staff.');
  const now = ctx.clock.now();
  if (isPast(mission.deadlineAt, now))
    throw new InvalidStateError('The mission deadline has passed.');

  return withTransaction(ctx, async (tx) => {
    const locked = await loadMission(tx, mission.id, { forUpdate: true });
    if (locked.status !== 'open') throw new InvalidStateError('This mission is not open.');
    if (locked.type === 'team' || !locked.selfAssignable)
      throw new InvalidStateError('This mission is assigned by staff.');
    const dueAt = resolveDueAt({
      now,
      explicitDueAt: null,
      durationHours: locked.durationHours,
      deadlineAt: locked.deadlineAt,
    });
    const [previous] = await tx.db
      .select()
      .from(missionAssignments)
      .where(
        and(
          eq(missionAssignments.missionId, mission.id),
          eq(missionAssignments.memberId, actor.memberId),
        ),
      );
    if (previous?.status === 'verified')
      throw new ConflictError('You already completed this mission.');
    if (previous && (REASSIGNABLE_STATUSES as readonly string[]).includes(previous.status))
      throw new InvalidStateError('You left this mission. Ask staff to reassign you.');
    if (previous) throw new ConflictError('You are already on this mission.');
    const taken = await countSlotsTaken(tx, mission.id);
    if (locked.maxAssignees !== null && taken >= locked.maxAssignees)
      throw new ConflictError('This mission is full.');
    const [row] = await tx.db
      .insert(missionAssignments)
      .values({
        missionId: mission.id,
        memberId: actor.memberId,
        ...freshAssignment({
          status: 'accepted',
          teamKey: null,
          assignedByUserId: null,
          now,
          dueAt,
        }),
        createdAt: now,
      })
      .returning();
    const assignment = row!;
    await publishEvent(tx, {
      type: 'mission.assigned',
      aggregateType: 'mission',
      aggregateId: mission.id,
      subjectMemberId: actor.memberId,
      payload: {
        assignmentId: assignment.id,
        teamKey: null,
        dueAt: dueAt?.toISOString() ?? null,
        selfAssigned: true,
      },
    });
    return assignment;
  });
}

/** The assignee accepts a staff assignment (ASSIGNED → ACCEPTED). */
export async function acceptMission(
  ctx: ServiceContext,
  input: z.input<typeof assignmentIdSchema>,
): Promise<AssignmentRecord> {
  const { assignmentId } = parseInput(assignmentIdSchema, input);
  const actor = requireParticipant(ctx);
  const { assignment, mission } = await loadOwnAssignment(ctx, assignmentId, actor.memberId);
  if (mission.status === 'archived') throw new InvalidStateError('This mission is archived.');
  if (assignment.status !== 'assigned')
    throw new InvalidStateError('Only a new assignment can be accepted.');
  const now = ctx.clock.now();
  if (isPast(assignment.dueAt, now)) throw new InvalidStateError('The deadline has passed.');
  return withTransaction(ctx, async (tx) => {
    const [row] = await tx.db
      .update(missionAssignments)
      .set({ status: 'accepted', acceptedAt: now })
      .where(
        and(eq(missionAssignments.id, assignmentId), eq(missionAssignments.status, 'assigned')),
      )
      .returning();
    if (!row) throw new ConflictError('This assignment changed. Refresh and try again.');
    await publishEvent(tx, {
      type: 'mission.accepted',
      aggregateType: 'mission',
      aggregateId: mission.id,
      subjectMemberId: actor.memberId,
      payload: { assignmentId },
    });
    return row;
  });
}

/** The assignee walks away (ASSIGNED / ACCEPTED / REJECTED → ABANDONED). Only staff can restart it. */
export async function abandonMission(
  ctx: ServiceContext,
  input: z.input<typeof assignmentIdSchema>,
): Promise<AssignmentRecord> {
  const { assignmentId } = parseInput(assignmentIdSchema, input);
  const actor = requireParticipant(ctx);
  const { assignment, mission } = await loadOwnAssignment(ctx, assignmentId, actor.memberId);
  if (!(WORKING_STATUSES as readonly string[]).includes(assignment.status))
    throw new InvalidStateError('Only a mission in progress can be abandoned.');
  return withTransaction(ctx, async (tx) => {
    const [row] = await tx.db
      .update(missionAssignments)
      .set({ status: 'abandoned' })
      .where(
        and(
          eq(missionAssignments.id, assignmentId),
          inArray(missionAssignments.status, [...WORKING_STATUSES]),
        ),
      )
      .returning();
    if (!row) throw new ConflictError('This assignment changed. Refresh and try again.');
    await publishEvent(tx, {
      type: 'mission.abandoned',
      aggregateType: 'mission',
      aggregateId: mission.id,
      subjectMemberId: actor.memberId,
      payload: { assignmentId, teamKey: row.teamKey },
    });
    return row;
  });
}
