import { isNull } from 'drizzle-orm';
import type { z } from 'zod';
import { adversarialEvaluations, adversarialRoles } from '@jave/database';
import { recordAudit } from '../audit/audit.service';
import { type ServiceContext, withTransaction } from '../kernel/context';
import {
  ConflictError,
  ForbiddenError,
  InvalidStateError,
  ValidationError,
} from '../kernel/errors';
import { parseInput } from '../kernel/validation';
import { publishEvent } from '../events/bus';
import { enqueueJob } from '../jobs/queue';
import { authorize, isSelf, requireUser } from '../permissions/authorize';
import { ADVERSARIAL_DEBRIEF_JOB, DEBRIEF_MAX_ATTEMPTS, debriefJobKey } from './discord-jobs';
import { AUDIT_TARGET_ROLE, loadManagedRole, loadTrial, lockRole, transitionRole } from './guards';
import { notifyOperative, notifyTeamOfReveal } from './notify';
import { assertSafe, type SafetyField } from './safety';
import { evaluateRoleSchema, roleIdSchema } from './schemas';
import { suggestScore } from './scoring';
import { isAwaitingReveal, REVEAL_TRIAL_STATUSES, type RoleRecord } from './state';
import { type EvaluationRecord, loadEvaluation, loadOutcomes, loadRoleHeader } from './views';

export interface EvaluationResult {
  evaluation: EvaluationRecord;
  suggestedScore: number | null;
  overridden: boolean;
}

/**
 * The score to record: the evaluator's, or the suggestion when they gave none.
 * Any score that is not the suggestion (including when there is none) needs a
 * written justification.
 */
function resolveScore(
  input: { score?: number; justification?: string },
  suggested: number | null,
): { score: number; overridden: boolean } {
  const score = input.score ?? suggested;
  if (score === null)
    throw new ValidationError('No observations recorded: set a score and justify it.');
  const overridden = suggested === null || score !== suggested;
  if (overridden && !input.justification)
    throw new ValidationError(
      suggested === null
        ? 'No observations recorded: justify the score.'
        : `Justify the score: it differs from the suggested ${suggested}.`,
    );
  return { score, overridden };
}

/**
 * Score the team's security culture (0–10). The suggested score is derived
 * from the observations; the evaluator may accept it or override it with a
 * justification. The operative cannot evaluate their own role. Re-evaluation
 * replaces the previous one until the reveal, after which it is locked.
 */
export async function evaluateRole(
  ctx: ServiceContext,
  input: z.input<typeof evaluateRoleSchema>,
): Promise<EvaluationResult> {
  const data = parseInput(evaluateRoleSchema, input);
  await authorize(ctx, 'canManageAdversarial', { type: AUDIT_TARGET_ROLE, id: data.roleId });
  const evaluator = requireUser(ctx);
  const role = await loadManagedRole(ctx, data.roleId, 'adversarial.evaluate_role');
  if (!isAwaitingReveal(role))
    throw new InvalidStateError(
      role.revealedAt
        ? 'The evaluation is locked after the reveal.'
        : 'Only an exercise that ran and has ended can be evaluated.',
    );
  if (isSelf(evaluator, role.operativeMemberId)) {
    await recordAudit(
      ctx,
      {
        action: 'adversarial.self_evaluation_blocked',
        targetType: AUDIT_TARGET_ROLE,
        targetId: role.id,
        result: 'denied',
      },
      { durable: true },
    );
    throw new ForbiddenError('The operative cannot evaluate their own role.');
  }
  const fields: SafetyField[] = [{ field: 'summary', text: data.summary, kind: 'report' }];
  if (data.debrief) fields.push({ field: 'debrief', text: data.debrief, kind: 'report' });
  if (data.justification)
    fields.push({ field: 'justification', text: data.justification, kind: 'report' });
  assertSafe(fields);

  return withTransaction(ctx, async (tx) => {
    const current = await lockRole(tx, role.id);
    if (!isAwaitingReveal(current))
      throw new ConflictError('The role changed in the meantime. Reload and try again.');
    // Under the row lock (recordObservation takes it too): the stored suggestion
    // reflects exactly the observations committed at evaluation time.
    const suggested = suggestScore(await loadOutcomes(tx, role.id));
    const { score, overridden } = resolveScore(data, suggested);
    const previous = await loadEvaluation(tx, role.id);
    const now = tx.clock.now();
    const values = {
      evaluatorUserId: evaluator.userId,
      securityCultureScore: score,
      suggestedScore: suggested,
      overrideJustification: overridden ? (data.justification ?? null) : null,
      summary: data.summary,
      debrief: data.debrief ?? null,
      updatedAt: now,
    };
    const [row] = await tx.db
      .insert(adversarialEvaluations)
      .values({ roleId: role.id, ...values, createdAt: now })
      .onConflictDoUpdate({ target: adversarialEvaluations.roleId, set: values })
      .returning();
    await recordAudit(tx, {
      action: 'adversarial.role_evaluated',
      targetType: AUDIT_TARGET_ROLE,
      targetId: role.id,
      context: {
        score,
        suggestedScore: suggested,
        overridden,
        previousScore: previous?.securityCultureScore ?? null,
        hasDebrief: Boolean(data.debrief),
      },
    });
    return { evaluation: row!, suggestedScore: suggested, overridden };
  });
}

/**
 * Transparency: after the trial, disclose the role to the team. Requires an
 * evaluation with a debrief. Emits adversarial.revealed, posts the debrief to
 * the team channel (Discord job) and notifies every participant on the team.
 * Aborted roles that were active are revealed too — the team was exposed.
 */
export async function revealRole(
  ctx: ServiceContext,
  input: z.input<typeof roleIdSchema>,
): Promise<RoleRecord> {
  const data = parseInput(roleIdSchema, input);
  await authorize(ctx, 'canManageAdversarial', { type: AUDIT_TARGET_ROLE, id: data.roleId });
  const role = await loadManagedRole(ctx, data.roleId, 'adversarial.reveal_role');
  if (!isAwaitingReveal(role))
    throw new InvalidStateError(
      role.revealedAt
        ? 'This role was already revealed.'
        : 'Only an exercise that ran and has ended can be revealed.',
    );
  const trial = await loadTrial(ctx, role.trialId);
  if (!REVEAL_TRIAL_STATUSES.includes(trial.status))
    throw new InvalidStateError('Reveal only after the trial has ended.');
  const header = await loadRoleHeader(ctx, role);

  return withTransaction(ctx, async (tx) => {
    // Lock before reading the evaluation: a concurrent re-evaluation cannot
    // swap the debrief between the participant notifications and the bot post.
    const current = await lockRole(tx, role.id);
    if (!isAwaitingReveal(current))
      throw new ConflictError('The role changed in the meantime. Reload and try again.');
    const evaluation = await loadEvaluation(tx, role.id);
    if (!evaluation?.debrief)
      throw new InvalidStateError('Evaluate the role and write a debrief before revealing.');
    const { debrief, securityCultureScore } = evaluation;
    const updated = await transitionRole(
      tx,
      role.id,
      ['concluded', 'aborted'],
      { status: 'revealed', revealedAt: tx.clock.now(), debriefDelivery: 'pending' },
      isNull(adversarialRoles.revealedAt),
    );
    await publishEvent(tx, {
      type: 'adversarial.revealed',
      aggregateType: 'adversarial_role',
      aggregateId: role.id,
      subjectMemberId: role.operativeMemberId,
      payload: {
        roleId: role.id,
        trialId: role.trialId,
        teamId: role.teamId,
        technique: header.scenario.technique,
        securityCultureScore,
        stoppedEarly: role.abortedAt !== null,
      },
    });
    await enqueueJob(
      tx,
      ADVERSARIAL_DEBRIEF_JOB,
      { roleId: role.id },
      { dedupeKey: debriefJobKey(role.id), maxAttempts: DEBRIEF_MAX_ATTEMPTS },
    );
    await notifyOperative(tx, updated, 'revealed', trial.number);
    const notified = await notifyTeamOfReveal(tx, {
      role: updated,
      trialNumber: trial.number,
      technique: header.scenario.technique,
      debrief,
    });
    await recordAudit(tx, {
      action: 'adversarial.role_revealed',
      targetType: AUDIT_TARGET_ROLE,
      targetId: role.id,
      context: { participantsNotified: notified, stoppedEarly: role.abortedAt !== null },
    });
    return updated;
  });
}
