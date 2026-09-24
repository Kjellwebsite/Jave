import type { EventSubscriber } from '../events/bus';
import type { JobHandlerMap, RecurringJob } from '../jobs/worker';
import {
  jobHandlers as lifecycleJobHandlers,
  recurringJobs as lifecycleRecurringJobs,
  subscribers as lifecycleSubscribers,
} from './lifecycle';

// Module: adversarial — SAFE adversarial evaluation of security culture inside
// authorized trials. Staff-only except the operative's own briefing.

// Scenario library
export {
  createScenario,
  deleteScenario,
  getScenario,
  listScenarios,
  scenarioSafetyFields,
  seedStarterScenarios,
  updateScenario,
  type ScenarioRecord,
} from './scenarios.service';
export { STARTER_SCENARIOS, type StarterScenario } from './starter-scenarios';

// Role lifecycle
export {
  abortRole,
  activateRole,
  authorizeRole,
  briefRole,
  concludeRole,
  planRole,
  raiseRedFlag,
  type RedFlagResult,
} from './roles.service';
export {
  addTrigger,
  fireTrigger,
  recordObservation,
  type ObservationRecord,
  type TriggerRecord,
} from './observations.service';
export { evaluateRole, revealRole, type EvaluationResult } from './evaluation.service';

// Reads
export {
  getMyBriefing,
  getRole,
  listMyBriefings,
  listRoles,
  type MyBriefing,
  type RoleDetail,
  type RoleSummary,
} from './queries.service';

// Discord job contracts + bot callbacks
export * from './discord-jobs';
export {
  loadBriefingDelivery,
  loadDebrief,
  loadStopNotice,
  markBriefingDelivered,
  markDebriefPosted,
  markStopNoticeDelivered,
  type BriefingDelivery,
  type DebriefDelivery,
  type StopNoticeDelivery,
} from './delivery.service';

// Background work
export {
  abortIneligibleOperatives,
  ADVERSARIAL_SWEEP_JOB,
  enforceKillSwitch,
  reconcileTrialRoles,
  remindPendingReveals,
  REVEAL_REMINDER_AFTER_MS,
  SWEEP_INTERVAL_MS,
} from './lifecycle';

// Pure building blocks
export * from './safety';
export * from './scoring';
export {
  buildBriefing,
  buildDebrief,
  DEBRIEF_DISCLOSURE,
  formatOutcomeCounts,
  OPERATING_RULES,
  renderBriefingText,
  renderDebriefText,
  STOP_NOTICE,
  STOP_PROTOCOL,
  type BriefingTrigger,
  type BriefingView,
  type DebriefView,
} from './briefing';
export {
  ABORTABLE_STATUSES,
  acceptsObservations,
  isAwaitingReveal,
  LIVE_STATUSES,
  OUTCOME_LABELS,
  TECHNIQUE_LABELS,
  wasExposed,
  type Outcome,
  type RoleRecord,
  type RoleStatus,
  type Technique,
} from './state';
export { LIMITS, MIN_LENGTHS } from './schemas';
export { adversarialEnabled } from './guards';

/** Job handlers owned by this module (non-Discord). */
export const jobHandlers: JobHandlerMap = lifecycleJobHandlers;
/** Domain event subscribers owned by this module. */
export const subscribers: readonly EventSubscriber[] = lifecycleSubscribers;
/** Periodic work owned by this module. */
export const recurringJobs: readonly RecurringJob[] = lifecycleRecurringJobs;
