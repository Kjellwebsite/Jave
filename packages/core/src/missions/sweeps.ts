import { and, asc, eq, gt, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import { missionAssignments, missions } from '@jave/database';
import { MINUTE } from '../kernel/clock';
import { type ServiceContext, withTransaction } from '../kernel/context';
import { recordAudit } from '../audit/audit.service';
import { publishEvent } from '../events/bus';
import type { JobHandler, RecurringJob } from '../jobs/worker';
import { notify } from '../notifications/notifications.service';
import { scheduleMissionCardRefresh } from './discord-jobs';
import {
  formatMissionNumber,
  hoursLeft,
  MAX_SUBMISSION_ATTEMPTS,
  REMINDER_LEAD_MS,
  shouldRemind,
  WORKING_STATUSES,
} from './rules';
import { type AssignmentRecord, type MissionRecord, recipientUserIds } from './store';

export const MISSION_EXPIRE_JOB = 'missions.expire_overdue';
export const MISSION_REMINDER_JOB = 'missions.deadline_reminders';
export const EXPIRY_SWEEP_EVERY_MS = 5 * MINUTE;
export const REMINDER_SWEEP_EVERY_MS = 15 * MINUTE;
/** Rows handled per sweep; the next run picks up the rest. */
export const SWEEP_BATCH_SIZE = 200;
const MS_PER_SECOND = 1000;

export const missionRecurringJobs: readonly RecurringJob[] = [
  { type: MISSION_EXPIRE_JOB, everyMs: EXPIRY_SWEEP_EVERY_MS },
  { type: MISSION_REMINDER_JOB, everyMs: REMINDER_SWEEP_EVERY_MS },
];

export type ExpiryReason = 'deadline' | 'archived';

const EXPIRY_COPY: Record<ExpiryReason, string> = {
  deadline: 'The deadline passed without a verified submission.',
  archived: 'The mission was archived before a submission arrived.',
};

/**
 * Expire one in-progress assignment (inside the caller's transaction).
 * Guarded on status, so a concurrent submission wins. A deadline expiry is
 * also guarded on the due date, re-checked on the row as it is now: the
 * sweep selects rows outside the transaction, and a row abandoned and
 * re-assigned in between carries a fresh due date that must not be expired.
 * Returns whether it expired.
 */
export async function expireAssignment(
  tx: ServiceContext,
  assignment: Pick<AssignmentRecord, 'id'>,
  mission: Pick<MissionRecord, 'id' | 'number' | 'title'>,
  reason: ExpiryReason,
): Promise<boolean> {
  const stillOverdue =
    reason === 'deadline'
      ? and(isNotNull(missionAssignments.dueAt), lte(missionAssignments.dueAt, tx.clock.now()))
      : undefined;
  const [expired] = await tx.db
    .update(missionAssignments)
    .set({ status: 'expired' })
    .where(
      and(
        eq(missionAssignments.id, assignment.id),
        inArray(missionAssignments.status, [...WORKING_STATUSES]),
        stillOverdue,
      ),
    )
    .returning();
  if (!expired) return false;
  await publishEvent(tx, {
    type: 'mission.expired',
    aggregateType: 'mission',
    aggregateId: mission.id,
    subjectMemberId: expired.memberId,
    payload: { assignmentId: expired.id, reason },
  });
  const recipients = await recipientUserIds(tx, [expired.memberId]);
  const userId = recipients.get(expired.memberId);
  if (userId) {
    await notify(tx, {
      recipientUserId: userId,
      type: 'mission.deadline',
      title: 'MISSION EXPIRED',
      body: `${formatMissionNumber(mission.number)} — ${mission.title}. ${EXPIRY_COPY[reason]}`,
      data: { missionId: mission.id, assignmentId: expired.id },
      dedupeKey: `mission-expired:${expired.id}:${expired.assignedAt.getTime()}`,
    });
  }
  return true;
}

/** Close open missions whose deadline passed. */
async function closeLapsedMissions(ctx: ServiceContext, now: Date): Promise<number> {
  const lapsed = await ctx.db
    .select()
    .from(missions)
    .where(
      and(
        eq(missions.status, 'open'),
        isNotNull(missions.deadlineAt),
        lte(missions.deadlineAt, now),
      ),
    )
    .orderBy(asc(missions.deadlineAt))
    .limit(SWEEP_BATCH_SIZE);
  let closed = 0;
  for (const mission of lapsed) {
    const done = await withTransaction(ctx, async (tx) => {
      const [row] = await tx.db
        .update(missions)
        .set({ status: 'closed', closedAt: now })
        .where(and(eq(missions.id, mission.id), eq(missions.status, 'open')))
        .returning();
      if (!row) return false;
      await recordAudit(tx, {
        action: 'mission.auto_closed',
        targetType: 'mission',
        targetId: row.id,
        context: { deadlineAt: mission.deadlineAt?.toISOString() },
      });
      await publishEvent(tx, {
        type: 'mission.closed',
        aggregateType: 'mission',
        aggregateId: row.id,
        payload: { reason: 'deadline', archived: false },
      });
      await scheduleMissionCardRefresh(tx, row);
      return true;
    });
    if (done) closed++;
  }
  return closed;
}

/** `missions.expire_overdue` — expire overdue in-progress assignments, close lapsed missions. */
export const expireOverdueJob: JobHandler = async (ctx) => {
  const now = ctx.clock.now();
  const overdue = await ctx.db
    .select({ assignment: missionAssignments, mission: missions })
    .from(missionAssignments)
    .innerJoin(missions, eq(missions.id, missionAssignments.missionId))
    .where(
      and(
        inArray(missionAssignments.status, [...WORKING_STATUSES]),
        isNotNull(missionAssignments.dueAt),
        lte(missionAssignments.dueAt, now),
      ),
    )
    .orderBy(asc(missionAssignments.dueAt))
    .limit(SWEEP_BATCH_SIZE);
  let expired = 0;
  for (const { assignment, mission } of overdue) {
    if (await withTransaction(ctx, (tx) => expireAssignment(tx, assignment, mission, 'deadline')))
      expired++;
  }
  const closed = await closeLapsedMissions(ctx, now);
  return { expired, closed };
};

const reminderNotSentForCurrentDueDate = sql`${missionAssignments.reminderDueAt} is distinct from ${missionAssignments.dueAt}`;

/** `missions.deadline_reminders` — one reminder per due date, 24 hours ahead. */
export const deadlineReminderJob: JobHandler = async (ctx) => {
  const now = ctx.clock.now();
  const windowEnd = new Date(now.getTime() + REMINDER_LEAD_MS);
  const leadSeconds = REMINDER_LEAD_MS / MS_PER_SECOND;
  const candidates = await ctx.db
    .select({ assignment: missionAssignments, mission: missions })
    .from(missionAssignments)
    .innerJoin(missions, eq(missions.id, missionAssignments.missionId))
    .where(
      and(
        inArray(missionAssignments.status, [...WORKING_STATUSES]),
        gt(missionAssignments.dueAt, now),
        lte(missionAssignments.dueAt, windowEnd),
        sql`extract(epoch from (${missionAssignments.dueAt} - ${missionAssignments.assignedAt})) > ${leadSeconds}`,
        reminderNotSentForCurrentDueDate,
        sql`not (${missionAssignments.status} = 'rejected' and ${missionAssignments.attempts} >= ${MAX_SUBMISSION_ATTEMPTS})`,
      ),
    )
    .orderBy(asc(missionAssignments.dueAt))
    .limit(SWEEP_BATCH_SIZE);
  let reminded = 0;
  for (const { assignment, mission } of candidates) {
    if (!assignment.dueAt || !shouldRemind(assignment, now)) continue;
    const dueAt = assignment.dueAt;
    const sent = await withTransaction(ctx, async (tx) => {
      const [marked] = await tx.db
        .update(missionAssignments)
        .set({ reminderDueAt: dueAt })
        .where(
          and(
            eq(missionAssignments.id, assignment.id),
            eq(missionAssignments.dueAt, dueAt),
            reminderNotSentForCurrentDueDate,
          ),
        )
        .returning({ id: missionAssignments.id });
      if (!marked) return false;
      const recipients = await recipientUserIds(tx, [assignment.memberId]);
      const userId = recipients.get(assignment.memberId);
      if (!userId) return false;
      await notify(tx, {
        recipientUserId: userId,
        type: 'mission.deadline',
        title: 'MISSION DEADLINE',
        body: `${formatMissionNumber(mission.number)} — ${mission.title}. Due in ${hoursLeft(dueAt, now)}h.`,
        data: { missionId: mission.id, assignmentId: assignment.id, dueAt: dueAt.toISOString() },
        dedupeKey: `mission-deadline:${assignment.id}:${dueAt.getTime()}`,
      });
      return true;
    });
    if (sent) reminded++;
  }
  return { reminded };
};
