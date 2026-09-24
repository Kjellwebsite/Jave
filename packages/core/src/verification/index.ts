import type { EventSubscriber } from '../events/bus';
import type { JobHandlerMap, RecurringJob } from '../jobs/worker';
import {
  expireVerificationsJob,
  VERIFICATION_EXPIRE_JOB,
  VERIFICATION_EXPIRY_SWEEP_EVERY_MS,
} from './expiry';

// Module: verification — a reusable framework for verifying claims about a
// member (identity, skill, project, contribution, achievement, trial).

export * from './types';
export * from './schemas';
export {
  assertTransition,
  canTransition,
  computeExpiry,
  isOpen,
  isPastExpiry,
  MAX_EVIDENCE_PER_VERIFICATION,
  MAX_OPEN_VERIFICATIONS_PER_MEMBER,
  OPEN_STATUSES,
  openedBy,
  type OpenedBy,
  targetKeys,
  VERIFICATION_EXPIRY_DAYS,
  verificationReference,
  verifierConflict,
  type VerifierConflict,
} from './rules';
export { STATUS_LABELS, TYPE_LABELS, verificationHeadline } from './copy';
export {
  classifyIdentityRoles,
  IDENTITY_ELIGIBLE_ROLES,
  strategyFor,
  VERIFICATION_STRATEGIES,
} from './strategies';
export { requestVerification } from './request.service';
export { assignVerifier, startReview } from './review.service';
export { decideVerification, revokeVerification } from './decision.service';
export {
  getVerification,
  listVerifications,
  type VerificationDetail,
  type VerificationEvidenceItem,
  type VerificationPerson,
  type VerificationStaffDetail,
  type VerificationSummary,
} from './query.service';
export {
  EXPIRY_BATCH_SIZE,
  EXPIRY_MAX_BATCHES,
  expireDueVerifications,
  type ExpirySweepResult,
  VERIFICATION_EXPIRE_JOB,
  VERIFICATION_EXPIRY_SWEEP_EVERY_MS,
} from './expiry';
export {
  getQueueCard,
  markQueueCardPosted,
  type QueueCard,
  type QueueCardJobPayload,
  queueCardJobPayloadSchema,
  VERIFICATION_QUEUE_CARD_JOB,
} from './discord-jobs';

/** Job handlers owned by this module (non-Discord). */
export const jobHandlers: JobHandlerMap = {
  [VERIFICATION_EXPIRE_JOB]: expireVerificationsJob,
};
/** Domain event subscribers owned by this module. */
export const subscribers: readonly EventSubscriber[] = [];
/** Periodic work owned by this module. */
export const recurringJobs: readonly RecurringJob[] = [
  { type: VERIFICATION_EXPIRE_JOB, everyMs: VERIFICATION_EXPIRY_SWEEP_EVERY_MS },
];
