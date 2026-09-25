import { eq } from 'drizzle-orm';
import type { z } from 'zod';
import { trials } from '@jave/database';
import { recordAudit } from '../audit/audit.service';
import { publishEvent } from '../events/bus';
import { type ServiceContext, withTransaction } from '../kernel/context';
import { InvalidStateError, ValidationError } from '../kernel/errors';
import { parseInput } from '../kernel/validation';
import { notifyCapabilityHolders } from '../notifications/notifications.service';
import { authorize } from '../permissions/authorize';
import { getSettings } from '../settings/settings.service';
import { dedupeKeys, trialRef } from './constants';
import {
  cancelAutoStart,
  cancelDeadlineJobs,
  enqueueBrief,
  notifyEach,
  scheduleDeadlineJobs,
} from './effects';
import { assertNoConflictOfInterest, assertTrialsEnabled, requireSystem } from './guards';
import { notices } from './notices';
import {
  loadCompetitors,
  loadParticipantDetails,
  loadTeams,
  loadTrial,
  STAKE_STATUSES,
  submittedTeamIds,
} from './repository';
import { extendDeadlineSchema, trialIdSchema } from './schemas';
import { assertStatus, assertTransition } from './state-machine';
import { closeTime, computeDeadline } from './timing';
import { type TrialSummaryView, toSummaryView } from './views.shared';

/**
 * Start the clock: deadline = now + duration. Schedules deadline warnings
 * (settings.trials.deadlineWarningsMinutes) and the close job at
 * deadline + grace, briefs provisioned team channels and notifies everyone.
 */
export async function startTrial(
  ctx: ServiceContext,
  input: z.input<typeof trialIdSchema>,
): Promise<TrialSummaryView> {
  const { trialId } = parseInput(trialIdSchema, input);
  await authorize(ctx, 'canManageTrials', { type: 'trial', id: trialId });
  await assertNoConflictOfInterest(ctx, trialId, 'start it');
  return startTrialInternal(ctx, trialId, { trigger: 'manual' });
}

export type StartTrigger = 'manual' | 'scheduled';

export interface StartOptions {
  trigger: StartTrigger;
  /** Scheduled starts: the instant the job was scheduled for, re-checked under the row lock. */
  expectedStartAt?: Date;
}

/**
 * teams_assigned → active. Manual callers are already authorized; automatic
 * triggers are reserved for the system worker.
 */
export async function startTrialInternal(
  ctx: ServiceContext,
  trialId: string,
  options: StartOptions,
): Promise<TrialSummaryView> {
  if (options.trigger !== 'manual') requireSystem(ctx);
  await assertTrialsEnabled(ctx);
  const settings = await getSettings(ctx, 'trials');

  return withTransaction(ctx, async (t) => {
    const trial = await loadTrial(t, trialId, 'update');
    assertTransition(trial, 'active', 'start');
    if (
      options.expectedStartAt &&
      trial.scheduledStartAt?.getTime() !== options.expectedStartAt.getTime()
    )
      throw new InvalidStateError(`The scheduled start of ${trialRef(trial)} moved.`);
    const teams = await loadTeams(t, trialId);
    const competitors = await loadCompetitors(t, trialId);
    const empty = teams.filter((team) => !competitors.some((c) => c.teamId === team.id));
    if (teams.length === 0 || empty.length > 0)
      throw new InvalidStateError(
        `${empty.map((team) => team.name).join(', ') || 'No team'} has no members — reassign teams before starting.`,
      );
    const now = t.clock.now();
    const deadlineAt = computeDeadline(now, trial.durationMinutes);
    const graceMinutes = settings.submissionGraceMinutes;
    const [updated] = await t.db
      .update(trials)
      .set({ status: 'active', startedAt: now, deadlineAt, graceMinutes })
      .where(eq(trials.id, trialId))
      .returning();
    if (trial.scheduledStartAt) await cancelAutoStart(t, trialId, trial.scheduledStartAt);
    await scheduleDeadlineJobs(
      t,
      { id: trialId, deadlineAt, graceMinutes },
      settings.deadlineWarningsMinutes,
    );
    for (const team of teams) {
      if (team.discordChannelId && !team.briefedAt) await enqueueBrief(t, trialId, team.id);
    }
    const teamName = new Map(teams.map((team) => [team.id, team.name]));
    await notifyEach(t, competitors, 'trial.starting', (c) => ({
      ...notices.starting(trial, teamName.get(c.teamId!) ?? '', deadlineAt),
      dedupeKey: dedupeKeys.notifyStarting(trialId, c.memberId),
      data: { trialId, teamId: c.teamId, deadlineAt: deadlineAt.toISOString() },
    }));
    await recordAudit(t, {
      action: 'trial.started',
      targetType: 'trial',
      targetId: trialId,
      context: {
        trigger: options.trigger,
        deadlineAt: deadlineAt.toISOString(),
        graceMinutes,
        teams: teams.length,
        participants: competitors.length,
      },
    });
    await publishEvent(t, {
      type: 'trial.started',
      aggregateType: 'trial',
      aggregateId: trialId,
      payload: {
        ref: trialRef(trial),
        title: trial.title,
        category: trial.category,
        deadlineAt: deadlineAt.toISOString(),
        teams: teams.length,
        participants: competitors.length,
      },
    });
    return toSummaryView(updated!, now);
  });
}

/** Push the deadline back (e.g. an outage). Warnings and the close job are rescheduled. */
export async function extendDeadline(
  ctx: ServiceContext,
  input: z.input<typeof extendDeadlineSchema>,
): Promise<TrialSummaryView> {
  const data = parseInput(extendDeadlineSchema, input);
  await authorize(ctx, 'canManageTrials', { type: 'trial', id: data.trialId });
  await assertNoConflictOfInterest(ctx, data.trialId, 'extend its deadline');
  const settings = await getSettings(ctx, 'trials');

  return withTransaction(ctx, async (t) => {
    const trial = await loadTrial(t, data.trialId, 'update');
    assertStatus(trial, ['active'], 'extend the deadline');
    const now = t.clock.now();
    const previous = trial.deadlineAt!;
    const deadlineAt = computeDeadline(previous, data.minutes);
    if (deadlineAt.getTime() <= now.getTime())
      throw new ValidationError('The new deadline must be in the future.', [
        { path: 'minutes', message: 'extension ends in the past' },
      ]);
    const [updated] = await t.db
      .update(trials)
      .set({ deadlineAt })
      .where(eq(trials.id, trial.id))
      .returning();
    await cancelDeadlineJobs(t, trial.id, previous, settings.deadlineWarningsMinutes);
    await scheduleDeadlineJobs(
      t,
      { id: trial.id, deadlineAt, graceMinutes: trial.graceMinutes },
      settings.deadlineWarningsMinutes,
    );
    const competitors = await loadCompetitors(t, trial.id);
    await notifyEach(t, competitors, 'trial.deadline', (c) => ({
      ...notices.extended(trial, deadlineAt, data.reason),
      dedupeKey: dedupeKeys.notifyExtended(trial.id, deadlineAt.getTime(), c.memberId),
      data: { trialId: trial.id, deadlineAt: deadlineAt.toISOString() },
    }));
    await recordAudit(t, {
      action: 'trial.deadline_extended',
      targetType: 'trial',
      targetId: trial.id,
      context: {
        from: previous.toISOString(),
        to: deadlineAt.toISOString(),
        minutes: data.minutes,
        reason: data.reason,
      },
    });
    await publishEvent(t, {
      type: 'trial.deadline_extended',
      aggregateType: 'trial',
      aggregateId: trial.id,
      payload: { ref: trialRef(trial), deadlineAt: deadlineAt.toISOString() },
    });
    return toSummaryView(updated!, now);
  });
}

export type CloseTrigger = 'manual' | 'deadline' | 'sweep';

export interface CloseOutcome {
  closed: boolean;
  /** Why an automatic close did nothing. */
  skipped?: 'not_active' | 'stale_deadline' | 'not_due';
  submittedTeams?: number;
  teams?: number;
}

/** Staff close submissions early (or on time). */
export async function closeSubmissions(
  ctx: ServiceContext,
  input: z.input<typeof trialIdSchema>,
): Promise<CloseOutcome> {
  const { trialId } = parseInput(trialIdSchema, input);
  await authorize(ctx, 'canManageTrials', { type: 'trial', id: trialId });
  await assertNoConflictOfInterest(ctx, trialId, 'close its submissions');
  return closeSubmissionsInternal(ctx, trialId, { trigger: 'manual' });
}

/**
 * active → evaluating. Automatic triggers (the close job and the overdue
 * sweep) are no-ops unless the trial is still active, the deadline they were
 * scheduled for is still current, and the close time has passed. Manual
 * callers are already authorized; automatic triggers are system-only.
 */
export async function closeSubmissionsInternal(
  ctx: ServiceContext,
  trialId: string,
  options: { trigger: CloseTrigger; expectedDeadline?: string },
): Promise<CloseOutcome> {
  if (options.trigger !== 'manual') requireSystem(ctx);
  const settings = await getSettings(ctx, 'trials');
  return withTransaction(ctx, async (t) => {
    const trial = await loadTrial(t, trialId, 'update');
    const now = t.clock.now();
    if (options.trigger === 'manual') {
      assertTransition(trial, 'evaluating', 'close submissions');
    } else {
      if (trial.status !== 'active' || !trial.deadlineAt)
        return { closed: false, skipped: 'not_active' };
      if (options.expectedDeadline && trial.deadlineAt.toISOString() !== options.expectedDeadline)
        return { closed: false, skipped: 'stale_deadline' };
      if (now.getTime() < closeTime(trial.deadlineAt, trial.graceMinutes).getTime())
        return { closed: false, skipped: 'not_due' };
    }
    await t.db
      .update(trials)
      .set({ status: 'evaluating', submissionsClosedAt: now })
      .where(eq(trials.id, trial.id));
    if (trial.deadlineAt)
      await cancelDeadlineJobs(t, trial.id, trial.deadlineAt, settings.deadlineWarningsMinutes);

    const teams = await loadTeams(t, trial.id);
    const submitted = await submittedTeamIds(t, trial.id);
    const competitors = await loadCompetitors(t, trial.id);
    await notifyEach(t, competitors, 'trial.update', (c) => ({
      ...notices.closed(trial),
      dedupeKey: dedupeKeys.notifyClosed(trial.id, c.memberId),
      data: { trialId: trial.id },
    }));
    const stakeholders = await loadParticipantDetails(t, trial.id, STAKE_STATUSES);
    await notifyCapabilityHolders(
      t,
      'canEvaluateTrials',
      {
        type: 'trial.evaluation_requested',
        ...notices.evaluationRequested(trial, submitted.size, teams.length),
        dedupeKey: dedupeKeys.notifyEvaluators(trial.id),
        data: { trialId: trial.id },
      },
      { excludeUserIds: stakeholders.map((s) => s.userId) },
    );
    await recordAudit(t, {
      action: 'trial.submissions_closed',
      targetType: 'trial',
      targetId: trial.id,
      context: { trigger: options.trigger, submittedTeams: submitted.size, teams: teams.length },
    });
    await publishEvent(t, {
      type: 'trial.submissions_closed',
      aggregateType: 'trial',
      aggregateId: trial.id,
      payload: {
        ref: trialRef(trial),
        trigger: options.trigger,
        submittedTeams: submitted.size,
        teams: teams.length,
      },
    });
    return { closed: true, submittedTeams: submitted.size, teams: teams.length };
  });
}
