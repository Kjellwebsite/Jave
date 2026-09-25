import { and, eq, inArray, isNotNull, isNull, lte, or } from 'drizzle-orm';
import { adversarialRoles, trials } from '@jave/database';
import type { EventSubscriber } from '../events/bus';
import { type ServiceContext, withTransaction } from '../kernel/context';
import { DAY, MINUTE } from '../kernel/clock';
import { ConflictError, InvalidStateError } from '../kernel/errors';
import { isUuid } from '../kernel/ids';
import type { JobHandlerMap, RecurringJob } from '../jobs/worker';
import { adversarialEnabled, operativeIneligibility } from './guards';
import { remindReveal } from './notify';
import { abortWithinTx, concludeWithinTx } from './roles.service';
import { LIVE_STATUSES, PLANNING_TRIAL_STATUSES, type RoleRecord } from './state';

/**
 * Background safety nets. Everything here runs as the system actor and is
 * idempotent: the trial and the kill switch in the database are the source of
 * truth, never the event payload.
 */

export const ADVERSARIAL_SWEEP_JOB = 'adversarial.sweep';
export const SWEEP_INTERVAL_MS = 15 * MINUTE;
/** A reveal is overdue this long after the trial stopped running. */
export const REVEAL_REMINDER_AFTER_MS = 3 * DAY;

const KILL_SWITCH_REASON = 'Global kill switch turned off.';
const TRIAL_CANCELLED_REASON = 'Trial cancelled.';
const TRIAL_ENDED_REASON = 'Trial ended before the exercise ran.';
const INELIGIBLE_REASON = 'Operative no longer eligible.';

export interface ReconcileResult {
  concluded: number;
  aborted: number;
}

type LiveRole = Pick<RoleRecord, 'id' | 'status'>;

/**
 * Run `fn` per item; a role that changed concurrently (someone else already
 * concluded or aborted it) is skipped instead of failing the whole sweep.
 */
async function forEachRole<T>(
  ctx: ServiceContext,
  items: readonly T[],
  fn: (item: T) => Promise<void>,
): Promise<number> {
  let done = 0;
  for (const item of items) {
    try {
      await fn(item);
      done++;
    } catch (error) {
      if (!(error instanceof InvalidStateError || error instanceof ConflictError)) throw error;
      ctx.logger.warn({ err: error }, 'adversarial role changed concurrently; skipped');
    }
  }
  return done;
}

/**
 * Bring a trial's live roles in line with the trial:
 * - cancelled → abort everything live (operatives told to STOP);
 * - evaluating/completed → conclude active exercises, abort ones that never ran.
 */
export async function reconcileTrialRoles(
  ctx: ServiceContext,
  trialId: string,
): Promise<ReconcileResult> {
  const result: ReconcileResult = { concluded: 0, aborted: 0 };
  const [trial] = await ctx.db
    .select({ number: trials.number, status: trials.status })
    .from(trials)
    .where(eq(trials.id, trialId));
  if (!trial || PLANNING_TRIAL_STATUSES.includes(trial.status)) return result;
  const live: LiveRole[] = await ctx.db
    .select({ id: adversarialRoles.id, status: adversarialRoles.status })
    .from(adversarialRoles)
    .where(
      and(
        eq(adversarialRoles.trialId, trialId),
        inArray(adversarialRoles.status, [...LIVE_STATUSES]),
      ),
    );
  await forEachRole(ctx, live, (role) =>
    withTransaction(ctx, async (tx) => {
      if (trial.status !== 'cancelled' && role.status === 'active') {
        await concludeWithinTx(tx, role.id, trial.number, 'trial_ended');
        result.concluded++;
        return;
      }
      const reason = trial.status === 'cancelled' ? TRIAL_CANCELLED_REASON : TRIAL_ENDED_REASON;
      await abortWithinTx(tx, role.id, trial.number, { reason, source: 'trial_ended' });
      result.aborted++;
    }),
  );
  return result;
}

/** When the kill switch is off, every live role is aborted. Returns the count. */
export async function enforceKillSwitch(ctx: ServiceContext): Promise<number> {
  if (await adversarialEnabled(ctx)) return 0;
  const live = await ctx.db
    .select({ id: adversarialRoles.id, trialNumber: trials.number })
    .from(adversarialRoles)
    .innerJoin(trials, eq(trials.id, adversarialRoles.trialId))
    .where(inArray(adversarialRoles.status, [...LIVE_STATUSES]));
  return forEachRole(ctx, live, async (role) => {
    await withTransaction(ctx, (tx) =>
      abortWithinTx(tx, role.id, role.trialNumber, {
        reason: KILL_SWITCH_REASON,
        source: 'kill_switch',
      }),
    );
  });
}

/**
 * Abort live roles whose operative lost eligibility (standing changed, left
 * the team, lost the VERIFIED/staff role). A quarantined account may be
 * compromised: the exercise must not continue through it.
 */
export async function abortIneligibleOperatives(ctx: ServiceContext): Promise<number> {
  const live = await ctx.db
    .select({
      id: adversarialRoles.id,
      trialId: adversarialRoles.trialId,
      teamId: adversarialRoles.teamId,
      operativeMemberId: adversarialRoles.operativeMemberId,
      trialNumber: trials.number,
    })
    .from(adversarialRoles)
    .innerJoin(trials, eq(trials.id, adversarialRoles.trialId))
    .where(inArray(adversarialRoles.status, [...LIVE_STATUSES]));
  const ineligible: typeof live = [];
  for (const role of live) {
    const reason = await operativeIneligibility(ctx, {
      trialId: role.trialId,
      teamId: role.teamId,
      memberId: role.operativeMemberId,
    });
    if (reason) ineligible.push(role);
  }
  return forEachRole(ctx, ineligible, async (role) => {
    await withTransaction(ctx, (tx) =>
      abortWithinTx(tx, role.id, role.trialNumber, {
        reason: INELIGIBLE_REASON,
        source: 'operative_ineligible',
      }),
    );
  });
}

/** Remind managers once per role when a reveal is overdue. */
export async function remindPendingReveals(ctx: ServiceContext): Promise<number> {
  const cutoff = new Date(ctx.clock.now().getTime() - REVEAL_REMINDER_AFTER_MS);
  const due = await ctx.db
    .select({ id: adversarialRoles.id, trialId: trials.id, trialNumber: trials.number })
    .from(adversarialRoles)
    .innerJoin(trials, eq(trials.id, adversarialRoles.trialId))
    .where(
      and(
        isNull(adversarialRoles.revealedAt),
        or(
          eq(adversarialRoles.status, 'concluded'),
          and(eq(adversarialRoles.status, 'aborted'), isNotNull(adversarialRoles.activatedAt)),
        ),
        or(
          and(eq(trials.status, 'completed'), lte(trials.completedAt, cutoff)),
          and(eq(trials.status, 'cancelled'), lte(trials.cancelledAt, cutoff)),
          and(eq(trials.status, 'evaluating'), lte(trials.submissionsClosedAt, cutoff)),
        ),
      ),
    );
  for (const role of due) {
    await withTransaction(ctx, (tx) =>
      remindReveal(tx, { roleId: role.id, trialId: role.trialId, trialNumber: role.trialNumber }),
    );
  }
  return due.length;
}

/** Trials whose live roles need reconciling (trial no longer open for exercises). */
async function trialsNeedingReconcile(ctx: ServiceContext): Promise<string[]> {
  const rows = await ctx.db
    .selectDistinct({ trialId: adversarialRoles.trialId })
    .from(adversarialRoles)
    .innerJoin(trials, eq(trials.id, adversarialRoles.trialId))
    .where(
      and(
        inArray(adversarialRoles.status, [...LIVE_STATUSES]),
        inArray(trials.status, ['evaluating', 'completed', 'cancelled']),
      ),
    );
  return rows.map((row) => row.trialId);
}

export const jobHandlers: JobHandlerMap = {
  [ADVERSARIAL_SWEEP_JOB]: async (ctx) => {
    const killSwitchAborted = await enforceKillSwitch(ctx);
    const ineligibleAborted = await abortIneligibleOperatives(ctx);
    let concluded = 0;
    let aborted = 0;
    for (const trialId of await trialsNeedingReconcile(ctx)) {
      const result = await reconcileTrialRoles(ctx, trialId);
      concluded += result.concluded;
      aborted += result.aborted;
    }
    const reminded = await remindPendingReveals(ctx);
    return { killSwitchAborted, ineligibleAborted, concluded, aborted, reminded };
  },
};

export const recurringJobs: readonly RecurringJob[] = [
  { type: ADVERSARIAL_SWEEP_JOB, everyMs: SWEEP_INTERVAL_MS },
];

export const subscribers: readonly EventSubscriber[] = [
  {
    name: 'adversarial.trial-lifecycle',
    types: ['trial.cancelled', 'trial.submissions_closed', 'trial.completed'],
    handle: async (ctx, event) => {
      if (event.aggregateType !== 'trial' || !isUuid(event.aggregateId)) return;
      await reconcileTrialRoles(ctx, event.aggregateId);
    },
  },
  {
    name: 'adversarial.kill-switch',
    types: ['settings.updated'],
    handle: async (ctx, event) => {
      if (event.aggregateId !== 'trials') return;
      await enforceKillSwitch(ctx);
    },
  },
];
