import { and, eq } from 'drizzle-orm';
import type { z } from 'zod';
import { adversarialObservations, adversarialTriggers } from '@jave/database';
import { recordAudit } from '../audit/audit.service';
import { type ServiceContext, withTransaction } from '../kernel/context';
import {
  ConflictError,
  ForbiddenError,
  InvalidStateError,
  NotFoundError,
  ValidationError,
} from '../kernel/errors';
import { parseInput } from '../kernel/validation';
import { authorize, isSelf, requireUser } from '../permissions/authorize';
import { AUDIT_TARGET_ROLE, isSelectedOnTeam, loadManagedRole, lockRole } from './guards';
import { assertSafe } from './safety';
import { recordObservationSchema } from './schemas';
import { acceptsObservations } from './state';

export type ObservationRecord = typeof adversarialObservations.$inferSelect;

/**
 * Record how the team responded. Observers must be staff other than the
 * operative. The subject, when given, must be a selected participant on the
 * role's team (never the operative); the trigger, when given, must be an
 * approved trigger of the role.
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
      .select({ approvedAt: adversarialTriggers.approvedAt })
      .from(adversarialTriggers)
      .where(
        and(eq(adversarialTriggers.id, data.triggerId), eq(adversarialTriggers.roleId, role.id)),
      );
    if (!trigger) throw new NotFoundError('Trigger');
    if (!trigger.approvedAt)
      throw new InvalidStateError('Only approved triggers can be linked to an observation.');
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
      // The subject stays on the observation row (staff-only), never in the shared audit log.
      context: {
        observationId: row!.id,
        outcome: data.outcome,
        hasSubject: data.subjectMemberId !== undefined,
      },
    });
    return row!;
  });
}
