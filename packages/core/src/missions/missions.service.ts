import { and, count, eq, inArray } from 'drizzle-orm';
import type { z } from 'zod';
import { missionAssignments, missions } from '@jave/database';
import { type ServiceContext, withTransaction } from '../kernel/context';
import { ConflictError, InvalidStateError, ValidationError } from '../kernel/errors';
import { parseInput } from '../kernel/validation';
import { recordAudit } from '../audit/audit.service';
import { publishEvent } from '../events/bus';
import { actorUserId } from '../permissions/actor';
import { authorize } from '../permissions/authorize';
import { scheduleMissionAnnouncement, scheduleMissionCardRefresh } from './discord-jobs';
import {
  assertValidDeadline,
  canTransitionMission,
  formatMissionNumber,
  isPast,
  type MissionStatus,
  WORKING_STATUSES,
} from './rules';
import {
  createMissionSchema,
  missionIdSchema,
  publishMissionSchema,
  updateMissionSchema,
} from './schemas';
import { assertMissionReferences, loadMission, type MissionRecord } from './store';
import { expireAssignment } from './sweeps';

/** Team missions are formed by staff; they can never be self-assigned. */
function resolveSelfAssignable(type: MissionRecord['type'], requested: boolean | undefined) {
  if (type !== 'team') return requested ?? true;
  if (requested === true)
    throw new ValidationError('selfAssignable: team missions are assigned by staff');
  return false;
}

function assertTransition(mission: MissionRecord, to: MissionStatus, message: string): void {
  if (!canTransitionMission(mission.status, to)) throw new InvalidStateError(message);
}

/** Move a mission between states, guarded against concurrent transitions. */
async function transition(
  tx: ServiceContext,
  mission: MissionRecord,
  to: MissionStatus,
  extra: Partial<typeof missions.$inferInsert> = {},
): Promise<MissionRecord> {
  const [row] = await tx.db
    .update(missions)
    .set({ status: to, ...extra })
    .where(and(eq(missions.id, mission.id), eq(missions.status, mission.status)))
    .returning();
  if (!row) throw new ConflictError('The mission changed while you were editing it.');
  return row;
}

/** Create a DRAFT mission (canManageMissions). */
export async function createMission(
  ctx: ServiceContext,
  input: z.input<typeof createMissionSchema>,
): Promise<MissionRecord> {
  const data = parseInput(createMissionSchema, input);
  await authorize(ctx, 'canManageMissions', { type: 'mission' });
  const now = ctx.clock.now();
  assertValidDeadline(data.deadlineAt, now);
  await assertMissionReferences(ctx, data);
  const selfAssignable = resolveSelfAssignable(data.type, data.selfAssignable);
  return withTransaction(ctx, async (tx) => {
    const [row] = await tx.db
      .insert(missions)
      .values({
        ...data,
        selfAssignable,
        status: 'draft',
        createdByUserId: actorUserId(tx.actor),
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const mission = row!;
    await recordAudit(tx, {
      action: 'mission.created',
      targetType: 'mission',
      targetId: mission.id,
      context: { number: formatMissionNumber(mission.number), type: mission.type },
    });
    return mission;
  });
}

/**
 * Edit a mission that is not archived. The type can only change while it is
 * a draft (assignments depend on it). Existing assignments keep their due
 * dates. An announced card is refreshed.
 */
export async function updateMission(
  ctx: ServiceContext,
  input: z.input<typeof updateMissionSchema>,
): Promise<MissionRecord> {
  const { missionId, patch } = parseInput(updateMissionSchema, input);
  await authorize(ctx, 'canManageMissions', { type: 'mission', id: missionId });
  const mission = await loadMission(ctx, missionId);
  if (mission.status === 'archived') throw new InvalidStateError('Archived missions are final.');
  if (patch.type !== undefined && patch.type !== mission.type && mission.status !== 'draft')
    throw new InvalidStateError('The mission type can only change while it is a draft.');
  const now = ctx.clock.now();
  if (patch.deadlineAt !== undefined) assertValidDeadline(patch.deadlineAt, now);
  await assertMissionReferences(ctx, patch);
  const type = patch.type ?? mission.type;
  const selfAssignable = resolveSelfAssignable(
    type,
    patch.selfAssignable ?? (type === 'team' ? undefined : mission.selfAssignable),
  );
  const next = { ...patch, selfAssignable };
  const changed = Object.keys(next).filter(
    (field) =>
      JSON.stringify(next[field as keyof typeof next]) !==
      JSON.stringify(mission[field as keyof MissionRecord]),
  );
  if (changed.length === 0) return mission;
  return withTransaction(ctx, async (tx) => {
    const [row] = await tx.db
      .update(missions)
      .set({ ...next, updatedAt: now })
      .where(and(eq(missions.id, missionId), eq(missions.status, mission.status)))
      .returning();
    if (!row) throw new ConflictError('The mission changed while you were editing it.');
    await recordAudit(tx, {
      action: 'mission.updated',
      targetType: 'mission',
      targetId: missionId,
      context: { fields: changed },
    });
    await scheduleMissionCardRefresh(tx, row);
    return row;
  });
}

/** DRAFT → OPEN. Publishes mission.published and queues the Discord card. */
export async function publishMission(
  ctx: ServiceContext,
  input: z.input<typeof publishMissionSchema>,
): Promise<{ mission: MissionRecord; announced: boolean }> {
  const data = parseInput(publishMissionSchema, input);
  await authorize(ctx, 'canManageMissions', { type: 'mission', id: data.missionId });
  const mission = await loadMission(ctx, data.missionId);
  if (mission.status !== 'draft') throw new InvalidStateError('Only a draft can be published.');
  const now = ctx.clock.now();
  if (isPast(mission.deadlineAt, now))
    throw new InvalidStateError('The deadline has already passed. Move it before publishing.');
  return withTransaction(ctx, async (tx) => {
    const opened = await transition(tx, mission, 'open', { publishedAt: now, closedAt: null });
    await recordAudit(tx, {
      action: 'mission.published',
      targetType: 'mission',
      targetId: opened.id,
      context: { announce: data.announce },
    });
    await publishEvent(tx, {
      type: 'mission.published',
      aggregateType: 'mission',
      aggregateId: opened.id,
      payload: {
        number: formatMissionNumber(opened.number),
        title: opened.title,
        type: opened.type,
        facetKey: opened.facetKey,
        deadlineAt: opened.deadlineAt?.toISOString() ?? null,
      },
    });
    const announced = data.announce ? await scheduleMissionAnnouncement(tx, opened) : false;
    return { mission: opened, announced };
  });
}

/** OPEN → CLOSED. No new assignments; work in progress continues until due. */
export async function closeMission(
  ctx: ServiceContext,
  input: z.input<typeof missionIdSchema>,
): Promise<MissionRecord> {
  const { missionId } = parseInput(missionIdSchema, input);
  await authorize(ctx, 'canManageMissions', { type: 'mission', id: missionId });
  const mission = await loadMission(ctx, missionId);
  assertTransition(mission, 'closed', 'Only an open mission can be closed.');
  return withTransaction(ctx, async (tx) => {
    const closed = await transition(tx, mission, 'closed', { closedAt: tx.clock.now() });
    await recordAudit(tx, { action: 'mission.closed', targetType: 'mission', targetId: missionId });
    await publishEvent(tx, {
      type: 'mission.closed',
      aggregateType: 'mission',
      aggregateId: missionId,
      payload: { reason: 'staff', archived: false },
    });
    await scheduleMissionCardRefresh(tx, closed);
    return closed;
  });
}

/** CLOSED → OPEN, e.g. after extending the deadline. */
export async function reopenMission(
  ctx: ServiceContext,
  input: z.input<typeof missionIdSchema>,
): Promise<MissionRecord> {
  const { missionId } = parseInput(missionIdSchema, input);
  await authorize(ctx, 'canManageMissions', { type: 'mission', id: missionId });
  const mission = await loadMission(ctx, missionId);
  assertTransition(mission, 'open', 'Only a closed mission can be reopened.');
  if (isPast(mission.deadlineAt, ctx.clock.now()))
    throw new InvalidStateError('The deadline has passed. Move it before reopening.');
  return withTransaction(ctx, async (tx) => {
    const reopened = await transition(tx, mission, 'open', { closedAt: null });
    await recordAudit(tx, {
      action: 'mission.reopened',
      targetType: 'mission',
      targetId: missionId,
    });
    await scheduleMissionCardRefresh(tx, reopened);
    return reopened;
  });
}

/**
 * DRAFT or CLOSED → ARCHIVED (final). Refused while submissions await
 * review; assignments still in progress expire with a notice.
 */
export async function archiveMission(
  ctx: ServiceContext,
  input: z.input<typeof missionIdSchema>,
): Promise<MissionRecord> {
  const { missionId } = parseInput(missionIdSchema, input);
  await authorize(ctx, 'canManageMissions', { type: 'mission', id: missionId });
  const mission = await loadMission(ctx, missionId);
  assertTransition(mission, 'archived', 'Close the mission before archiving it.');
  return withTransaction(ctx, async (tx) => {
    const [pending] = await tx.db
      .select({ value: count() })
      .from(missionAssignments)
      .where(
        and(
          eq(missionAssignments.missionId, missionId),
          eq(missionAssignments.status, 'submitted'),
        ),
      );
    if ((pending?.value ?? 0) > 0)
      throw new ConflictError(`${pending?.value} submission(s) still await review.`);
    const archived = await transition(tx, mission, 'archived', {
      archivedAt: tx.clock.now(),
      closedAt: mission.closedAt ?? tx.clock.now(),
    });
    const working = await tx.db
      .select()
      .from(missionAssignments)
      .where(
        and(
          eq(missionAssignments.missionId, missionId),
          inArray(missionAssignments.status, [...WORKING_STATUSES]),
        ),
      );
    for (const assignment of working) await expireAssignment(tx, assignment, archived, 'archived');
    await recordAudit(tx, {
      action: 'mission.archived',
      targetType: 'mission',
      targetId: missionId,
      context: { expiredAssignments: working.length },
    });
    await publishEvent(tx, {
      type: 'mission.closed',
      aggregateType: 'mission',
      aggregateId: missionId,
      payload: { reason: 'archived', archived: true },
    });
    await scheduleMissionCardRefresh(tx, archived);
    return archived;
  });
}
