import type { EventSubscriber } from '../events/bus';
import type { JobHandlerMap, RecurringJob } from '../jobs/worker';

// Module: applications — services are exported from this file.

/** Job handlers owned by this module (non-Discord). */
export const jobHandlers: JobHandlerMap = {};
/** Domain event subscribers owned by this module. */
export const subscribers: readonly EventSubscriber[] = [];
/** Periodic work owned by this module. */
export const recurringJobs: readonly RecurringJob[] = [];
