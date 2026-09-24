import type { EventSubscriber } from '../events/bus';
import type { JobHandlerMap, RecurringJob } from '../jobs/worker';
import { inviteJobHandlers, inviteRecurringJobs, inviteSubscribers } from './jobs';

// Module: invites — referral attribution (INVITED → JOINED → RETAINED → VALID),
// referral codes, campaigns, anomaly detection, leaderboard and funnels.
// No Discord job contracts: the bot calls syncInvites / attributeJoin directly.

export * from './constants';
export * from './detect';
export * from './anomaly';
export * from './lifecycle';
export * from './funnel';
export { type ReferralRecord } from './scoring';
export * from './sync.service';
export * from './attribution.service';
export * from './campaigns.service';
export * from './referral-codes.service';
export * from './lifecycle.service';
export * from './review.service';
export * from './stats.service';
export { REFERRAL_SWEEP_JOB } from './jobs';

/** Job handlers owned by this module (non-Discord). */
export const jobHandlers: JobHandlerMap = inviteJobHandlers;
/** Domain event subscribers owned by this module. */
export const subscribers: readonly EventSubscriber[] = inviteSubscribers;
/** Periodic work owned by this module. */
export const recurringJobs: readonly RecurringJob[] = inviteRecurringJobs;
