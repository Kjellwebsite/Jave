import type { EventSubscriber } from '../events/bus';
import type { JobHandlerMap, RecurringJob } from '../jobs/worker';
import { createJobHandlers, defaultResearchJobDeps } from './jobs';

// Module: research (SIDUS SCIENCE library) — services are exported from this file.

export * from './constants';
export * from './extraction';
export * from './schemas';
export {
  type ResearchItemRecord,
  type ResearchItemView,
  type ResearchStatus,
  canTransition,
  STATUS_LABELS,
} from './model';
export * from './research.service';
export * from './review.service';
export * from './metadata/types';
export {
  CrossrefResolver,
  CROSSREF_API_BASE,
  type CrossrefResolverOptions,
} from './metadata/crossref';
export { ArxivResolver, ARXIV_API_BASE, type ArxivResolverOptions } from './metadata/arxiv';
export * from './sidus';
export { toSidusItem } from './sync';
export { createJobHandlers, defaultResearchJobDeps, type ResearchJobDeps } from './jobs';

/** Job handlers owned by this module (non-Discord). */
export const jobHandlers: JobHandlerMap = createJobHandlers(defaultResearchJobDeps());
/** Domain event subscribers owned by this module. */
export const subscribers: readonly EventSubscriber[] = [];
/** Periodic work owned by this module. */
export const recurringJobs: readonly RecurringJob[] = [];
