import type { EventSubscriber } from '../events/bus';
import type { JobHandlerMap, RecurringJob } from '../jobs/worker';

// Module: projects — projects, membership, links, milestones, activity and contributions.
export {
  canViewProject,
  type ProjectAccess,
  type ProjectRecord,
  type ProjectRole,
  type ProjectVisibility,
} from './access';
export * from './status';
export * from './slug';
export * from './schemas';
export * from './ordering';
export * from './projects.service';
export * from './members.service';
export * from './links.service';
export * from './milestones.service';
export * from './queries.service';
export * from './contributions.service';

/** Job handlers owned by this module (non-Discord). */
export const jobHandlers: JobHandlerMap = {};
/** Domain event subscribers owned by this module. */
export const subscribers: readonly EventSubscriber[] = [];
/** Periodic work owned by this module. */
export const recurringJobs: readonly RecurringJob[] = [];
