import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { trials } from '@jave/database';
import { recordAudit } from '../audit/audit.service';
import { MINUTE } from '../kernel/clock';
import { type ServiceContext, withTransaction } from '../kernel/context';
import { enqueueJob } from '../jobs/queue';
import { isJaveError } from '../kernel/errors';
import { notifyCapabilityHolders } from '../notifications/notifications.service';
import { type JobHandler, type JobHandlerMap, PermanentJobError } from '../jobs/worker';
import { dedupeKeys, TRIAL_JOBS } from './constants';
import { requireSystem } from './guards';
import { DISCORD_TRIALS_WARNING_JOB } from './discord-jobs';
import { notifyEach } from './effects';
import { notices } from './notices';
import { loadCompetitors, loadTeams, loadTrial } from './repository';
import { closeSubmissionsInternal, startTrialInternal } from './run.service';
import { closeTime } from './timing';

/**
 * Background work owned by the trials module. Handlers run with a system
 * actor and are idempotent: a job scheduled for a deadline that has since
 * moved (extension) or a trial that is no longer active does nothing.
 */

const deadlineWarningPayload = z.object({
  trialId: z.uuid(),
  minutes: z.number().int().min(1),
  deadlineAt: z.iso.datetime(),
});

const closePayload = z.object({ trialId: z.uuid(), deadlineAt: z.iso.datetime() });

function parsePayload<T extends z.ZodType>(schema: T, payload: unknown): z.infer<T> {
  const result = schema.safeParse(payload);
  if (!result.success) throw new PermanentJobError(`invalid payload: ${result.error.message}`);
  return result.data;
}

/** Fan a deadline warning out to DMs and team channels. */
const handleDeadlineWarning: JobHandler = async (ctx, payload) => {
  const data = parsePayload(deadlineWarningPayload, payload);
  return withTransaction(ctx, async (t) => {
    const trial = await loadTrial(t, data.trialId);
    if (trial.status !== 'active' || !trial.deadlineAt) return { skipped: 'not_active' };
    if (trial.deadlineAt.toISOString() !== new Date(data.deadlineAt).toISOString())
      return { skipped: 'stale_deadline' };
    const deadlineMs = trial.deadlineAt.getTime();
    // A late-running job reports the time actually left, and never fires after the deadline.
    const minutesLeft = Math.ceil((deadlineMs - t.clock.now().getTime()) / MINUTE);
    if (minutesLeft <= 0) return { skipped: 'deadline_passed' };
    const minutesRemaining = Math.min(data.minutes, minutesLeft);
    const competitors = await loadCompetitors(t, trial.id);
    await notifyEach(t, competitors, 'trial.deadline', (c) => ({
      ...notices.warning(trial, minutesRemaining, trial.deadlineAt!),
      dedupeKey: dedupeKeys.notifyWarning(trial.id, data.minutes, deadlineMs, c.memberId),
      data: { trialId: trial.id, minutesRemaining },
    }));
    const teams = (await loadTeams(t, trial.id)).filter((team) => team.discordChannelId);
    for (const team of teams) {
      await enqueueJob(
        t,
        DISCORD_TRIALS_WARNING_JOB,
        {
          trialId: trial.id,
          teamId: team.id,
          minutesRemaining,
          deadlineAt: trial.deadlineAt.toISOString(),
        },
        { dedupeKey: dedupeKeys.discordWarning(team.id, data.minutes, deadlineMs) },
      );
    }
    return { notified: competitors.length, channels: teams.length };
  });
};

const autoStartPayload = z.object({ trialId: z.uuid(), scheduledStartAt: z.iso.datetime() });

/**
 * Scheduled start. Skips silently when the schedule moved or the trial is no
 * longer waiting to start. A trial that cannot start (e.g. an empty team, or
 * trials disabled) stays in teams_assigned for staff to fix: the skip is
 * audited durably as `trial.auto_start_skipped` instead of dead-lettering.
 */
const handleAutoStart: JobHandler = async (ctx, payload) => {
  const data = parsePayload(autoStartPayload, payload);
  const expectedStartAt = new Date(data.scheduledStartAt);
  const trial = await loadTrial(ctx, data.trialId);
  if (trial.status !== 'teams_assigned') return { skipped: 'not_waiting' };
  if (trial.scheduledStartAt?.getTime() !== expectedStartAt.getTime())
    return { skipped: 'stale_schedule' };
  try {
    await startTrialInternal(ctx, trial.id, { trigger: 'scheduled', expectedStartAt });
    return { started: true };
  } catch (error) {
    if (!isJaveError(error) || (error.code !== 'INVALID_STATE' && error.code !== 'DISABLED'))
      throw error;
    await recordAudit(
      ctx,
      {
        action: 'trial.auto_start_skipped',
        targetType: 'trial',
        targetId: trial.id,
        result: 'failure',
        context: { scheduledStartAt: data.scheduledStartAt, reason: error.userMessage },
      },
      { durable: true },
    );
    await notifyCapabilityHolders(ctx, 'canManageTrials', {
      type: 'trial.attention',
      ...notices.autoStartSkipped(trial, error.userMessage),
      dedupeKey: dedupeKeys.notifyAutoStartSkipped(trial.id, expectedStartAt.getTime()),
      data: { trialId: trial.id },
    });
    ctx.logger.warn({ trialId: trial.id, reason: error.userMessage }, 'scheduled start skipped');
    return { skipped: error.userMessage };
  }
};

/** Deadline + grace reached: move the trial into evaluation. */
const handleCloseSubmissions: JobHandler = async (ctx, payload) => {
  const data = parsePayload(closePayload, payload);
  const outcome = await closeSubmissionsInternal(ctx, data.trialId, {
    trigger: 'deadline',
    expectedDeadline: new Date(data.deadlineAt).toISOString(),
  });
  return { ...outcome };
};

/**
 * Safety net for a close job that dead-lettered or never ran: every active
 * trial past its close time is moved into evaluation.
 */
export async function sweepOverdueTrials(ctx: ServiceContext): Promise<string[]> {
  requireSystem(ctx);
  const now = ctx.clock.now();
  const active = await ctx.db.select().from(trials).where(eq(trials.status, 'active'));
  const overdue = active.filter(
    (trial) =>
      trial.deadlineAt !== null &&
      closeTime(trial.deadlineAt, trial.graceMinutes).getTime() <= now.getTime(),
  );
  const closed: string[] = [];
  for (const trial of overdue) {
    const outcome = await closeSubmissionsInternal(ctx, trial.id, { trigger: 'sweep' });
    if (outcome.closed) closed.push(trial.id);
  }
  return closed;
}

const handleSweep: JobHandler = async (ctx) => ({ closed: await sweepOverdueTrials(ctx) });

export const trialJobHandlers: JobHandlerMap = {
  [TRIAL_JOBS.deadlineWarning]: handleDeadlineWarning,
  [TRIAL_JOBS.closeSubmissions]: handleCloseSubmissions,
  [TRIAL_JOBS.autoStart]: handleAutoStart,
  [TRIAL_JOBS.sweepOverdue]: handleSweep,
};
