import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { evidence, missionAssignments } from '@jave/database';
import { type ServiceContext, withActor, withTransaction } from '../kernel/context';
import {
  ConflictError,
  ForbiddenError,
  InvalidStateError,
  ValidationError,
} from '../kernel/errors';
import { parseInput } from '../kernel/validation';
import { recordAudit } from '../audit/audit.service';
import { publishEvent } from '../events/bus';
import { notify } from '../notifications/notifications.service';
import { actorMemberId, actorUserId, systemActor } from '../permissions/actor';
import { authorize } from '../permissions/authorize';
import { awardAchievementFromSystem } from '../achievements/award.service';
import {
  type AssignmentStatus,
  formatMissionNumber,
  isPast,
  MAX_SUBMISSION_ATTEMPTS,
  reviewNotificationKey,
  SUBMITTABLE_STATUSES,
  WORKING_STATUSES,
} from './rules';
import {
  EVIDENCE_TITLE_MAX,
  rejectSubmissionSchema,
  submitMissionSchema,
  verifySubmissionSchema,
} from './schemas';
import {
  type AssignmentRecord,
  type AssignmentWithMission,
  loadAssignment,
  loadMission,
  loadOwnAssignment,
  type MissionRecord,
  recipientUserIds,
  requireParticipant,
  unitMemberIds,
} from './store';

/**
 * Lock the unit of work an assignment belongs to (the whole team for team
 * missions) in the given states. Rows are locked in id order, so teammates
 * submitting or being reviewed at the same moment queue instead of deadlocking.
 */
async function lockUnit(
  tx: ServiceContext,
  assignment: AssignmentRecord,
  statuses: readonly AssignmentStatus[],
): Promise<AssignmentRecord[]> {
  const scope = assignment.teamKey
    ? and(
        eq(missionAssignments.missionId, assignment.missionId),
        eq(missionAssignments.teamKey, assignment.teamKey),
      )
    : eq(missionAssignments.id, assignment.id);
  return tx.db
    .select()
    .from(missionAssignments)
    .where(and(scope, inArray(missionAssignments.status, [...statuses])))
    .orderBy(asc(missionAssignments.id))
    .for('update');
}

/**
 * Send (or resend after a rejection) the work for an accepted assignment. On
 * a team mission one submission moves every teammate still working to
 * SUBMITTED. Evidence (title + http(s) URL) is required when the mission says so.
 */
export async function submitMission(
  ctx: ServiceContext,
  input: z.input<typeof submitMissionSchema>,
): Promise<AssignmentRecord> {
  const data = parseInput(submitMissionSchema, input);
  const actor = requireParticipant(ctx);
  const { assignment, mission } = await loadOwnAssignment(ctx, data.assignmentId, actor.memberId);
  if (mission.status === 'archived') throw new InvalidStateError('This mission is archived.');
  if (assignment.status === 'assigned')
    throw new InvalidStateError('Accept the mission before submitting.');
  if (!(SUBMITTABLE_STATUSES as readonly string[]).includes(assignment.status))
    throw new InvalidStateError('This assignment cannot take a submission now.');
  const now = ctx.clock.now();
  if (isPast(assignment.dueAt, now)) throw new InvalidStateError('The deadline has passed.');
  if (assignment.attempts >= MAX_SUBMISSION_ATTEMPTS)
    throw new InvalidStateError('No submission attempts left.');
  if (mission.evidenceRequired && !data.evidence)
    throw new ValidationError('evidence: this mission requires evidence (title and URL)');

  return withTransaction(ctx, async (tx) => {
    // Conflicts with archiveMission's update lock: a submission never slips in
    // between the archive's "nothing awaits review" check and the archive
    // itself. A share lock, so submissions on one mission do not queue.
    const current = await loadMission(tx, mission.id, { lock: 'share' });
    if (current.status === 'archived') throw new InvalidStateError('This mission is archived.');
    const unit = await lockUnit(tx, assignment, WORKING_STATUSES);
    const own = unit.find((row) => row.id === assignment.id);
    if (!own || !(SUBMITTABLE_STATUSES as readonly string[]).includes(own.status))
      throw new ConflictError('This assignment changed. Refresh and try again.');
    if (own.attempts >= MAX_SUBMISSION_ATTEMPTS)
      throw new InvalidStateError('No submission attempts left.');
    const updated = await tx.db
      .update(missionAssignments)
      .set({
        status: 'submitted',
        submittedAt: now,
        submission: data.submission,
        submissionEvidenceTitle: data.evidence?.title ?? null,
        submissionEvidenceUrl: data.evidence?.url ?? null,
        submittedByMemberId: actor.memberId,
        attempts: sql`${missionAssignments.attempts} + 1`,
        acceptedAt: sql`coalesce(${missionAssignments.acceptedAt}, ${now.toISOString()}::timestamptz)`,
      })
      .where(
        inArray(
          missionAssignments.id,
          unit.map((row) => row.id),
        ),
      )
      .returning();
    await publishEvent(tx, {
      type: 'mission.submitted',
      aggregateType: 'mission',
      aggregateId: mission.id,
      subjectMemberId: actor.memberId,
      payload: {
        assignmentIds: updated.map((row) => row.id),
        teamKey: assignment.teamKey,
        attempt: own.attempts + 1,
      },
    });
    return updated.find((row) => row.id === assignment.id)!;
  });
}

/**
 * Load a submitted assignment for review and enforce that the reviewer is not
 * part of the unit (self-review is blocked and audited).
 */
async function loadForReview(
  ctx: ServiceContext,
  assignmentId: string,
): Promise<AssignmentWithMission> {
  const row = await loadAssignment(ctx, assignmentId);
  if (row.assignment.status !== 'submitted')
    throw new InvalidStateError('Only submitted work can be reviewed.');
  const reviewer = actorMemberId(ctx.actor);
  const unit = await unitMemberIds(ctx, row.assignment);
  if (reviewer && unit.includes(reviewer)) {
    await recordAudit(
      ctx,
      {
        action: 'mission.self_review_blocked',
        targetType: 'mission_assignment',
        targetId: assignmentId,
        result: 'denied',
        context: { missionId: row.mission.id },
      },
      { durable: true },
    );
    throw new ForbiddenError('You cannot review your own mission. Another reviewer must do it.');
  }
  return row;
}

/** Lock the submitted unit and re-check, under lock, that it is still reviewable by this actor. */
async function lockUnitForReview(
  tx: ServiceContext,
  assignment: AssignmentRecord,
): Promise<AssignmentRecord[]> {
  const unit = await lockUnit(tx, assignment, ['submitted']);
  if (!unit.some((row) => row.id === assignment.id))
    throw new ConflictError('This submission changed while you were reviewing it.');
  const reviewer = actorMemberId(tx.actor);
  if (reviewer && unit.some((row) => row.memberId === reviewer))
    throw new ForbiddenError('You cannot review your own mission. Another reviewer must do it.');
  return unit;
}

function evidenceTitle(mission: MissionRecord): string {
  return `Mission ${formatMissionNumber(mission.number)}: ${mission.title}`.slice(
    0,
    EVIDENCE_TITLE_MAX,
  );
}

/**
 * Verify a submission (canVerifyMissions; never your own or your team's).
 * For every member of the unit: VERIFIED, an accepted evidence row (kind
 * mission, the mission's facet), mission.completed, a notification, and the
 * reward achievement granted by the achievements module as the system.
 */
export async function verifySubmission(
  ctx: ServiceContext,
  input: z.input<typeof verifySubmissionSchema>,
): Promise<AssignmentRecord[]> {
  const data = parseInput(verifySubmissionSchema, input);
  await authorize(ctx, 'canVerifyMissions', { type: 'mission_assignment', id: data.assignmentId });
  const { assignment, mission } = await loadForReview(ctx, data.assignmentId);
  const reviewer = actorUserId(ctx.actor);

  return withTransaction(ctx, async (tx) => {
    const now = tx.clock.now();
    const unit = await lockUnitForReview(tx, assignment);
    const recipients = await recipientUserIds(
      tx,
      unit.map((row) => row.memberId),
    );
    const verified: AssignmentRecord[] = [];
    for (const target of unit) {
      const [proof] = await tx.db
        .insert(evidence)
        .values({
          memberId: target.memberId,
          kind: 'mission',
          title: evidenceTitle(mission),
          url: target.submissionEvidenceUrl,
          description: target.submission,
          facetKey: mission.facetKey,
          sourceType: 'mission',
          sourceId: mission.id,
          status: 'accepted',
          reviewedByUserId: reviewer,
          reviewedAt: now,
          createdAt: now,
        })
        .returning({ id: evidence.id });
      const [row] = await tx.db
        .update(missionAssignments)
        .set({
          status: 'verified',
          verifiedAt: now,
          verifiedByUserId: reviewer,
          reviewedAt: now,
          reviewedByUserId: reviewer,
          feedback: data.feedback ?? null,
          evidenceId: proof!.id,
        })
        .where(eq(missionAssignments.id, target.id))
        .returning();
      verified.push(row!);
      await publishEvent(tx, {
        type: 'mission.completed',
        aggregateType: 'mission',
        aggregateId: mission.id,
        subjectMemberId: target.memberId,
        payload: {
          assignmentId: target.id,
          type: mission.type,
          facetKey: mission.facetKey,
          teamKey: target.teamKey,
          evidenceId: proof!.id,
        },
      });
      const userId = recipients.get(target.memberId);
      if (userId) {
        await notify(tx, {
          recipientUserId: userId,
          type: 'mission.reviewed',
          title: 'MISSION VERIFIED',
          body: `${formatMissionNumber(mission.number)} — ${mission.title}. Verified and on your record.${data.feedback ? ` Feedback: ${data.feedback}` : ''}`,
          data: { missionId: mission.id, assignmentId: target.id, outcome: 'verified' },
          dedupeKey: reviewNotificationKey(target),
        });
      }
      if (mission.rewardAchievementKey) {
        await awardAchievementFromSystem(withActor(tx, systemActor('mission reward')), {
          memberId: target.memberId,
          key: mission.rewardAchievementKey,
          reason: `Mission ${formatMissionNumber(mission.number)} verified.`,
        });
      }
    }
    await recordAudit(tx, {
      action: 'mission.verified',
      targetType: 'mission',
      targetId: mission.id,
      context: {
        assignmentIds: verified.map((row) => row.id),
        memberIds: verified.map((row) => row.memberId),
        teamKey: assignment.teamKey,
      },
    });
    return verified;
  });
}

/**
 * Return a submission with feedback (canVerifyMissions; never your own or
 * your team's). The unit may resubmit until attempts run out or it is due.
 */
export async function rejectSubmission(
  ctx: ServiceContext,
  input: z.input<typeof rejectSubmissionSchema>,
): Promise<AssignmentRecord[]> {
  const data = parseInput(rejectSubmissionSchema, input);
  await authorize(ctx, 'canVerifyMissions', { type: 'mission_assignment', id: data.assignmentId });
  const { assignment, mission } = await loadForReview(ctx, data.assignmentId);
  const reviewer = actorUserId(ctx.actor);

  return withTransaction(ctx, async (tx) => {
    const now = tx.clock.now();
    const unit = await lockUnitForReview(tx, assignment);
    const rejected = await tx.db
      .update(missionAssignments)
      .set({
        status: 'rejected',
        reviewedAt: now,
        reviewedByUserId: reviewer,
        feedback: data.feedback,
      })
      .where(
        inArray(
          missionAssignments.id,
          unit.map((row) => row.id),
        ),
      )
      .returning();
    const recipients = await recipientUserIds(
      tx,
      rejected.map((row) => row.memberId),
    );
    for (const target of rejected) {
      await publishEvent(tx, {
        type: 'mission.rejected',
        aggregateType: 'mission',
        aggregateId: mission.id,
        subjectMemberId: target.memberId,
        payload: { assignmentId: target.id, teamKey: target.teamKey, attempts: target.attempts },
      });
      const userId = recipients.get(target.memberId);
      if (!userId) continue;
      const attemptsLeft = Math.max(0, MAX_SUBMISSION_ATTEMPTS - target.attempts);
      await notify(tx, {
        recipientUserId: userId,
        type: 'mission.reviewed',
        title: 'MISSION RETURNED',
        body: `${formatMissionNumber(mission.number)} — ${mission.title}. Feedback: ${data.feedback} ${attemptsLeft > 0 ? `${attemptsLeft} attempt(s) left.` : 'No attempts left.'}`,
        data: { missionId: mission.id, assignmentId: target.id, outcome: 'rejected' },
        dedupeKey: reviewNotificationKey(target),
      });
    }
    await recordAudit(tx, {
      action: 'mission.rejected',
      targetType: 'mission',
      targetId: mission.id,
      context: {
        assignmentIds: rejected.map((row) => row.id),
        teamKey: assignment.teamKey,
        feedback: data.feedback,
      },
    });
    return rejected;
  });
}
