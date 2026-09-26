import { and, eq, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import { adversarialRoles, adversarialTriggers } from '@jave/database';
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
  assertRoleStillRunnable,
  AUDIT_TARGET_ROLE,
  denyAsNotFound,
  findRole,
  inGoodStanding,
  loadManagedRole,
  loadTrial,
  lockRole,
  memberUserId,
} from './guards';
import { notifyOperative, requestTriggerApproval } from './notify';
import { assertSafe, type SafetyField } from './safety';
import { addTriggerSchema, approveTriggerSchema, triggerRefSchema } from './schemas';
import { type RoleRecord, TRIGGER_EDITABLE_STATUSES } from './state';

/**
 * Triggers: the planned beats of an operative's plan.
 *
 * Two-person rule for every instruction the operative receives. Triggers
 * present when the role is authorized are approved by the authorizer (who
 * reviewed that exact plan revision and may not have written any of them).
 * Triggers added afterwards stay pending — invisible to the operative, never
 * briefed, never fired — until a canAuthorizeAdversarial holder other than
 * their author approves them. Triggers are immutable once added; unapproved
 * ones can be withdrawn.
 */

export type TriggerRecord = typeof adversarialTriggers.$inferSelect;

const TRIGGER_ENTITY = 'Trigger';
const ROLE_CHANGED = 'The role changed in the meantime. Reload and try again.';

function assertTriggersOpen(role: Pick<RoleRecord, 'status'>): void {
  if (!TRIGGER_EDITABLE_STATUSES.includes(role.status))
    throw new InvalidStateError(`Role is ${role.status}; triggers are closed.`);
}

function triggerSafetyFields(trigger: { label: string; description: string }): SafetyField[] {
  return [
    { field: 'label', text: trigger.label, kind: 'content' },
    { field: 'description', text: trigger.description, kind: 'content' },
  ];
}

async function loadTrigger(
  ctx: ServiceContext,
  roleId: string,
  triggerId: string,
): Promise<TriggerRecord> {
  const [trigger] = await ctx.db
    .select()
    .from(adversarialTriggers)
    .where(and(eq(adversarialTriggers.id, triggerId), eq(adversarialTriggers.roleId, roleId)));
  if (!trigger) throw new NotFoundError(TRIGGER_ENTITY);
  return trigger;
}

/** Invalidate a pending review: the authorizer must name the new revision. Row must be locked. */
async function bumpPlanRevision(tx: ServiceContext, role: RoleRecord): Promise<number> {
  const [bumped] = await tx.db
    .update(adversarialRoles)
    .set({ planRevision: role.planRevision + 1, updatedAt: tx.clock.now() })
    .where(eq(adversarialRoles.id, role.id))
    .returning({ planRevision: adversarialRoles.planRevision });
  return bumped!.planRevision;
}

/** DM the operative the new briefing revision. Row must be locked. */
async function publishBriefingRevision(
  tx: ServiceContext,
  role: RoleRecord,
  trialNumber: number,
): Promise<number> {
  const [bumped] = await tx.db
    .update(adversarialRoles)
    .set({
      briefingRevision: role.briefingRevision + 1,
      briefingDelivery: 'pending',
      updatedAt: tx.clock.now(),
    })
    .where(eq(adversarialRoles.id, role.id))
    .returning();
  const updated = bumped!;
  await enqueueJob(
    tx,
    ADVERSARIAL_BRIEF_JOB,
    { roleId: role.id, revision: updated.briefingRevision },
    {
      dedupeKey: briefJobKey(role.id, updated.briefingRevision),
      maxAttempts: BRIEF_MAX_ATTEMPTS,
    },
  );
  await notifyOperative(tx, updated, 'briefing_updated', trialNumber);
  return updated.briefingRevision;
}

/**
 * Add a planned action for the operative. Texts pass the strict validator.
 * Before authorization it becomes part of the plan under review (the plan
 * revision increments). After authorization it awaits a second person's
 * approval and reaches the operative only then.
 */
export async function addTrigger(
  ctx: ServiceContext,
  input: z.input<typeof addTriggerSchema>,
): Promise<TriggerRecord> {
  const data = parseInput(addTriggerSchema, input);
  await authorize(ctx, 'canManageAdversarial', { type: AUDIT_TARGET_ROLE, id: data.roleId });
  const author = requireUser(ctx);
  await assertKillSwitchOn(ctx);
  const role = await loadManagedRole(ctx, data.roleId, 'adversarial.add_trigger');
  assertTriggersOpen(role);
  if (isSelf(author, role.operativeMemberId))
    throw new ForbiddenError('The operative cannot change their own plan.');
  assertSafe(triggerSafetyFields(data));
  const trial = await loadTrial(ctx, role.trialId);
  const now = ctx.clock.now();
  if (data.plannedFor) {
    if (data.plannedFor.getTime() <= now.getTime())
      throw new ValidationError('plannedFor must be in the future.');
    if (trial.deadlineAt && data.plannedFor.getTime() > trial.deadlineAt.getTime())
      throw new ValidationError('plannedFor must be before the trial deadline.');
  }
  const operativeUserId = await memberUserId(ctx, role.operativeMemberId);

  return withTransaction(ctx, async (tx) => {
    const current = await lockRole(tx, role.id);
    if (!TRIGGER_EDITABLE_STATUSES.includes(current.status)) throw new ConflictError(ROLE_CHANGED);
    const [row] = await tx.db
      .insert(adversarialTriggers)
      .values({
        roleId: role.id,
        label: data.label,
        description: data.description,
        plannedFor: data.plannedFor ?? null,
        createdByUserId: author.userId,
        createdAt: now,
      })
      .returning();
    const trigger = row!;
    // Decided under the lock: an authorization landing concurrently leaves this trigger pending.
    const awaitsApproval = current.authorizedAt !== null;
    const planRevision = awaitsApproval
      ? current.planRevision
      : await bumpPlanRevision(tx, current);
    if (awaitsApproval) {
      await requestTriggerApproval(tx, {
        roleId: role.id,
        triggerId: trigger.id,
        trialId: role.trialId,
        trialNumber: trial.number,
        excludeUserIds: [author.userId, ...(operativeUserId ? [operativeUserId] : [])],
      });
    }
    await recordAudit(tx, {
      action: 'adversarial.trigger_added',
      targetType: AUDIT_TARGET_ROLE,
      targetId: role.id,
      context: { triggerId: trigger.id, awaitsApproval, planRevision },
    });
    return trigger;
  });
}

/**
 * Second-person approval of a trigger added after authorization. The approver
 * holds canAuthorizeAdversarial, did not write the trigger, is not the
 * operative, and attests it uses only fictional data and sandbox accounts.
 * If the operative was already briefed, the updated briefing is DMed as a new
 * revision — only while the operative is still eligible.
 */
export async function approveTrigger(
  ctx: ServiceContext,
  input: z.input<typeof approveTriggerSchema>,
): Promise<TriggerRecord> {
  const data = parseInput(approveTriggerSchema, input);
  await authorize(ctx, 'canAuthorizeAdversarial', { type: AUDIT_TARGET_ROLE, id: data.roleId });
  const approver = requireUser(ctx);
  await assertKillSwitchOn(ctx);
  const role = await loadManagedRole(ctx, data.roleId, 'adversarial.approve_trigger');
  assertTriggersOpen(role);
  if (!role.authorizedAt)
    throw new InvalidStateError('Triggers added before authorization are approved with the role.');
  const trigger = await loadTrigger(ctx, role.id, data.triggerId);
  if (trigger.approvedAt) throw new ConflictError('This trigger is already approved.');
  const conflict =
    trigger.createdByUserId === null || trigger.createdByUserId === approver.userId
      ? 'Two-person rule: a different staff member must approve this trigger.'
      : isSelf(approver, role.operativeMemberId)
        ? 'The operative cannot approve their own plan.'
        : null;
  if (conflict) {
    await recordAudit(
      ctx,
      {
        action: 'adversarial.two_person_rule_blocked',
        targetType: AUDIT_TARGET_ROLE,
        targetId: role.id,
        result: 'denied',
        context: { operation: 'approve_trigger', triggerId: trigger.id },
      },
      { durable: true },
    );
    throw new ForbiddenError(conflict);
  }
  const trial = await assertRoleStillRunnable(ctx, role);
  assertSafe(triggerSafetyFields(trigger));

  return withTransaction(ctx, async (tx) => {
    const current = await lockRole(tx, role.id);
    if (!TRIGGER_EDITABLE_STATUSES.includes(current.status)) throw new ConflictError(ROLE_CHANGED);
    const [approved] = await tx.db
      .update(adversarialTriggers)
      .set({ approvedByUserId: approver.userId, approvedAt: tx.clock.now() })
      .where(
        and(
          eq(adversarialTriggers.id, trigger.id),
          eq(adversarialTriggers.roleId, role.id),
          isNull(adversarialTriggers.approvedAt),
        ),
      )
      .returning();
    if (!approved)
      throw new ConflictError('This trigger was approved or withdrawn in the meantime.');
    const briefingRevision = current.briefedAt
      ? await publishBriefingRevision(tx, current, trial.number)
      : current.briefingRevision;
    await recordAudit(tx, {
      action: 'adversarial.trigger_approved',
      targetType: AUDIT_TARGET_ROLE,
      targetId: role.id,
      context: { triggerId: trigger.id, sandboxAttested: true, briefingRevision },
    });
    return approved;
  });
}

/**
 * Remove a trigger that was never approved (it never reached the operative).
 * Approved triggers are part of the authorized plan: abort the role instead.
 */
export async function withdrawTrigger(
  ctx: ServiceContext,
  input: z.input<typeof triggerRefSchema>,
): Promise<void> {
  const data = parseInput(triggerRefSchema, input);
  await authorize(ctx, 'canManageAdversarial', { type: AUDIT_TARGET_ROLE, id: data.roleId });
  const actor = requireUser(ctx);
  const role = await loadManagedRole(ctx, data.roleId, 'adversarial.withdraw_trigger');
  assertTriggersOpen(role);
  if (isSelf(actor, role.operativeMemberId))
    throw new ForbiddenError('The operative cannot change their own plan.');
  const trigger = await loadTrigger(ctx, role.id, data.triggerId);
  if (trigger.approvedAt)
    throw new InvalidStateError(
      'Approved triggers are part of the authorized plan. Abort the role to change it.',
    );

  await withTransaction(ctx, async (tx) => {
    const current = await lockRole(tx, role.id);
    if (!TRIGGER_EDITABLE_STATUSES.includes(current.status)) throw new ConflictError(ROLE_CHANGED);
    const [removed] = await tx.db
      .delete(adversarialTriggers)
      .where(
        and(
          eq(adversarialTriggers.id, trigger.id),
          eq(adversarialTriggers.roleId, role.id),
          isNull(adversarialTriggers.approvedAt),
        ),
      )
      .returning({ id: adversarialTriggers.id });
    if (!removed)
      throw new ConflictError('This trigger was approved or withdrawn in the meantime.');
    const planRevision = current.authorizedAt
      ? current.planRevision
      : await bumpPlanRevision(tx, current);
    await recordAudit(tx, {
      action: 'adversarial.trigger_withdrawn',
      targetType: AUDIT_TARGET_ROLE,
      targetId: role.id,
      context: { triggerId: trigger.id, planRevision },
    });
  });
}

/**
 * Record that an approved trigger was carried out. Staff or the operative (for
 * their own role) may fire it, only while the exercise is active and before
 * the trial deadline. Each trigger fires once.
 */
export async function fireTrigger(
  ctx: ServiceContext,
  input: z.input<typeof triggerRefSchema>,
): Promise<TriggerRecord> {
  const data = parseInput(triggerRefSchema, input);
  if (ctx.actor.kind === 'anonymous') throw new UnauthenticatedError();
  const role = await findRole(ctx, data.roleId);
  const isOperative = role !== null && isSelf(ctx.actor, role.operativeMemberId);
  const visible =
    role !== null &&
    ((isOperative && role.briefedAt !== null && inGoodStanding(ctx)) ||
      (can(ctx, 'canManageAdversarial') && !(await actorParticipatesIn(ctx, role.trialId))));
  if (!role || !visible) return denyAsNotFound(ctx, data.roleId, 'adversarial.fire_trigger');
  const trigger = await loadTrigger(ctx, role.id, data.triggerId);
  // A pending trigger does not exist for the operative; staff are told why it cannot fire.
  if (!trigger.approvedAt) {
    if (isOperative) throw new NotFoundError(TRIGGER_ENTITY);
    throw new InvalidStateError('This trigger awaits a second person’s approval.');
  }
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
