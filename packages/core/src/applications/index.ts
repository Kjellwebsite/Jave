import type { EventSubscriber } from '../events/bus';
import type { JobHandlerMap, RecurringJob } from '../jobs/worker';
import { applicationJobHandlers, applicationRecurringJobs } from './jobs';

// Module: applications — services are exported from this file.
//   import { applications } from '@jave/core'; applications.submitApplication(ctx)

// Applicant self-service
export {
  type DraftResult,
  getMyApplication,
  getOrCreateDraft,
  type MyApplicationStatus,
  submitApplication,
  updateDraft,
  withdrawApplication,
} from './applicant.service';

// Staff
export { getApplication, listApplications } from './staff-queries.service';
export {
  type ApplicationStaffSummary,
  INTERVIEW_REMINDER_LEAD_MS,
  MAX_INTERVIEW_HORIZON_MS,
  MIN_INTERVIEW_LEAD_MS,
  reviewApplication,
  type ReviewResult,
  scheduleInterview,
  startReview,
} from './review.service';
export { decideApplication, type DecisionResult } from './decision.service';

// Discord review card: contract + data + bot callback
export {
  APPLICATION_DISCORD_JOBS,
  APPLICATION_REVIEW_CARD_JOB,
  type ReviewCardJobPayload,
  reviewCardJobPayloadSchema,
} from './discord-jobs';
export {
  getReviewCard,
  type MessageRef,
  recordReviewCardMessage,
  REVIEW_CARD_EXCERPT_CHARS,
  type ReviewCard,
  type ReviewCardRecordResult,
} from './review-card.service';

// Pure model: states, rules, form, inputs, views
export {
  APPLICATION_TRANSITIONS,
  type ApplicationRecommendation,
  type ApplicationStatus,
  assertTransition,
  canTransition,
  IN_FLIGHT_STATUSES,
  isOpenStatus,
  isTerminalStatus,
  OPEN_STATUSES,
  type StaffAction,
  staffActionsFor,
} from './state-machine';
export {
  ACCEPTANCE_ROLES,
  acceptanceGrant,
  type ApplicationRequirement,
  cooldownEndsAt,
  isEligibleToApply,
  missingRequirements,
  REQUIREMENT_MESSAGES,
  type ReviewTally,
  shouldGrantApplicant,
  tallyReviews,
} from './rules';
export {
  APPLICATION_FORM_FIELDS,
  type ApplicationFormField,
  type ApplicationFormFieldKey,
  DISCORD_MODAL_LIMITS,
} from './form';
export {
  APPLICATION_FIELD_LIMITS,
  applicationRefSchema,
  decideSchema,
  isSafeHttpUrl,
  listApplicationsSchema,
  MIN_LONG_ANSWER_CHARS,
  reviewCardMessageSchema,
  reviewSchema,
  scheduleInterviewSchema,
  splitLinkList,
  STAFF_VISIBLE_STATUSES,
  startReviewSchema,
  type UpdateDraftInput,
  updateDraftSchema,
  withdrawSchema,
} from './schemas';
export type {
  ApplicantApplicationView,
  ApplicantTimelineEntry,
  ApplicationListItem,
  StaffApplicationView,
  StaffReviewView,
  StaffStatusChangeView,
} from './views';
export { APPLICATION_NUMBER_PREFIX, type PersonRef } from './repository';

// Background work
export {
  APPLICATION_DRAFT_EXPIRY_JOB,
  APPLICATION_INTERVIEW_REMINDER_JOB,
  APPLICATION_REVIEW_REMINDER_JOB,
} from './keys';
export { APPLICATION_SWEEP_BATCH_SIZE, APPLICATION_SWEEP_INTERVAL_MS } from './jobs';

/** Job handlers owned by this module (non-Discord). */
export const jobHandlers: JobHandlerMap = applicationJobHandlers;
/** Domain event subscribers owned by this module. */
export const subscribers: readonly EventSubscriber[] = [];
/** Periodic work owned by this module. */
export const recurringJobs: readonly RecurringJob[] = applicationRecurringJobs;
