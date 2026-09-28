import { z } from 'zod';
import type { EventSubscriber } from '../events/bus';
import type { JobHandlerMap, RecurringJob } from '../jobs/worker';
import { withActor } from '../kernel/context';
import { systemActor } from '../permissions/actor';
import { revokeUserSessions } from './sessions.service';

export * from './constants';
export * from './export.service';
export * from './erasure.service';
export { SCRUBBED_COLUMNS } from './erasure-steps';
export { scrubJson, scrubTerms, scrubText } from './scrub';
export * from './sessions.service';

const banPayload = z.object({ action: z.string(), targetUserId: z.uuid() });

/**
 * A ban ends every dashboard session of the banned account. (Quarantine does
 * not: a quarantined member already has no capabilities on the next request,
 * and a release should not force them to sign in again.)
 */
const endSessionsOnBan: EventSubscriber = {
  name: 'privacy.end-sessions-on-ban',
  types: ['moderation.case_created'],
  async handle(ctx, event) {
    const payload = banPayload.safeParse(event.payload);
    if (!payload.success || payload.data.action !== 'ban') return;
    await revokeUserSessions(withActor(ctx, systemActor('ban')), {
      userId: payload.data.targetUserId,
      reason: 'banned',
    });
  },
};

export const jobHandlers: JobHandlerMap = {};
export const subscribers: readonly EventSubscriber[] = [endSessionsOnBan];
export const recurringJobs: readonly RecurringJob[] = [];
