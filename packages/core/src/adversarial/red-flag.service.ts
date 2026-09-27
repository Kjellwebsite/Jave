import { and, eq, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import { adversarialRoles } from '@jave/database';
import { recordAudit } from '../audit/audit.service';
import { type ServiceContext, withTransaction } from '../kernel/context';
import { UnauthenticatedError } from '../kernel/errors';
import { parseInput } from '../kernel/validation';
import { actorUserId } from '../permissions/actor';
import { can, isSelf } from '../permissions/authorize';
import {
  actorParticipatesIn,
  AUDIT_TARGET_ROLE,
  denyAsNotFound,
  findRole,
  loadTrial,
  lockRole,
  roleAuditContext,
} from './guards';
import { alertStaff } from './notify';
import { abortWithinTx } from './roles.service';
import { sanitizeStopText, STOP_WORD } from './safety';
import { LIMITS, raiseRedFlagSchema } from './schemas';
import { LIVE_STATUSES, type RoleRecord, type RoleStatus } from './state';

/**
 * The stop word. Saying or typing RED FLAG ends a live exercise immediately;
 * it is never blocked by validation, standing or length, and never errors on
 * a concurrent stop.
 */

export interface RedFlagResult {
  roleId: string;
  /** Status afterwards: aborted, or unchanged when the exercise had already ended normally. */
  status: RoleStatus;
  /** Nothing was running any more (already stopped, concluded or revealed). */
  alreadyStopped: boolean;
}

interface RedFlagRaise {
  raisedBy: 'the operative' | 'staff';
  raiserUserId: string | null;
  note: string | null;
  trialNumber: number;
}

/**
 * RED FLAG after the exercise ended normally (concluded or revealed): nothing
 * is left to stop, so the state and the debrief stay as they are. The flag is
 * recorded once and managers are alerted to follow up.
 */
async function recordRedFlagAfterEnd(
  tx: ServiceContext,
  role: RoleRecord,
  raise: RedFlagRaise,
): Promise<RedFlagResult> {
  const now = tx.clock.now();
  const [flagged] = await tx.db
    .update(adversarialRoles)
    .set({ redFlagRaisedAt: now, redFlagRaisedByUserId: raise.raiserUserId, updatedAt: now })
    .where(and(eq(adversarialRoles.id, role.id), isNull(adversarialRoles.redFlagRaisedAt)))
    .returning({ id: adversarialRoles.id });
  if (flagged) {
    await recordAudit(roleAuditContext(tx, role.operativeMemberId), {
      action: 'adversarial.red_flag_after_end',
      targetType: AUDIT_TARGET_ROLE,
      targetId: role.id,
      context: {
        status: role.status,
        by: raise.raisedBy === 'staff' ? 'staff' : 'operative',
        hasNote: raise.note !== null,
      },
    });
    const ended = role.status === 'revealed' ? 'was revealed' : 'concluded';
    await alertStaff(tx, {
      roleId: role.id,
      trialId: role.trialId,
      fact: 'red-flag',
      title: `${STOP_WORD} — TRIAL #${raise.trialNumber}`,
      body: `${STOP_WORD} was raised by ${raise.raisedBy} after the exercise ${ended}. Nothing is running. Follow up now.${raise.note ? ` Note: ${raise.note}` : ''}`,
      excludeUserIds: raise.raiserUserId ? [raise.raiserUserId] : [],
    });
  }
  return { roleId: role.id, status: role.status, alreadyStopped: true };
}

/**
 * The stop word. The operative (for their own briefed role) or staff can raise
 * it. A live exercise ends immediately and every manager is alerted; after a
 * normal end it is recorded and escalated without rewriting the outcome.
 * Idempotent, never blocked by validation. Anyone else gets the same answer as
 * for a role that does not exist.
 */
export async function raiseRedFlag(
  ctx: ServiceContext,
  input: z.input<typeof raiseRedFlagSchema>,
): Promise<RedFlagResult> {
  const data = parseInput(raiseRedFlagSchema, input);
  if (ctx.actor.kind === 'anonymous') throw new UnauthenticatedError();
  const role = await findRole(ctx, data.roleId);
  const isOperative = role !== null && isSelf(ctx.actor, role.operativeMemberId);
  // The stop word stays open to the operative whatever their standing: a STOP is never blocked.
  const visible =
    role !== null &&
    ((isOperative && role.briefedAt !== null) ||
      (can(ctx, 'canManageAdversarial') && !(await actorParticipatesIn(ctx, role.trialId))));
  if (!role || !visible) return denyAsNotFound(ctx, data.roleId, 'adversarial.red_flag', role);
  if (role.status === 'aborted')
    return { roleId: role.id, status: 'aborted', alreadyStopped: true };
  const trial = await loadTrial(ctx, role.trialId);
  const raise: RedFlagRaise = {
    raisedBy: isOperative ? 'the operative' : 'staff',
    raiserUserId: actorUserId(ctx.actor),
    note: data.note?.trim() ? sanitizeStopText(data.note, LIMITS.stopText) : null,
    trialNumber: trial.number,
  };

  return withTransaction(ctx, async (tx) => {
    // Decided under the lock: a concurrent RED FLAG, abort or conclusion may have
    // won the race. The stop word never errors.
    const current = await lockRole(tx, role.id);
    if (current.status === 'aborted')
      return { roleId: role.id, status: current.status, alreadyStopped: true };
    if (!LIVE_STATUSES.includes(current.status)) return recordRedFlagAfterEnd(tx, current, raise);
    await abortWithinTx(tx, role.id, trial.number, {
      reason: `${STOP_WORD} raised by ${raise.raisedBy}${raise.note ? `: ${raise.note}` : '.'}`,
      source: 'red_flag',
    });
    await alertStaff(tx, {
      roleId: role.id,
      trialId: role.trialId,
      fact: 'red-flag',
      title: `${STOP_WORD} — TRIAL #${trial.number}`,
      body: `${STOP_WORD} was raised by ${raise.raisedBy}. The exercise is stopped. Follow up with the operative now.`,
      excludeUserIds: raise.raiserUserId ? [raise.raiserUserId] : [],
    });
    return { roleId: role.id, status: 'aborted', alreadyStopped: false };
  });
}
