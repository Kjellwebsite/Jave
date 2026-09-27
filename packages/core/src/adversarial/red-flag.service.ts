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

/** Who raised the RED FLAG, as the alert and the abort reason name them. */
export type RedFlagRaiser = 'the operative' | 'staff' | 'JAVE';

/** How it was raised: a RED FLAG control (Discord button, dashboard) or typed in Discord chat. */
export type RedFlagChannel = 'control' | 'chat';

interface RedFlagRaise {
  raisedBy: RedFlagRaiser;
  via: RedFlagChannel;
  raiserUserId: string | null;
  note: string | null;
  trialNumber: number;
}

const AUDIT_RAISER: Record<RedFlagRaiser, string> = {
  'the operative': 'operative',
  staff: 'staff',
  JAVE: 'system',
};

/** "raised by staff", "typed in chat by the operative". */
function describeRaise(raise: Pick<RedFlagRaise, 'raisedBy' | 'via'>): string {
  return raise.via === 'chat'
    ? `typed in chat by ${raise.raisedBy}`
    : `raised by ${raise.raisedBy}`;
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
        by: AUDIT_RAISER[raise.raisedBy],
        via: raise.via,
        hasNote: raise.note !== null,
      },
    });
    const ended = role.status === 'revealed' ? 'was revealed' : 'concluded';
    await alertStaff(tx, {
      roleId: role.id,
      trialId: role.trialId,
      fact: 'red-flag',
      title: `${STOP_WORD} — TRIAL #${raise.trialNumber}`,
      body: `${STOP_WORD} was ${describeRaise(raise)} after the exercise ${ended}. Nothing is running. Follow up now.${raise.note ? ` Note: ${raise.note}` : ''}`,
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
  return stopForRedFlag(ctx, role, {
    raisedBy: isOperative ? 'the operative' : ctx.actor.kind === 'system' ? 'JAVE' : 'staff',
    via: 'control',
    note: data.note ?? null,
  });
}

/**
 * Stop (or, after a normal end, record) for a RED FLAG whose raiser was
 * already established — by `raiseRedFlag`'s visibility rules or by the
 * stop-word classifier. Runs as `ctx.actor`, who is recorded as the raiser.
 */
export async function stopForRedFlag(
  ctx: ServiceContext,
  role: RoleRecord,
  input: { raisedBy: RedFlagRaiser; via: RedFlagChannel; note: string | null },
): Promise<RedFlagResult> {
  if (role.status === 'aborted')
    return { roleId: role.id, status: 'aborted', alreadyStopped: true };
  const trial = await loadTrial(ctx, role.trialId);
  const raise: RedFlagRaise = {
    raisedBy: input.raisedBy,
    via: input.via,
    raiserUserId: actorUserId(ctx.actor),
    note: input.note?.trim() ? sanitizeStopText(input.note, LIMITS.stopText) : null,
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
      reason: `${STOP_WORD} ${describeRaise(raise)}${raise.note ? `: ${raise.note}` : '.'}`,
      source: 'red_flag',
    });
    await alertStaff(tx, {
      roleId: role.id,
      trialId: role.trialId,
      fact: 'red-flag',
      title: `${STOP_WORD} — TRIAL #${trial.number}`,
      body: `${STOP_WORD} was ${describeRaise(raise)}. The exercise is stopped. Follow up with the operative now.`,
      excludeUserIds: raise.raiserUserId ? [raise.raiserUserId] : [],
    });
    return { roleId: role.id, status: 'aborted', alreadyStopped: false };
  });
}
