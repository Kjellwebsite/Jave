import { and, eq, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import { adversarialObservations, adversarialRoles, adversarialTriggers } from '@jave/database';
import { recordAudit } from '../audit/audit.service';
import { type ServiceContext, withTransaction } from '../kernel/context';
import {
  ConflictError,
  ForbiddenError,
  InvalidStateError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from '../kernel/errors';
import { parseInput } from '../kernel/validation';
import { enqueueJob } from '../jobs/queue';
import { actorUserId } from '../permissions/actor';
import { authorize, can, isSelf, requireUser } from '../permissions/authorize';
import { ADVERSARIAL_BRIEF_JOB, BRIEF_MAX_ATTEMPTS, briefJobKey } from './discord-jobs';
import {
  actorParticipatesIn,
  assertKillSwitchOn,
  AUDIT_TARGET_ROLE,
  denyAsNotFound,
  findRole,
  inGoodStanding,
  isSelectedOnTeam,
  loadManagedRole,
  loadTrial,
  lockRole,
} from './guards';
import { notifyOperative } from './notify';
import { assertSafe } from './safety';
import { addTriggerSchema, fireTriggerSchema, recordObservationSchema } from './schemas';
import { acceptsObservations, type RoleRecord, TRIGGER_EDITABLE_STATUSES } from './state';

export type TriggerRecord = typeof adversarialTriggers.$inferSelect;
export type ObservationRecord = typeof adversarialObservations.$inferSelect;

const TRIGGER_ENTITY = 'Trigger';

/**
 * Once a role is authorized, its plan may only change with a second person:
 * the author of a new trigger must hold canAuthorizeAdversarial and be neither
 * the planner nor the operative. Before authorization, the authorizer reviews
 * every trigger anyway.
 */
async function assertMayChangePlan(ctx: ServiceContext, role: RoleRecord): Promise<void> {
  const actor = requireUser(ctx);
  if (isSelf(actor, role.operativeMemberId))
    throw new ForbiddenError('The operative cannot change their own plan.');
  if (!role.authorizedAt) return;
  await authorize(ctx, 'canAuthorizeAdversarial', { type: AUDIT_TARGET_ROLE, id: role.id });
  if (role.createdByUserId === actor.userId) {
    await recordAudit(
      ctx,
      {
        action: 'adversarial.two_person_rule_blocked',
        targetType: AUDIT_TARGET_ROLE,
        targetId: role.id,
        result: 'denied',
        context: { operation: 'add_trigger' },
      },
      { durable: true },
    );
    throw new ForbiddenError(
      'Two-person rule: after authorization, another authorizer must add triggers.',
    );
  }
}

/**
 * Add a planned action for the operative. Texts pass the strict validator.
 * If the operative was already briefed, the briefing revision increments and
 * the updated briefing is DMed.
 */
export async function addTrigger(
  ctx: ServiceContext,
  input: z.input<typeof addTriggerSchema>,
): Promise<TriggerRecord> {
  const data = parseInput(addTriggerSchema, input);
  await authorize(ctx, 'canManageAdversarial', { type: AUDIT_TARGET_ROLE, id: data.roleId });
  await assertKillSwitchOn(ctx);
  const role = await loadManagedRole(ctx, data.roleId, 'adversarial.add_trigger');
  if (!TRIGGER_EDITABLE_STATUSES.includes(role.status))
    throw new InvalidStateError(`Role is ${role.status}; triggers are closed.`);
  await assertMayChangePlan(ctx, role);
  assertSafe([
    { field: 'label', text: data.label, kind: 'content' },
    { field: 'description', text: data.description, kind: 'content' },
  ]);
  const trial = await loadTrial(ctx, role.trialId);
  const now = ctx.clock.now();
  if (data.plannedFor) {
    if (data.plannedFor.getTime() <= now.getTime())
      throw new ValidationError('plannedFor must be in the future.');
    if (trial.deadlineAt && data.plannedFor.getTime() > trial.deadlineAt.getTime())
      throw new ValidationError('plannedFor must be before the trial deadline.');
  }

  return withTransaction(ctx, async (tx) => {
    const current = await lockRole(tx, role.id);
    // Authorization landing between the check above and this lock would bypass the two-person rule.
    const authorizationChanged = (current.authorizedAt === null) !== (role.authorizedAt === null);
    if (!TRIGGER_EDITABLE_STATUSES.includes(current.status) || authorizationChanged)
      throw new ConflictError('The role changed in the meantime. Reload and try again.');
    const [row] = await tx.db
      .insert(adversarialTriggers)
      .values({
        roleId: role.id,
        label: data.label,
        description: data.description,
        plannedFor: data.plannedFor ?? null,
        createdByUserId: actorUserId(tx.actor),
        createdAt: now,
      })
      .returning();
    const trigger = row!;
    let revision = current.briefingRevision;
    if (current.briefedAt) {
      const [bumped] = await tx.db
        .update(adversarialRoles)
        .set({
          briefingRevision: current.briefingRevision + 1,
          briefingDelivery: 'pending',
          updatedAt: now,
        })
        .where(eq(adversarialRoles.id, role.id))
        .returning();
      revision = bumped!.briefingRevision;
      await enqueueJob(
        tx,
        ADVERSARIAL_BRIEF_JOB,
        { roleId: role.id, revision },
        { dedupeKey: briefJobKey(role.id, revision), maxAttempts: BRIEF_MAX_ATTEMPTS },
      );
      await notifyOperative(tx, bumped!, 'briefing_updated', trial.number);
    }
    await recordAudit(tx, {
      action: 'adversarial.trigger_added',
      targetType: AUDIT_TARGET_ROLE,
      targetId: role.id,
      context: { triggerId: trigger.id, label: trigger.label, briefingRevision: revision },
    });
    return trigger;
  });
}

/**
 * Record that a trigger was carried out. Staff or the operative (for their own
 * role) may fire it, only while the exercise is active and before the trial
 * deadline. Each trigger fires once.
 */
export async function fireTrigger(
  ctx: ServiceContext,
  input: z.input<typeof fireTriggerSchema>,
): Promise<TriggerRecord> {
  const data = parseInput(fireTriggerSchema, input);
  if (ctx.actor.kind === 'anonymous') throw new UnauthenticatedError();
  const role = await findRole(ctx, data.roleId);
  const isOperative = role !== null && isSelf(ctx.actor, role.operativeMemberId);
  const visible =
    role !== null &&
    ((isOperative && role.briefedAt !== null && inGoodStanding(ctx)) ||
      (can(ctx, 'canManageAdversarial') && !(await actorParticipatesIn(ctx, role.trialId))));
  if (!role || !visible) return denyAsNotFound(ctx, data.roleId, 'adversarial.fire_trigger');
  const [trigger] = await ctx.db
    .select()
    .from(adversarialTriggers)
    .where(
      and(eq(adversarialTriggers.id, data.triggerId), eq(adversarialTriggers.roleId, role.id)),
    );
  if (!trigger) throw new NotFoundError(TRIGGER_ENTITY);
  if (role.status !== 'active')
    throw new InvalidStateError('Triggers fire only while the exercise is active.');
  await assertKillSwitchOn(ctx);
  const trial = await loadTrial(ctx, role.trialId);
  const now = ctx.clock.now();
  if (
    trial.status !== 'active' ||
    (trial.deadlineAt && now.getTime() >= trial.deadlineAt.getTime())
  )
    throw new InvalidStateError('The trial is no longer running.');

  return withTransaction(ctx, async (tx) => {
    const [fired] = await tx.db
      .update(adversarialTriggers)
      .set({ firedAt: now, firedByUserId: actorUserId(tx.actor) })
      .where(and(eq(adversarialTriggers.id, trigger.id), isNull(adversarialTriggers.firedAt)))
      .returning();
    if (!fired) throw new ConflictError('This trigger already fired.');
    await recordAudit(tx, {
      action: 'adversarial.trigger_fired',
      targetType: AUDIT_TARGET_ROLE,
      targetId: role.id,
      context: { triggerId: trigger.id, by: isOperative ? 'operative' : 'staff' },
    });
    return fired;
  });
}

/**
 * Record how the team responded. Observers must be staff other than the
 * operative. The subject, when given, must be a selected participant on the
 * role's team (never the operative); the trigger must belong to the role.
 */
export async function recordObservation(
  ctx: ServiceContext,
  input: z.input<typeof recordObservationSchema>,
): Promise<ObservationRecord> {
  const data = parseInput(recordObservationSchema, input);
  await authorize(ctx, 'canManageAdversarial', { type: AUDIT_TARGET_ROLE, id: data.roleId });
  const observer = requireUser(ctx);
  const role = await loadManagedRole(ctx, data.roleId, 'adversarial.record_observation');
  if (!acceptsObservations(role))
    throw new InvalidStateError(
      'Observations need an exercise that is running or ended and not yet revealed.',
    );
  if (isSelf(observer, role.operativeMemberId))
    throw new ForbiddenError('The operative cannot record observations on their own role.');
  assertSafe([{ field: 'description', text: data.description, kind: 'report' }]);
  if (data.subjectMemberId) {
    const onTeam =
      role.teamId !== null &&
      data.subjectMemberId !== role.operativeMemberId &&
      (await isSelectedOnTeam(ctx, {
        trialId: role.trialId,
        teamId: role.teamId,
        memberId: data.subjectMemberId,
      }));
    if (!onTeam)
      throw new ValidationError('The subject must be a participant on the targeted team.');
  }
  if (data.triggerId) {
    const [trigger] = await ctx.db
      .select({ id: adversarialTriggers.id })
      .from(adversarialTriggers)
      .where(
        and(eq(adversarialTriggers.id, data.triggerId), eq(adversarialTriggers.roleId, role.id)),
      );
    if (!trigger) throw new NotFoundError(TRIGGER_ENTITY);
  }
  const now = ctx.clock.now();
  const occurredAt = data.occurredAt ?? now;
  if (occurredAt.getTime() > now.getTime())
    throw new ValidationError('occurredAt cannot be in the future.');
  if (role.activatedAt && occurredAt.getTime() < role.activatedAt.getTime())
    throw new ValidationError('occurredAt is before the exercise started.');

  return withTransaction(ctx, async (tx) => {
    const current = await lockRole(tx, role.id);
    if (!acceptsObservations(current))
      throw new ConflictError('The role changed in the meantime. Reload and try again.');
    const [row] = await tx.db
      .insert(adversarialObservations)
      .values({
        roleId: role.id,
        triggerId: data.triggerId ?? null,
        observerUserId: observer.userId,
        subjectMemberId: data.subjectMemberId ?? null,
        outcome: data.outcome,
        description: data.description,
        occurredAt,
        createdAt: now,
      })
      .returning();
    await recordAudit(tx, {
      action: 'adversarial.observation_recorded',
      targetType: AUDIT_TARGET_ROLE,
      targetId: role.id,
      context: {
        observationId: row!.id,
        outcome: data.outcome,
        subjectMemberId: data.subjectMemberId ?? null,
      },
    });
    return row!;
  });
}
