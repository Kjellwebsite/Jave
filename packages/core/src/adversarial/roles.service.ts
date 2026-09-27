import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import { adversarialRoles, adversarialTriggers } from '@jave/database';
import { recordAudit } from '../audit/audit.service';
import { type ServiceContext, withTransaction } from '../kernel/context';
import {
  ConflictError,
  ForbiddenError,
  InvalidStateError,
  isUniqueViolation,
  NotFoundError,
  ValidationError,
} from '../kernel/errors';
import { parseInput } from '../kernel/validation';
import { cancelJob, enqueueJob } from '../jobs/queue';
import { actorUserId, type UserActor } from '../permissions/actor';
import { authorize, isSelf, requireUser } from '../permissions/authorize';
import {
  ABORT_MAX_ATTEMPTS,
  ADVERSARIAL_ABORT_JOB,
  ADVERSARIAL_BRIEF_JOB,
  abortJobKey,
  BRIEF_MAX_ATTEMPTS,
  briefJobKey,
} from './discord-jobs';
import {
  assertKillSwitchOn,
  assertRoleStillRunnable,
  AUDIT_TARGET_ROLE,
  assertNotTrialParticipant,
  isForeignKeyViolation,
  loadManagedRole,
  loadTeam,
  loadTrial,
  lockRole,
  memberUserId,
  operativeIneligibility,
  roleAuditContext,
  transitionRole,
  trialBlocker,
} from './guards';
import { notifyOperative, notifyStaffUser, requestAuthorization } from './notify';
import { assertSafe, type SafetyField, sanitizeStopText } from './safety';
import { loadScenario } from './scenarios.service';
import {
  abortRoleSchema,
  authorizeRoleSchema,
  LIMITS,
  planRoleSchema,
  roleIdSchema,
} from './schemas';
import {
  ABORTABLE_STATUSES,
  OPERATIVE_STOPPABLE_STATUSES,
  type RoleRecord,
  type RoleStatus,
} from './state';

const PLAN_CHANGED = 'The plan changed since you reviewed it. Reload it and review it again.';

// ─── Shared checks ───────────────────────────────────────────────────────────

/**
 * Every operative-facing text of a role, re-validated before authorization
 * (the whole plan) and briefing (what is sent: approved triggers only).
 */
async function roleSafetyFields(
  ctx: ServiceContext,
  role: RoleRecord,
  triggers: 'all' | 'approved',
): Promise<SafetyField[]> {
  const rows = await ctx.db
    .select({ label: adversarialTriggers.label, description: adversarialTriggers.description })
    .from(adversarialTriggers)
    .where(
      and(
        eq(adversarialTriggers.roleId, role.id),
        triggers === 'approved' ? isNotNull(adversarialTriggers.approvedAt) : undefined,
      ),
    );
  return [
    { field: 'scenarioTitle', text: role.scenarioTitle, kind: 'content' },
    { field: 'objective', text: role.objective, kind: 'content' },
    { field: 'sandboxAssets', text: role.sandboxAssets, kind: 'content' },
    { field: 'guardrails', text: role.guardrails, kind: 'guardrails' },
    ...rows.flatMap((trigger, index): SafetyField[] => [
      { field: `triggers.${index}.label`, text: trigger.label, kind: 'content' },
      { field: `triggers.${index}.description`, text: trigger.description, kind: 'content' },
    ]),
  ];
}

/**
 * Why the authorizer may not sign this plan, or null. Two-person rule: they
 * did not plan it, are not the operative, and wrote none of its triggers
 * (every trigger present is approved by this signature).
 */
async function authorizationConflict(
  ctx: ServiceContext,
  role: RoleRecord,
  authorizer: UserActor,
): Promise<string | null> {
  if (role.createdByUserId === null || role.createdByUserId === authorizer.userId)
    return 'Two-person rule: a different staff member must authorize this role.';
  if (isSelf(authorizer, role.operativeMemberId))
    return 'The operative cannot authorize their own role.';
  const [ownTrigger] = await ctx.db
    .select({ id: adversarialTriggers.id })
    .from(adversarialTriggers)
    .where(
      and(
        eq(adversarialTriggers.roleId, role.id),
        eq(adversarialTriggers.createdByUserId, authorizer.userId),
      ),
    )
    .limit(1);
  if (ownTrigger)
    return 'Two-person rule: you wrote a trigger in this plan, so a different staff member must authorize it.';
  return null;
}

function assertStatus(role: RoleRecord, allowed: readonly RoleStatus[], action: string): void {
  if (!allowed.includes(role.status))
    throw new InvalidStateError(`Role is ${role.status}; cannot ${action}.`);
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

/**
 * Plan an adversarial role. Requires the global kill switch on, a trial that
 * allows adversarial roles, an active scenario, and an eligible operative who
 * is not the planner. The planner cannot authorize it (two-person rule).
 */
export async function planRole(
  ctx: ServiceContext,
  input: z.input<typeof planRoleSchema>,
): Promise<RoleRecord> {
  const data = parseInput(planRoleSchema, input);
  await authorize(ctx, 'canManageAdversarial', { type: 'trial', id: data.trialId });
  const planner = requireUser(ctx);
  await assertKillSwitchOn(ctx);
  const trial = await loadTrial(ctx, data.trialId);
  await assertNotTrialParticipant(ctx, trial.id, 'adversarial.plan_role');
  const blocker = trialBlocker(trial);
  if (blocker) throw new InvalidStateError(blocker);
  const team = await loadTeam(ctx, data.teamId);
  if (!team || team.trialId !== trial.id) throw new NotFoundError('Trial team');
  if (isSelf(planner, data.operativeMemberId)) {
    await recordAudit(
      ctx,
      {
        action: 'adversarial.self_assignment_blocked',
        targetType: 'trial',
        targetId: trial.id,
        result: 'denied',
      },
      { durable: true },
    );
    throw new ForbiddenError('You cannot plan yourself as the operative.');
  }
  const ineligible = await operativeIneligibility(ctx, {
    trialId: trial.id,
    teamId: team.id,
    memberId: data.operativeMemberId,
  });
  if (ineligible) throw new ValidationError(ineligible);
  const scenario = await loadScenario(ctx, data.scenarioId);
  if (!scenario.active) throw new InvalidStateError('This scenario is archived.');
  const objective = data.objective ?? scenario.objective;
  assertSafe([
    { field: 'scenarioTitle', text: scenario.title, kind: 'content' },
    { field: 'objective', text: objective, kind: 'content' },
    { field: 'sandboxAssets', text: scenario.sandboxAssets, kind: 'content' },
    { field: 'guardrails', text: scenario.guardrails, kind: 'guardrails' },
  ]);
  const operativeUserId = await memberUserId(ctx, data.operativeMemberId);

  try {
    return await withTransaction(ctx, async (tx) => {
      const now = tx.clock.now();
      const [row] = await tx.db
        .insert(adversarialRoles)
        .values({
          trialId: trial.id,
          teamId: team.id,
          operativeMemberId: data.operativeMemberId,
          scenarioId: scenario.id,
          scenarioTitle: scenario.title,
          technique: scenario.technique,
          objective,
          guardrails: scenario.guardrails,
          sandboxAssets: scenario.sandboxAssets,
          createdByUserId: planner.userId,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      const role = row!;
      // Trial, team and operative live on the role row (canManageAdversarial only); the
      // shared audit log names the role alone until the reveal.
      await recordAudit(tx, {
        action: 'adversarial.role_planned',
        targetType: AUDIT_TARGET_ROLE,
        targetId: role.id,
        context: { scenarioKey: scenario.key, customObjective: data.objective !== undefined },
      });
      await requestAuthorization(tx, {
        roleId: role.id,
        trialId: trial.id,
        trialNumber: trial.number,
        teamName: team.name,
        excludeUserIds: [planner.userId, ...(operativeUserId ? [operativeUserId] : [])],
      });
      return role;
    });
  } catch (error) {
    if (isUniqueViolation(error, 'adversarial_roles_operative_uq'))
      throw new ConflictError('This member already has an adversarial role in this trial.');
    if (isUniqueViolation(error, 'adversarial_roles_team_uq'))
      throw new ConflictError('This team already has an adversarial role.');
    // The scenario, trial or team was deleted while planning.
    if (isForeignKeyViolation(error))
      throw new ConflictError('The scenario, trial or team changed. Reload and try again.');
    throw error;
  }
}

/**
 * Second-person authorization of the plan revision the authorizer reviewed.
 * The authorizer must hold canAuthorizeAdversarial, must not be the planner,
 * the operative or the author of any trigger, and must attest that the
 * scenario uses only fictional data and sandbox accounts. Every trigger in the
 * plan is approved by this signature. A plan that changed since the review
 * (`planRevision` mismatch) is refused.
 */
export async function authorizeRole(
  ctx: ServiceContext,
  input: z.input<typeof authorizeRoleSchema>,
): Promise<RoleRecord> {
  const data = parseInput(authorizeRoleSchema, input);
  await authorize(ctx, 'canAuthorizeAdversarial', { type: AUDIT_TARGET_ROLE, id: data.roleId });
  const authorizer = requireUser(ctx);
  await assertKillSwitchOn(ctx);
  if (data.note) assertSafe([{ field: 'note', text: data.note, kind: 'report' }]);
  const role = await loadManagedRole(ctx, data.roleId, 'adversarial.authorize_role');
  assertStatus(role, ['planned'], 'authorize');
  if (role.authorizedAt) throw new ConflictError('This role is already authorized.');
  const conflict = await authorizationConflict(ctx, role, authorizer);
  if (conflict) {
    await recordAudit(
      ctx,
      {
        action: 'adversarial.two_person_rule_blocked',
        targetType: AUDIT_TARGET_ROLE,
        targetId: role.id,
        result: 'denied',
        context: { reason: conflict },
      },
      { durable: true },
    );
    throw new ForbiddenError(conflict);
  }
  const trial = await assertRoleStillRunnable(ctx, role);

  return withTransaction(ctx, async (tx) => {
    // Under the row lock (addTrigger and withdrawTrigger take it and bump the
    // revision): the plan signed is exactly the plan reviewed.
    const current = await lockRole(tx, role.id);
    if (current.planRevision !== data.planRevision) throw new ConflictError(PLAN_CHANGED);
    assertSafe(await roleSafetyFields(tx, current, 'all'));
    const now = tx.clock.now();
    const updated = await transitionRole(
      tx,
      role.id,
      ['planned'],
      {
        authorizedByUserId: authorizer.userId,
        authorizedAt: now,
        sandboxAttested: true,
        authorizationNote: data.note ?? null,
      },
      isNull(adversarialRoles.authorizedAt),
    );
    const approved = await tx.db
      .update(adversarialTriggers)
      .set({ approvedByUserId: authorizer.userId, approvedAt: now })
      .where(and(eq(adversarialTriggers.roleId, role.id), isNull(adversarialTriggers.approvedAt)))
      .returning({ id: adversarialTriggers.id });
    await recordAudit(tx, {
      action: 'adversarial.role_authorized',
      targetType: AUDIT_TARGET_ROLE,
      targetId: role.id,
      context: {
        sandboxAttested: true,
        planRevision: current.planRevision,
        approvedTriggerIds: approved.map((trigger) => trigger.id),
        hasNote: data.note !== undefined && data.note !== '',
      },
    });
    await notifyStaffUser(tx, {
      userId: role.createdByUserId,
      roleId: role.id,
      trialId: role.trialId,
      fact: 'authorized',
      title: 'ROLE AUTHORIZED',
      body: `The adversarial role for Trial #${trial.number} was authorized by a second staff member. Ready to brief.`,
    });
    return updated;
  });
}

/** Brief the operative (DM + dashboard). Only after authorization. */
export async function briefRole(
  ctx: ServiceContext,
  input: z.input<typeof roleIdSchema>,
): Promise<RoleRecord> {
  const data = parseInput(roleIdSchema, input);
  await authorize(ctx, 'canManageAdversarial', { type: AUDIT_TARGET_ROLE, id: data.roleId });
  await assertKillSwitchOn(ctx);
  const role = await loadManagedRole(ctx, data.roleId, 'adversarial.brief_role');
  assertStatus(role, ['planned'], 'brief');
  if (!role.authorizedAt || !role.sandboxAttested)
    throw new InvalidStateError(
      'Authorize the role first: a second staff member and the sandbox attestation.',
    );
  const trial = await assertRoleStillRunnable(ctx, role);

  return withTransaction(ctx, async (tx) => {
    assertSafe(await roleSafetyFields(tx, await lockRole(tx, role.id), 'approved'));
    const updated = await transitionRole(
      tx,
      role.id,
      ['planned'],
      { status: 'briefed', briefedAt: tx.clock.now(), briefingDelivery: 'pending' },
      isNotNull(adversarialRoles.authorizedAt),
    );
    await enqueueJob(
      tx,
      ADVERSARIAL_BRIEF_JOB,
      { roleId: role.id, revision: updated.briefingRevision },
      {
        dedupeKey: briefJobKey(role.id, updated.briefingRevision),
        maxAttempts: BRIEF_MAX_ATTEMPTS,
      },
    );
    await notifyOperative(tx, updated, 'briefed', trial.number);
    await recordAudit(tx, {
      action: 'adversarial.role_briefed',
      targetType: AUDIT_TARGET_ROLE,
      targetId: role.id,
      context: { revision: updated.briefingRevision },
    });
    return updated;
  });
}

/** Start the exercise. The trial must be active and before its deadline. */
export async function activateRole(
  ctx: ServiceContext,
  input: z.input<typeof roleIdSchema>,
): Promise<RoleRecord> {
  const data = parseInput(roleIdSchema, input);
  await authorize(ctx, 'canManageAdversarial', { type: AUDIT_TARGET_ROLE, id: data.roleId });
  await assertKillSwitchOn(ctx);
  const role = await loadManagedRole(ctx, data.roleId, 'adversarial.activate_role');
  assertStatus(role, ['briefed'], 'activate');
  const trial = await assertRoleStillRunnable(ctx, role);
  if (trial.status !== 'active')
    throw new InvalidStateError('The trial must be active to start the exercise.');
  const now = ctx.clock.now();
  if (trial.deadlineAt && now.getTime() >= trial.deadlineAt.getTime())
    throw new InvalidStateError('The trial deadline has passed.');

  return withTransaction(ctx, async (tx) => {
    const updated = await transitionRole(tx, role.id, ['briefed'], {
      status: 'active',
      activatedAt: now,
    });
    await notifyOperative(tx, updated, 'active', trial.number);
    await recordAudit(tx, {
      action: 'adversarial.role_activated',
      targetType: AUDIT_TARGET_ROLE,
      targetId: role.id,
    });
    return updated;
  });
}

/** End a running exercise normally. */
export async function concludeRole(
  ctx: ServiceContext,
  input: z.input<typeof roleIdSchema>,
): Promise<RoleRecord> {
  const data = parseInput(roleIdSchema, input);
  await authorize(ctx, 'canManageAdversarial', { type: AUDIT_TARGET_ROLE, id: data.roleId });
  const role = await loadManagedRole(ctx, data.roleId, 'adversarial.conclude_role');
  assertStatus(role, ['active'], 'conclude');
  const trial = await loadTrial(ctx, role.trialId);
  return withTransaction(ctx, (tx) => concludeWithinTx(tx, role.id, trial.number, 'staff'));
}

/** Shared by concludeRole and trial reconciliation. Must run inside a transaction. */
export async function concludeWithinTx(
  tx: ServiceContext,
  roleId: string,
  trialNumber: number,
  source: 'staff' | 'trial_ended',
): Promise<RoleRecord> {
  const updated = await transitionRole(tx, roleId, ['active'], {
    status: 'concluded',
    concludedAt: tx.clock.now(),
  });
  await notifyOperative(tx, updated, 'concluded', trialNumber);
  await recordAudit(tx, {
    action: 'adversarial.role_concluded',
    targetType: AUDIT_TARGET_ROLE,
    targetId: roleId,
    context: { source },
  });
  return updated;
}

export type AbortSource =
  'staff' | 'red_flag' | 'kill_switch' | 'trial_ended' | 'operative_ineligible';

/**
 * Abort inside a transaction. Locks the row, so the decision to send a STOP
 * is based on the committed state: anyone who was briefed is told to stop.
 */
export async function abortWithinTx(
  tx: ServiceContext,
  roleId: string,
  trialNumber: number,
  options: { reason: string; source: AbortSource },
): Promise<RoleRecord> {
  const current = await lockRole(tx, roleId);
  assertStatus(current, ABORTABLE_STATUSES, 'abort');
  const now = tx.clock.now();
  const userId = actorUserId(tx.actor);
  const mustStop = OPERATIVE_STOPPABLE_STATUSES.includes(current.status);
  const redFlag = options.source === 'red_flag';
  const updated = await transitionRole(tx, roleId, [current.status], {
    status: 'aborted',
    abortedAt: now,
    abortReason: options.reason,
    abortedByUserId: userId,
    ...(redFlag ? { redFlagRaisedAt: now, redFlagRaisedByUserId: userId } : {}),
    ...(mustStop ? { stopNoticeDelivery: 'pending' as const } : {}),
  });
  for (let revision = 1; revision <= current.briefingRevision; revision++) {
    await cancelJob(tx, briefJobKey(roleId, revision));
  }
  if (mustStop) {
    await enqueueJob(
      tx,
      ADVERSARIAL_ABORT_JOB,
      { roleId },
      { dedupeKey: abortJobKey(roleId), maxAttempts: ABORT_MAX_ATTEMPTS },
    );
    await notifyOperative(tx, updated, 'stop', trialNumber);
  }
  // The free-text reason stays on the role row (staff-only), never in the shared audit log.
  await recordAudit(roleAuditContext(tx, current.operativeMemberId), {
    action: 'adversarial.role_aborted',
    targetType: AUDIT_TARGET_ROLE,
    targetId: roleId,
    context: {
      source: options.source,
      previousStatus: current.status,
      operativeStopped: mustStop,
    },
  });
  return updated;
}

/**
 * Abort at any time. Never blocked by validation of the reason text (it is
 * sanitized instead). A briefed operative is told to STOP immediately.
 */
export async function abortRole(
  ctx: ServiceContext,
  input: z.input<typeof abortRoleSchema>,
): Promise<RoleRecord> {
  const data = parseInput(abortRoleSchema, input);
  await authorize(ctx, 'canManageAdversarial', { type: AUDIT_TARGET_ROLE, id: data.roleId });
  const role = await loadManagedRole(ctx, data.roleId, 'adversarial.abort_role');
  assertStatus(role, ABORTABLE_STATUSES, 'abort');
  const trial = await loadTrial(ctx, role.trialId);
  const reason = sanitizeStopText(data.reason, LIMITS.stopText);
  return withTransaction(ctx, (tx) =>
    abortWithinTx(tx, role.id, trial.number, { reason, source: 'staff' }),
  );
}
