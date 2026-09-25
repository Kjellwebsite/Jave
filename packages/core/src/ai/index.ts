import type { EventSubscriber } from '../events/bus';
import type { JobHandlerMap, RecurringJob } from '../jobs/worker';
import { AI_MAINTENANCE_EVERY_MS, AI_MAINTENANCE_JOB } from './constants';
import { abandonStaleRequests } from './ledger';
import { expireProposals } from './proposals.service';

// Module: ai — services are exported from this file.
// Every feature takes (ctx, deps: AiDeps, input); deps carries the provider
// built from the environment by the surface (see runtime.ts).

export * from './constants';
export { JAVE_SYSTEM_PROMPT, FEATURE_INSTRUCTIONS } from './prompts';
export { redactForAI, type RedactionResult } from './redaction';
export {
  type AiDeps,
  type AiWarning,
  type CompletionResult,
  type CompletionSpec,
  type UntrustedInput,
  runCompletion,
} from './runtime';
export * from './features.service';
export * from './structured-output';
export * from './proposals.service';
export * from './usage.service';
export * from './discord-jobs';
export { startOfUtcDay, nextUtcMidnight, countToday } from './ledger';
export {
  ACTION_KINDS,
  ACTION_KIND_NAMES,
  getActionKind,
  createResearchItemAction,
  createTaskAction,
  draftAnnouncementAction,
} from './actions/kinds';
export {
  type ActionKindDefinition,
  type ActionMeta,
  type ActionOutcome,
  type RegisteredActionKind,
  defineActionKind,
} from './actions/registry';

/** Job handlers owned by this module (non-Discord). */
export const jobHandlers: JobHandlerMap = {
  [AI_MAINTENANCE_JOB]: async (ctx) => ({
    expiredProposals: await expireProposals(ctx),
    abandonedRequests: await abandonStaleRequests(ctx),
  }),
};
/** Domain event subscribers owned by this module. */
export const subscribers: readonly EventSubscriber[] = [];
/** Periodic work owned by this module. */
export const recurringJobs: readonly RecurringJob[] = [
  { type: AI_MAINTENANCE_JOB, everyMs: AI_MAINTENANCE_EVERY_MS },
];
