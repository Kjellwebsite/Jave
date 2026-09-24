import type { EventSubscriber } from '../events/bus';
import type { JobHandlerMap, RecurringJob } from '../jobs/worker';
import { SWEEP_INTERVAL_MS } from './constants';
import { SWEEP_EXPIRED_JOB, sweepExpiredHandler } from './sweeps';

// Module: moderation — automod engine, security events, moderation cases, raid mode.
// Only authorized service functions are exported; internal helpers that skip
// authorization (executeCase, createSecurityEvent, load*View) stay private.

// Pure engine
export * from './engine/automod';
export * from './engine/join';
export * from './engine/links';
export * from './engine/normalize';
export * from './engine/risk';

// Moderation cases
export {
  addModNote,
  banMember,
  banSchema,
  CASE_CAPABILITY,
  kickMember,
  kickSchema,
  markCaseSynced,
  markCaseSyncedSchema,
  noteSchema,
  quarantineMember,
  quarantineSchema,
  releaseMember,
  releaseSchema,
  revokeCase,
  revokeCaseSchema,
  type RevokeResult,
  timeoutMember,
  timeoutSchema,
  unbanMember,
  unbanSchema,
  untimeoutMember,
  untimeoutSchema,
  warnMember,
  warnSchema,
} from './cases.service';
export {
  caseHistorySchema,
  getCase,
  getCaseHistory,
  listCases,
  listCasesSchema,
  type CaseHistory,
  type CaseHistorySummary,
  type CasePerson,
  type ModCaseView,
} from './cases.query';

// Security events
export {
  discordProfileSchema,
  markSecurityAlertPosted,
  markSecurityAlertPostedSchema,
  recordSecurityEvent,
  recordSecurityEventSchema,
  reviewSecurityEvent,
  reviewSecurityEventSchema,
  signalInputSchema,
} from './security.service';
export {
  getSecurityAlertCard,
  getSecurityEvent,
  listSecurityEvents,
  listSecurityEventsSchema,
  type SecurityEventDetail,
  type SecurityEventView,
  type SecuritySourceKey,
} from './security.query';

// Automod, raid mode, sweeps
export {
  applyAutomodDecision,
  applyAutomodDecisionSchema,
  automodEvaluationSchema,
  type AutomodOutcome,
  MAX_MENTION_COUNT_INPUT,
  MAX_MESSAGE_INPUT,
  screenMessage,
  screenMessageSchema,
  type ScreenMessageResult,
} from './automod.service';
export {
  type RaidModeResult,
  screenJoin,
  screenJoinSchema,
  type ScreenJoinResult,
  setRaidMode,
  setRaidModeSchema,
} from './raid.service';
export { SWEEP_EXPIRED_JOB, type SweepResult } from './sweeps';

// Discord job contracts (the bot implements the handlers; enqueueing stays internal)
export {
  DISCORD_JOB_CONTRACTS,
  DISCORD_MODERATION_ALERT_JOB,
  DISCORD_MODERATION_APPLY_JOB,
  DISCORD_MODERATION_DELETE_MESSAGES_JOB,
  DISCORD_MODERATION_LOCKDOWN_JOB,
  moderationAlertContract,
  moderationAlertPayloadSchema,
  type ModerationAlertPayload,
  moderationApplyContract,
  moderationApplyPayloadSchema,
  type ModerationApplyPayload,
  moderationDeleteMessagesContract,
  moderationDeleteMessagesPayloadSchema,
  type ModerationDeleteMessagesPayload,
  moderationLockdownContract,
  moderationLockdownPayloadSchema,
  type ModerationLockdownPayload,
  SECONDS_PER_DAY,
} from './discord-jobs';

// Alert card, copy, constants
export {
  ACTION_LABELS,
  type AlertCardPerson,
  buildSecurityAlertCard,
  ELEVATED_RISK_SCORE,
  type SecurityActionKey,
  type SecurityAlertCard,
  type SecurityAlertCardInput,
  type SecurityEventRecord,
  type SecurityEventStatusKey,
  TRIGGER_LABELS,
} from './alerts';
export * from './copy';
export * from './constants';
export {
  hierarchyViolation,
  overturnViolation,
  PUNITIVE_ACTIONS,
  rankOf,
  type ModerationTarget,
} from './targets';
export {
  LIVE_ACTIONS,
  REVERSAL_OF,
  type CaseEndReason,
  type LiveAction,
  type ModCaseRecord,
  type ModSource,
} from './case-engine';

/** Job handlers owned by this module (non-Discord). */
export const jobHandlers: JobHandlerMap = {
  [SWEEP_EXPIRED_JOB]: sweepExpiredHandler,
};
/** Domain event subscribers owned by this module. */
export const subscribers: readonly EventSubscriber[] = [];
/** Periodic work owned by this module. */
export const recurringJobs: readonly RecurringJob[] = [
  { type: SWEEP_EXPIRED_JOB, everyMs: SWEEP_INTERVAL_MS },
];
