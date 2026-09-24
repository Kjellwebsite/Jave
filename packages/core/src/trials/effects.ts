import type { ServiceContext } from '../kernel/context';
import { cancelJob, enqueueJob } from '../jobs/queue';
import type { NotificationType } from '../notifications/catalog';
import { notify } from '../notifications/notifications.service';
import { dedupeKeys, TRIAL_JOB_MAX_ATTEMPTS, TRIAL_JOBS } from './constants';
import {
  DISCORD_TRIALS_ANNOUNCE_JOB,
  DISCORD_TRIALS_ARCHIVE_JOB,
  DISCORD_TRIALS_BRIEF_JOB,
  DISCORD_TRIALS_PROVISION_JOB,
  DISCORD_TRIALS_TEARDOWN_JOB,
} from './discord-jobs';
import type { Notice } from './notices';
import type { TeamRecord } from './repository';
import { closeTime, warningSchedule } from './timing';

/**
 * Side-effect helpers. Every function writes into the caller's transaction
 * (transactional outbox) and is keyed so that retries never duplicate work.
 */

interface ClockedTrial {
  id: string;
  deadlineAt: Date;
  graceMinutes: number;
}

/** Deadline warnings and the close job for the trial's current deadline. */
export async function scheduleDeadlineJobs(
  ctx: ServiceContext,
  trial: ClockedTrial,
  warningsMinutes: readonly number[],
): Promise<void> {
  const deadlineMs = trial.deadlineAt.getTime();
  const deadlineAt = trial.deadlineAt.toISOString();
  for (const warning of warningSchedule(trial.deadlineAt, warningsMinutes, ctx.clock.now())) {
    await enqueueJob(
      ctx,
      TRIAL_JOBS.deadlineWarning,
      { trialId: trial.id, minutes: warning.minutes, deadlineAt },
      {
        runAt: warning.runAt,
        dedupeKey: dedupeKeys.warningJob(trial.id, warning.minutes, deadlineMs),
        maxAttempts: TRIAL_JOB_MAX_ATTEMPTS,
      },
    );
  }
  await enqueueJob(
    ctx,
    TRIAL_JOBS.closeSubmissions,
    { trialId: trial.id, deadlineAt },
    {
      runAt: closeTime(trial.deadlineAt, trial.graceMinutes),
      dedupeKey: dedupeKeys.close(trial.id, deadlineMs),
      maxAttempts: TRIAL_JOB_MAX_ATTEMPTS,
    },
  );
}

/**
 * Best-effort cancellation of the jobs scheduled for `deadlineAt`. Correctness
 * does not depend on it: the handlers skip any job whose deadline is stale.
 */
export async function cancelDeadlineJobs(
  ctx: ServiceContext,
  trialId: string,
  deadlineAt: Date,
  warningsMinutes: readonly number[],
): Promise<void> {
  const deadlineMs = deadlineAt.getTime();
  for (const minutes of new Set(warningsMinutes)) {
    await cancelJob(ctx, dedupeKeys.warningJob(trialId, minutes, deadlineMs));
  }
  await cancelJob(ctx, dedupeKeys.close(trialId, deadlineMs));
}

/** Start the trial automatically at `scheduledStartAt` (only once teams are assigned). */
export async function scheduleAutoStart(
  ctx: ServiceContext,
  trialId: string,
  scheduledStartAt: Date,
): Promise<void> {
  if (scheduledStartAt.getTime() <= ctx.clock.now().getTime()) return;
  await enqueueJob(
    ctx,
    TRIAL_JOBS.autoStart,
    { trialId, scheduledStartAt: scheduledStartAt.toISOString() },
    {
      runAt: scheduledStartAt,
      dedupeKey: dedupeKeys.autoStart(trialId, scheduledStartAt.getTime()),
      maxAttempts: TRIAL_JOB_MAX_ATTEMPTS,
    },
  );
}

export async function cancelAutoStart(
  ctx: ServiceContext,
  trialId: string,
  scheduledStartAt: Date,
): Promise<void> {
  await cancelJob(ctx, dedupeKeys.autoStart(trialId, scheduledStartAt.getTime()));
}

/** Post or refresh the recruitment card. `phase` separates distinct card states. */
export async function enqueueAnnouncement(
  ctx: ServiceContext,
  trialId: string,
  phase: string,
  runAt?: Date,
): Promise<void> {
  await enqueueJob(
    ctx,
    DISCORD_TRIALS_ANNOUNCE_JOB,
    { trialId },
    { dedupeKey: dedupeKeys.announce(trialId, phase), runAt },
  );
}

export async function enqueueProvision(
  ctx: ServiceContext,
  trialId: string,
  teamId: string,
): Promise<void> {
  await enqueueJob(
    ctx,
    DISCORD_TRIALS_PROVISION_JOB,
    { trialId, teamId },
    { dedupeKey: dedupeKeys.provision(teamId) },
  );
}

export async function enqueueBrief(
  ctx: ServiceContext,
  trialId: string,
  teamId: string,
): Promise<void> {
  await enqueueJob(
    ctx,
    DISCORD_TRIALS_BRIEF_JOB,
    { trialId, teamId },
    { dedupeKey: dedupeKeys.brief(teamId) },
  );
}

export async function enqueueArchive(ctx: ServiceContext, trialId: string): Promise<void> {
  await enqueueJob(
    ctx,
    DISCORD_TRIALS_ARCHIVE_JOB,
    { trialId },
    { dedupeKey: dedupeKeys.archive(trialId) },
  );
}

/**
 * A team is about to be deleted: drop its pending Discord work and, when it
 * already has Discord resources, schedule their removal.
 */
export async function retireTeam(ctx: ServiceContext, team: TeamRecord): Promise<void> {
  await cancelJob(ctx, dedupeKeys.provision(team.id));
  await cancelJob(ctx, dedupeKeys.brief(team.id));
  if (!team.discordChannelId && !team.discordRoleId) return;
  await enqueueJob(
    ctx,
    DISCORD_TRIALS_TEARDOWN_JOB,
    {
      trialId: team.trialId,
      teamName: team.name,
      channelId: team.discordChannelId,
      roleId: team.discordRoleId,
    },
    { dedupeKey: dedupeKeys.teardown(team.id) },
  );
}

export interface NoticeRecipient {
  userId: string;
  memberId: string;
}

/** One notification per recipient, each with its own dedupe key. */
export async function notifyEach<R extends NoticeRecipient>(
  ctx: ServiceContext,
  recipients: readonly R[],
  type: NotificationType,
  build: (recipient: R) => Notice & { dedupeKey: string; data?: Record<string, unknown> },
): Promise<void> {
  for (const recipient of recipients) {
    const { title, body, dedupeKey, data } = build(recipient);
    await notify(ctx, { recipientUserId: recipient.userId, type, title, body, dedupeKey, data });
  }
}
