import type { EventSubscriber } from '../events/bus';
import type { JobHandlerMap, RecurringJob } from '../jobs/worker';
import {
  deadlineReminderJob,
  expireOverdueJob,
  MISSION_EXPIRE_JOB,
  MISSION_REMINDER_JOB,
  missionRecurringJobs,
} from './sweeps';

// Module: missions — mission lifecycle, assignments (individual and team),
// submissions and review, deadline sweeps, and mission views.

export {
  ASSIGNMENT_STATUSES,
  ASSIGNMENT_TRANSITIONS,
  MAX_DURATION_HOURS,
  MAX_SUBMISSION_ATTEMPTS,
  MISSION_STATUSES,
  MISSION_TRANSITIONS,
  MISSION_TYPES,
  REMINDER_LEAD_MS,
  canTransitionAssignment,
  canTransitionMission,
  formatMissionNumber,
  resolveDueAt,
  shouldRemind,
  type AssignmentStatus,
  type MissionStatus,
  type MissionType,
} from './rules';
export {
  assignMissionSchema,
  createMissionSchema,
  rejectSubmissionSchema,
  submitMissionSchema,
  updateMissionSchema,
  verifySubmissionSchema,
} from './schemas';
export {
  archiveMission,
  closeMission,
  createMission,
  publishMission,
  reopenMission,
  updateMission,
} from './missions.service';
export {
  abandonMission,
  acceptMission,
  assignMission,
  selfAssignMission,
  type AssignResult,
  type AssignSkipReason,
} from './assignments.service';
export { rejectSubmission, submitMission, verifySubmission } from './review.service';
export {
  getMemberMissionHistory,
  getMissionDetail,
  listMyMissions,
  listOpenMissions,
  listSubmissionsForReview,
  type MissionDetail,
  type MissionHistoryItem,
  type MissionReward,
  type MissionSummary,
  type MyMissionItem,
  type OpenMissionItem,
  type OwnAssignmentView,
  type ReviewQueueItem,
  type StaffAssignmentView,
} from './views.service';
export {
  DISCORD_MISSION_ANNOUNCE_JOB,
  DISCORD_MISSION_REFRESH_CARD_JOB,
  MISSION_ACCEPT_CUSTOM_ID_PREFIX,
  getMissionCard,
  markMissionAnnounced,
  missionAcceptCustomId,
  missionAnnouncePayloadSchema,
  missionRefreshCardPayloadSchema,
  type MissionAnnouncePayload,
  type MissionCard,
  type MissionRefreshCardPayload,
} from './discord-jobs';
export {
  EXPIRY_SWEEP_EVERY_MS,
  MISSION_EXPIRE_JOB,
  MISSION_REMINDER_JOB,
  REMINDER_SWEEP_EVERY_MS,
} from './sweeps';
export type { AssignmentRecord, MissionRecord } from './store';

/** Job handlers owned by this module (non-Discord). */
export const jobHandlers: JobHandlerMap = {
  [MISSION_EXPIRE_JOB]: expireOverdueJob,
  [MISSION_REMINDER_JOB]: deadlineReminderJob,
};
/** Domain event subscribers owned by this module. */
export const subscribers: readonly EventSubscriber[] = [];
/** Periodic work owned by this module. */
export const recurringJobs: readonly RecurringJob[] = missionRecurringJobs;
