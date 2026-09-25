import { z } from 'zod';
import { pageSchema } from '../kernel/pagination';
import {
  LIMITS,
  MAX_CRITERION_WEIGHT,
  MAX_DEADLINE_EXTENSION_MINUTES,
  MAX_DURATION_MINUTES,
  MAX_FACETS_PER_TRIAL,
  MAX_PARTICIPANTS,
  MAX_TEAM_SIZE,
  MIN_DURATION_MINUTES,
  MIN_TEAM_SIZE,
  RUBRIC_MAX_CRITERIA,
  RUBRIC_MIN_CRITERIA,
  SCORE_MAX,
  SCORE_MIN,
  TRIAL_CATEGORIES,
  TRIAL_STATUSES,
} from './constants';
import { ASSIGNMENT_STRATEGIES } from './team-assignment';

// ─── Text primitives ─────────────────────────────────────────────────────────

const TAB = 9;
const LINE_FEED = 10;
const FIRST_PRINTABLE = 32;
const DELETE = 127;
/** Raw input may be longer than the cap before cleaning, but not unboundedly. */
const RAW_LENGTH_FACTOR = 2;

/** Drops control characters (NUL etc.) except tab and newline; normalizes CRLF. */
export function stripControlCharacters(value: string): string {
  let out = '';
  for (const char of value.replace(/\r\n?/g, '\n')) {
    const code = char.codePointAt(0) ?? 0;
    if (code === TAB || code === LINE_FEED || (code >= FIRST_PRINTABLE && code !== DELETE)) {
      out += char;
    }
  }
  return out;
}

/** Multi-line free text, cleaned and bounded. */
export function boundedText(min: number, max: number) {
  return z
    .string()
    .max(max * RAW_LENGTH_FACTOR)
    .transform((value) => stripControlCharacters(value).trim())
    .pipe(z.string().min(min).max(max));
}

/** Single-line text: whitespace (including newlines) collapsed to single spaces. */
export function singleLine(min: number, max: number) {
  return z
    .string()
    .max(max * RAW_LENGTH_FACTOR)
    .transform((value) => stripControlCharacters(value).replace(/\s+/g, ' ').trim())
    .pipe(z.string().min(min).max(max));
}

export const httpUrlSchema = z
  .string()
  .trim()
  .max(LIMITS.url)
  .pipe(z.url())
  .refine((value) => /^https?:\/\//i.test(value), 'must be an http(s) URL');

export const snowflakeSchema = z.string().regex(/^\d{17,20}$/, 'must be a Discord ID');

export const seedSchema = z
  .string()
  .trim()
  .min(1)
  .max(LIMITS.seed)
  .regex(/^[A-Za-z0-9._:-]+$/, 'letters, digits and . _ : - only');

const categorySchema = z.enum(TRIAL_CATEGORIES);

// ─── Rubric & facets ─────────────────────────────────────────────────────────

export const rubricCriterionSchema = z.object({
  key: z
    .string()
    .regex(
      /^[a-z][a-z0-9_]{1,47}$/,
      'criterion keys use lowercase letters, digits and _ (2–48 chars)',
    ),
  label: singleLine(LIMITS.criterionLabelMin, LIMITS.criterionLabel),
  description: boundedText(0, LIMITS.criterionDescription).default(''),
  weight: z.number().positive('weights must be greater than 0').max(MAX_CRITERION_WEIGHT),
});

export type RubricCriterionInput = z.input<typeof rubricCriterionSchema>;

export const rubricSchema = z
  .array(rubricCriterionSchema)
  .min(RUBRIC_MIN_CRITERIA, `a rubric needs at least ${RUBRIC_MIN_CRITERIA} criterion`)
  .max(RUBRIC_MAX_CRITERIA, `a rubric has at most ${RUBRIC_MAX_CRITERIA} criteria`)
  .superRefine((rubric, ctx) => {
    const seen = new Set<string>();
    rubric.forEach((criterion, index) => {
      if (seen.has(criterion.key)) {
        ctx.addIssue({
          code: 'custom',
          message: `duplicate criterion key "${criterion.key}"`,
          path: [index, 'key'],
        });
      }
      seen.add(criterion.key);
    });
  });

/** Facet keys are validated against the live capability catalog by the services. */
export const facetKeysSchema = z
  .array(z.string().max(LIMITS.criterionKey))
  .max(MAX_FACETS_PER_TRIAL)
  .refine((keys) => new Set(keys).size === keys.length, 'duplicate facet key');

const durationSchema = z.number().int().min(MIN_DURATION_MINUTES).max(MAX_DURATION_MINUTES);
const teamSizeSchema = z.number().int().min(MIN_TEAM_SIZE).max(MAX_TEAM_SIZE);

// ─── Templates ───────────────────────────────────────────────────────────────

/** Template fields without defaults, so partial updates never overwrite unspecified fields. */
const templateFields = z.object({
  title: singleLine(LIMITS.titleMin, LIMITS.title),
  category: categorySchema,
  summary: boundedText(LIMITS.summaryMin, LIMITS.summary),
  brief: boundedText(LIMITS.briefMin, LIMITS.brief),
  durationMinutes: durationSchema,
  teamSizeMin: teamSizeSchema,
  teamSizeMax: teamSizeSchema,
  rubric: rubricSchema,
  facetKeys: facetKeysSchema,
  allowsAdversarial: z.boolean(),
});

const DEFAULT_TEMPLATE_TEAM_SIZE_MIN = 2;
const DEFAULT_TEMPLATE_TEAM_SIZE_MAX = 4;

const teamSizeRangeValid = (value: { teamSizeMin?: number; teamSizeMax?: number }) =>
  value.teamSizeMin === undefined ||
  value.teamSizeMax === undefined ||
  value.teamSizeMin <= value.teamSizeMax;
const TEAM_SIZE_RANGE_MESSAGE = {
  message: 'teamSizeMin must not exceed teamSizeMax',
  path: ['teamSizeMax'],
};

export const createTemplateSchema = templateFields
  .extend({
    key: z
      .string()
      .max(LIMITS.templateKey)
      .regex(/^[a-z0-9][a-z0-9-]{1,63}$/, 'keys use lowercase letters, digits and - (2–64 chars)'),
    teamSizeMin: teamSizeSchema.default(DEFAULT_TEMPLATE_TEAM_SIZE_MIN),
    teamSizeMax: teamSizeSchema.default(DEFAULT_TEMPLATE_TEAM_SIZE_MAX),
    facetKeys: facetKeysSchema.default([]),
    allowsAdversarial: z.boolean().default(false),
  })
  .refine(teamSizeRangeValid, TEAM_SIZE_RANGE_MESSAGE);

export const updateTemplateSchema = templateFields
  .partial()
  .extend({ templateId: z.uuid(), active: z.boolean().optional() })
  .refine(teamSizeRangeValid, TEAM_SIZE_RANGE_MESSAGE);

export const templateIdSchema = z.object({ templateId: z.uuid() });

export const listTemplatesSchema = z.object({ includeInactive: z.boolean().default(false) });

// ─── Trials ──────────────────────────────────────────────────────────────────

export const trialIdSchema = z.object({ trialId: z.uuid() });

export const createTrialSchema = z.object({
  templateId: z.uuid().optional(),
  title: singleLine(LIMITS.titleMin, LIMITS.title).optional(),
  category: categorySchema.optional(),
  summary: boundedText(0, LIMITS.summary).optional(),
  brief: boundedText(LIMITS.briefMin, LIMITS.brief).optional(),
  rubric: rubricSchema.optional(),
  facetKeys: facetKeysSchema.optional(),
  durationMinutes: durationSchema.optional(),
  teamSize: teamSizeSchema.optional(),
  maxParticipants: z.number().int().min(1).max(MAX_PARTICIPANTS).nullable().optional(),
  recruitmentClosesAt: z.coerce.date().optional(),
  scheduledStartAt: z.coerce.date().optional(),
  adversarialEnabled: z.boolean().default(false),
});

export const updateTrialSchema = z.object({
  trialId: z.uuid(),
  title: singleLine(LIMITS.titleMin, LIMITS.title).optional(),
  summary: boundedText(0, LIMITS.summary).optional(),
  brief: boundedText(LIMITS.briefMin, LIMITS.brief).optional(),
  rubric: rubricSchema.optional(),
  facetKeys: facetKeysSchema.optional(),
  durationMinutes: durationSchema.optional(),
  teamSize: teamSizeSchema.optional(),
  maxParticipants: z.number().int().min(1).max(MAX_PARTICIPANTS).nullable().optional(),
  recruitmentClosesAt: z.coerce.date().nullable().optional(),
  scheduledStartAt: z.coerce.date().nullable().optional(),
});

export const openRecruitmentSchema = z.object({
  trialId: z.uuid(),
  recruitmentClosesAt: z.coerce.date().optional(),
});

export const applyToTrialSchema = z.object({
  trialId: z.uuid(),
  statement: boundedText(LIMITS.statementMin, LIMITS.statement),
});

export const selectParticipantsSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('manual'),
    trialId: z.uuid(),
    memberIds: z
      .array(z.uuid())
      .min(1)
      .max(LIMITS.selectionList)
      .refine((ids) => new Set(ids).size === ids.length, 'duplicate member'),
  }),
  z.object({
    mode: z.literal('random'),
    trialId: z.uuid(),
    count: z.number().int().min(1).max(MAX_PARTICIPANTS),
    seed: seedSchema.optional(),
  }),
]);

export const assignTeamsSchema = z.object({
  trialId: z.uuid(),
  strategy: z.enum(ASSIGNMENT_STRATEGIES).default('balanced'),
  seed: seedSchema.optional(),
  teamSize: teamSizeSchema.optional(),
});

export const extendDeadlineSchema = z.object({
  trialId: z.uuid(),
  minutes: z.number().int().min(1).max(MAX_DEADLINE_EXTENSION_MINUTES),
  reason: boundedText(LIMITS.reasonMin, LIMITS.reason),
});

export const submitSchema = z.object({
  trialId: z.uuid(),
  summary: boundedText(LIMITS.submissionSummaryMin, LIMITS.submissionSummary),
  links: z
    .array(httpUrlSchema)
    .max(LIMITS.submissionLinks)
    .refine((links) => new Set(links).size === links.length, 'duplicate link')
    .default([]),
});

export const evaluateSchema = z
  .object({
    trialId: z.uuid(),
    teamId: z.uuid().optional(),
    memberId: z.uuid().optional(),
    scores: z
      .record(
        z.string().max(LIMITS.criterionKey),
        z.number().int('scores are whole numbers').min(SCORE_MIN).max(SCORE_MAX),
      )
      .refine((scores) => Object.keys(scores).length <= RUBRIC_MAX_CRITERIA, 'too many criteria'),
    notes: boundedText(0, LIMITS.notes).optional(),
  })
  .refine((value) => (value.teamId === undefined) !== (value.memberId === undefined), {
    message: 'evaluate exactly one target: a team or a participant',
    path: ['teamId'],
  });

export const publishResultsSchema = z.object({
  trialId: z.uuid(),
  /** Publish even though some submitting teams were never evaluated (they become INCOMPLETE). */
  acknowledgeIncomplete: z.boolean().default(false),
});

export const applyRankConsequenceSchema = z.object({
  trialId: z.uuid(),
  memberId: z.uuid(),
  /** Defaults to the result's recommended rank; may be lower, never higher. */
  rank: z.string().max(4).optional(),
  reason: boundedText(LIMITS.reasonMin, LIMITS.rankReason).optional(),
});

export const cancelTrialSchema = z.object({
  trialId: z.uuid(),
  reason: boundedText(LIMITS.reasonMin, LIMITS.reason),
});

export const setAdversarialSchema = z.object({ trialId: z.uuid(), enabled: z.boolean() });

export const listTrialsSchema = pageSchema.extend({
  status: z.enum(TRIAL_STATUSES).optional(),
  category: categorySchema.optional(),
});

export const memberHistorySchema = z.object({ memberId: z.uuid() });

// ─── Discord callbacks ───────────────────────────────────────────────────────

export const teamRefSchema = z.object({ teamId: z.uuid() });

export const markAnnouncementPostedSchema = z.object({
  trialId: z.uuid(),
  channelId: snowflakeSchema,
  messageId: snowflakeSchema,
});

export const markTeamProvisionedSchema = z.object({
  teamId: z.uuid(),
  channelId: snowflakeSchema,
  roleId: snowflakeSchema.nullable().default(null),
});

export const markTeamsArchivedSchema = z.object({
  trialId: z.uuid(),
  teamIds: z.array(z.uuid()).max(MAX_PARTICIPANTS),
});

export const warningSpecSchema = z.object({
  teamId: z.uuid(),
  minutesRemaining: z.number().int().min(1),
  deadlineAt: z.iso.datetime(),
});
