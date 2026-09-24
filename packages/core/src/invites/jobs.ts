import type { EventSubscriber } from '../events/bus';
import type { JobHandlerMap, RecurringJob } from '../jobs/worker';
import { REFERRAL_SWEEP_INTERVAL_MS } from './constants';
import { referralLeftSubscriber, runReferralSweep } from './lifecycle.service';

/**
 * Hourly referral lifecycle sweep (JOINED → RETAINED → VALID, missed leaves).
 * Non-Discord background work; runs with the worker's system actor.
 */
export const REFERRAL_SWEEP_JOB = 'invites.referrals.sweep';

export const inviteJobHandlers: JobHandlerMap = {
  [REFERRAL_SWEEP_JOB]: async (ctx) => ({ ...(await runReferralSweep(ctx)) }),
};

export const inviteSubscribers: readonly EventSubscriber[] = [referralLeftSubscriber];

export const inviteRecurringJobs: readonly RecurringJob[] = [
  { type: REFERRAL_SWEEP_JOB, everyMs: REFERRAL_SWEEP_INTERVAL_MS },
];
