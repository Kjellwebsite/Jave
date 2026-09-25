import type { EventSubscriber } from '../events/bus';
import type { JobHandlerMap, RecurringJob } from '../jobs/worker';
import { analyticsJobHandlers, analyticsRecurringJobs } from './jobs';

// Module: analytics — organizational health for staff (canViewAnalytics).
// Descriptive counts and rates; never engagement farming or a global score.

export * from './window';
export * from './metrics';
export { authorizeAnalytics } from './access';
export type { RetentionCohort, ProgressionRole } from './queries/people';
export type { ApplicationStatus, ProjectStatus, TrialStatus } from './queries/pipeline';
export type { ModAction, SecurityTrigger } from './queries/operations';
export * from './overview.service';
export * from './progress.service';
export * from './snapshots.service';
export { ANALYTICS_SNAPSHOT_JOB } from './jobs';

/** Job handlers owned by this module (non-Discord). */
export const jobHandlers: JobHandlerMap = analyticsJobHandlers;
/** Domain event subscribers owned by this module. */
export const subscribers: readonly EventSubscriber[] = [];
/** Periodic work owned by this module. */
export const recurringJobs: readonly RecurringJob[] = analyticsRecurringJobs;
