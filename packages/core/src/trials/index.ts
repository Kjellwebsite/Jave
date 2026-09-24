import type { EventSubscriber } from '../events/bus';
import type { JobHandlerMap, RecurringJob } from '../jobs/worker';
import { SWEEP_INTERVAL_MS, TRIAL_JOBS } from './constants';
import { trialJobHandlers } from './jobs';

// Module: trials — the Trial / Gauntlet system. See docs/modules/trials.md.

// Vocabulary, limits and pure logic
export {
  ELIGIBLE_ROLES,
  LIMITS,
  MAX_PARTICIPANTS,
  MAX_TEAM_SIZE,
  NATO_ALPHABET,
  RUBRIC_MAX_CRITERIA,
  RUBRIC_MIN_CRITERIA,
  TRIAL_CATEGORIES,
  TRIAL_JOBS,
  TRIAL_STATUSES,
  trialRef,
  type TrialCategory,
  type TrialStatus,
} from './constants';
export * from './schemas';
export * from './state-machine';
export * from './team-assignment';
export * from './scoring';
export * from './timing';
export { STARTER_TEMPLATES, type StarterTemplate } from './starter-templates';
export { eligibilityProblem } from './guards';

// Services. Helpers that skip authorization (startTrialInternal,
// closeSubmissionsInternal, loadTemplate, assertFacetKeys) stay module-private.
export {
  createTemplate,
  deactivateTemplate,
  getTemplate,
  listTemplates,
  seedStarterTemplates,
  updateTemplate,
  type SeedResult,
  type TemplateView,
} from './templates.service';
export * from './admin.service';
export * from './roster.service';
export {
  closeSubmissions,
  extendDeadline,
  startTrial,
  type CloseOutcome,
  type CloseTrigger,
  type StartTrigger,
} from './run.service';
export * from './participation.service';
export * from './evaluation.service';
export * from './rank-consequence.service';
export * from './views.shared';
export * from './views.service';
export * from './staff-view.service';

// Discord job contracts, spec loaders and callbacks
export * from './discord-jobs';
export * from './discord.service';
export { sweepOverdueTrials } from './jobs';

/** Job handlers owned by this module (non-Discord). */
export const jobHandlers: JobHandlerMap = trialJobHandlers;
/** Domain event subscribers owned by this module. */
export const subscribers: readonly EventSubscriber[] = [];
/** Periodic work owned by this module. */
export const recurringJobs: readonly RecurringJob[] = [
  { type: TRIAL_JOBS.sweepOverdue, everyMs: SWEEP_INTERVAL_MS },
];
