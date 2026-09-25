import { z } from 'zod';
import { pageSchema } from '../kernel/pagination';
import { httpUrl, multiLineText, singleLineText } from '../achievements/guards';
import { achievementKeySchema } from '../achievements/schemas';
import { MAX_DURATION_HOURS, MISSION_TYPES } from './rules';

export const TITLE_MIN = 3;
export const TITLE_MAX = 120;
export const BRIEF_MIN = 10;
export const BRIEF_MAX = 4000;
export const REWARD_NOTE_MIN = 2;
export const REWARD_NOTE_MAX = 200;
export const MAX_ASSIGNEES_LIMIT = 1000;
export const MAX_ASSIGN_BATCH = 50;
export const SUBMISSION_MIN = 1;
export const SUBMISSION_MAX = 4000;
export const EVIDENCE_TITLE_MIN = 2;
export const EVIDENCE_TITLE_MAX = 200;
export const FEEDBACK_MIN = 3;
export const FEEDBACK_MAX = 2000;
export const FACET_KEY_MAX = 48;
export const TEAM_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;
export const HISTORY_LIMIT_MAX = 200;
export const HISTORY_LIMIT_DEFAULT = 50;

const missionFields = {
  title: singleLineText(TITLE_MIN, TITLE_MAX),
  brief: multiLineText(BRIEF_MIN, BRIEF_MAX),
  type: z.enum(MISSION_TYPES),
  facetKey: z.string().max(FACET_KEY_MAX).nullable(),
  evidenceRequired: z.boolean(),
  rewardAchievementKey: achievementKeySchema.nullable(),
  rewardNote: singleLineText(REWARD_NOTE_MIN, REWARD_NOTE_MAX).nullable(),
  maxAssignees: z.number().int().min(1).max(MAX_ASSIGNEES_LIMIT).nullable(),
  selfAssignable: z.boolean(),
  deadlineAt: z.coerce.date().nullable(),
  durationHours: z.number().int().min(1).max(MAX_DURATION_HOURS).nullable(),
};

export const createMissionSchema = z
  .object({
    title: missionFields.title,
    brief: missionFields.brief,
    type: missionFields.type,
    facetKey: missionFields.facetKey.default(null),
    evidenceRequired: missionFields.evidenceRequired.default(true),
    rewardAchievementKey: missionFields.rewardAchievementKey.default(null),
    rewardNote: missionFields.rewardNote.default(null),
    maxAssignees: missionFields.maxAssignees.default(null),
    /** Defaults to true, and to false for team missions (teams are formed by staff). */
    selfAssignable: missionFields.selfAssignable.optional(),
    deadlineAt: missionFields.deadlineAt.default(null),
    durationHours: missionFields.durationHours.default(null),
  })
  .strict();

export const updateMissionSchema = z
  .object({
    missionId: z.uuid(),
    patch: z
      .object({
        title: missionFields.title.optional(),
        brief: missionFields.brief.optional(),
        type: missionFields.type.optional(),
        facetKey: missionFields.facetKey.optional(),
        evidenceRequired: missionFields.evidenceRequired.optional(),
        rewardAchievementKey: missionFields.rewardAchievementKey.optional(),
        rewardNote: missionFields.rewardNote.optional(),
        maxAssignees: missionFields.maxAssignees.optional(),
        selfAssignable: missionFields.selfAssignable.optional(),
        deadlineAt: missionFields.deadlineAt.optional(),
        durationHours: missionFields.durationHours.optional(),
      })
      .strict(),
  })
  .strict();

export const missionIdSchema = z.object({ missionId: z.uuid() }).strict();

export const publishMissionSchema = z
  .object({ missionId: z.uuid(), announce: z.boolean().default(true) })
  .strict();

export const assignMissionSchema = z
  .object({
    missionId: z.uuid(),
    memberIds: z
      .array(z.uuid())
      .min(1)
      .max(MAX_ASSIGN_BATCH)
      .refine((ids) => new Set(ids).size === ids.length, 'must not contain duplicates'),
    teamKey: z
      .string()
      .trim()
      .toLowerCase()
      .regex(TEAM_KEY_PATTERN, 'Team key: 1–32 chars, a–z, 0–9, - or _')
      .optional(),
    dueAt: z.coerce.date().optional(),
    durationHours: z.number().int().min(1).max(MAX_DURATION_HOURS).optional(),
  })
  .strict()
  .refine((data) => !(data.dueAt && data.durationHours), {
    message: 'Give either dueAt or durationHours, not both',
    path: ['dueAt'],
  });

export const assignmentIdSchema = z.object({ assignmentId: z.uuid() }).strict();

export const submitMissionSchema = z
  .object({
    assignmentId: z.uuid(),
    submission: multiLineText(SUBMISSION_MIN, SUBMISSION_MAX),
    evidence: z
      .object({
        title: singleLineText(EVIDENCE_TITLE_MIN, EVIDENCE_TITLE_MAX),
        url: httpUrl,
      })
      .strict()
      .optional(),
  })
  .strict();

export const verifySubmissionSchema = z
  .object({
    assignmentId: z.uuid(),
    feedback: multiLineText(FEEDBACK_MIN, FEEDBACK_MAX).optional(),
  })
  .strict();

export const rejectSubmissionSchema = z
  .object({
    assignmentId: z.uuid(),
    feedback: multiLineText(FEEDBACK_MIN, FEEDBACK_MAX),
  })
  .strict();

export const listOpenMissionsSchema = pageSchema
  .extend({ type: z.enum(MISSION_TYPES).optional() })
  .strict();

export const myMissionsSchema = z
  .object({ scope: z.enum(['active', 'completed', 'all']).default('active') })
  .strict();

export const memberHistorySchema = z
  .object({
    memberId: z.uuid(),
    limit: z.number().int().min(1).max(HISTORY_LIMIT_MAX).default(HISTORY_LIMIT_DEFAULT),
  })
  .strict();

export const reviewQueueSchema = pageSchema.strict();
