import { z } from 'zod';
import { pageSchema } from '../kernel/pagination';
import { applicationRecommendation } from '@jave/database';

/**
 * Field caps. Discord modal text inputs cap at 4000 characters; every cap
 * here fits inside one input so the bot's modals and these schemas agree.
 */
export const APPLICATION_FIELD_LIMITS = {
  motivation: 2000,
  experience: 2000,
  projects: 2000,
  references: 1000,
  portfolioUrl: 2048,
  evidenceLink: 2048,
  evidenceLinks: 10,
  /** Evidence links submitted as one text block (one modal input). */
  evidenceLinksText: 4000,
  referralCode: 32,
  domainKey: 32,
  reviewNote: 2000,
  decisionReason: 2000,
  applicantMessage: 1000,
  withdrawReason: 500,
  interviewNote: 500,
} as const;

/** Minimum characters for required long answers at submission time. */
export const MIN_LONG_ANSWER_CHARS = 30;

/** Postgres integer ceiling for the identity-backed application number. */
const MAX_APPLICATION_NUMBER = 2_147_483_647;

export const REVIEW_SCORE_MIN = 1;
export const REVIEW_SCORE_MAX = 5;
export const DECISION_REASON_MIN_CHARS = 3;

const FIRST_PRINTABLE_CHAR_CODE = 0x20;
const DELETE_CHAR_CODE = 0x7f;
/** Whitespace control characters that free text may contain. */
const ALLOWED_CONTROL_CHAR_CODES: ReadonlySet<number> = new Set([0x09, 0x0a, 0x0d]);

/**
 * True when text holds no C0 control characters (other than tab, newline and
 * carriage return) and no DEL. NUL in particular is rejected by Postgres text.
 */
export function hasNoControlChars(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code === DELETE_CHAR_CODE) return false;
    if (code < FIRST_PRINTABLE_CHAR_CODE && !ALLOWED_CONTROL_CHAR_CODES.has(code)) return false;
  }
  return true;
}

const CONTROL_CHARS_MESSAGE = 'contains unsupported control characters';

/** Parse an http(s) URL without embedded credentials. */
export function isSafeHttpUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  if (parsed.username || parsed.password) return false;
  return parsed.hostname.length > 0;
}

/**
 * An http(s) URL, stored in its normalized WHATWG form (`URL.href`): host
 * lowercased and punycoded, unsafe characters percent-encoded.
 */
const httpUrl = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine(hasNoControlChars, CONTROL_CHARS_MESSAGE)
    .refine(isSafeHttpUrl, 'must be an http(s) URL without credentials')
    .transform((value) => new URL(value).href)
    .pipe(z.string().max(max, `must be at most ${max} characters once normalized`));

/**
 * Optional free text for a draft patch: `undefined` leaves the field alone,
 * `null` or an empty string clears it (Discord modals submit "" for blanks).
 */
const draftText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine(hasNoControlChars, CONTROL_CHARS_MESSAGE)
    .nullable()
    .optional()
    .transform((value) => (value === '' ? null : value));

/**
 * Split a modal text block of links on whitespace. Commas are legal inside
 * URLs, so they are not separators.
 */
export function splitLinkList(text: string): string[] {
  return text
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

const evidenceLinkList = z
  .array(httpUrl(APPLICATION_FIELD_LIMITS.evidenceLink))
  .max(
    APPLICATION_FIELD_LIMITS.evidenceLinks,
    `at most ${APPLICATION_FIELD_LIMITS.evidenceLinks} evidence links`,
  )
  .transform((links) => [...new Set(links)]);

/** A list of links, or one modal text block of links (one per line). */
const evidenceLinksInput = z
  .union([z.string(), z.array(z.string())])
  // Size checks run before any per-link parsing, so oversized input is cheap to reject.
  .superRefine((value, issue) => {
    if (typeof value === 'string' && value.length > APPLICATION_FIELD_LIMITS.evidenceLinksText) {
      issue.addIssue({
        code: 'custom',
        message: `at most ${APPLICATION_FIELD_LIMITS.evidenceLinksText} characters`,
      });
    }
    if (Array.isArray(value) && value.length > APPLICATION_FIELD_LIMITS.evidenceLinks) {
      issue.addIssue({
        code: 'custom',
        message: `at most ${APPLICATION_FIELD_LIMITS.evidenceLinks} evidence links`,
      });
    }
  })
  .transform((value) => (typeof value === 'string' ? splitLinkList(value) : value))
  .pipe(evidenceLinkList);

export const updateDraftSchema = z
  .object({
    domainKey: z
      .string()
      .trim()
      .toLowerCase()
      .max(APPLICATION_FIELD_LIMITS.domainKey)
      .nullable()
      .optional()
      .transform((value) => (value === '' ? null : value)),
    experience: draftText(APPLICATION_FIELD_LIMITS.experience),
    projects: draftText(APPLICATION_FIELD_LIMITS.projects),
    motivation: draftText(APPLICATION_FIELD_LIMITS.motivation),
    references: draftText(APPLICATION_FIELD_LIMITS.references),
    portfolioUrl: z
      .preprocess(
        (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
        httpUrl(APPLICATION_FIELD_LIMITS.portfolioUrl).nullable(),
      )
      .optional(),
    evidenceLinks: evidenceLinksInput.optional(),
    referralCode: z
      .string()
      .trim()
      .max(APPLICATION_FIELD_LIMITS.referralCode)
      .regex(/^[A-Za-z0-9_-]*$/, 'letters, digits, - and _ only')
      .nullable()
      .optional()
      .transform((value) => (value === '' ? null : value)),
  })
  .strict();

export type UpdateDraftInput = z.input<typeof updateDraftSchema>;

export const withdrawSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .max(APPLICATION_FIELD_LIMITS.withdrawReason)
      .refine(hasNoControlChars, CONTROL_CHARS_MESSAGE)
      .optional(),
  })
  .strict();

/** Statuses staff can filter by. Drafts are private to the applicant. */
export const STAFF_VISIBLE_STATUSES = [
  'submitted',
  'review',
  'interview',
  'accepted',
  'rejected',
  'withdrawn',
] as const;

const staffStatus = z.enum(STAFF_VISIBLE_STATUSES);

export const listApplicationsSchema = pageSchema
  .extend({
    status: z.union([staffStatus, z.array(staffStatus).min(1).max(6)]).optional(),
    domainKey: z.string().trim().toLowerCase().max(APPLICATION_FIELD_LIMITS.domainKey).optional(),
    /** Only applications assigned to the viewer. */
    assignedToMe: z.boolean().optional(),
    /** Look up by human number: 42, "42" or "APP-0042". */
    number: z
      .preprocess(
        (value) => (typeof value === 'string' ? Number(value.trim().replace(/^APP-/i, '')) : value),
        z.number().int().min(1).max(MAX_APPLICATION_NUMBER),
      )
      .optional(),
    sort: z.enum(['oldest', 'newest']).default('oldest'),
  })
  .strict();

export const applicationRefSchema = z.object({ applicationId: z.uuid() }).strict();

export const startReviewSchema = z
  .object({
    applicationId: z.uuid(),
    /** Defaults to the caller. Assigning someone else requires canDecideApplications. */
    reviewerUserId: z.uuid().optional(),
  })
  .strict();

export const reviewSchema = z
  .object({
    applicationId: z.uuid(),
    recommendation: z.enum(applicationRecommendation.enumValues),
    /** A number, or the digit string a modal text input submits. */
    score: z
      .preprocess(
        (value) => (typeof value === 'string' && value.trim() !== '' ? Number(value) : value),
        z.number().int().min(REVIEW_SCORE_MIN).max(REVIEW_SCORE_MAX),
      )
      .optional(),
    note: draftText(APPLICATION_FIELD_LIMITS.reviewNote),
  })
  .strict()
  .superRefine((value, issue) => {
    if (value.recommendation === 'abstain' && value.score !== undefined) {
      issue.addIssue({ code: 'custom', path: ['score'], message: 'an abstention has no score' });
    }
    if (value.recommendation !== 'abstain' && value.score === undefined) {
      issue.addIssue({ code: 'custom', path: ['score'], message: 'score 1–5 is required' });
    }
  });

export const scheduleInterviewSchema = z
  .object({
    applicationId: z.uuid(),
    interviewAt: z.coerce.date(),
    /** Shown to the applicant with the invitation (e.g. where to join). */
    applicantMessage: draftText(APPLICATION_FIELD_LIMITS.interviewNote),
  })
  .strict();

export const decideSchema = z
  .object({
    applicationId: z.uuid(),
    decision: z.enum(['accept', 'reject']),
    /** Internal rationale. Never shown to the applicant. */
    reason: z
      .string()
      .trim()
      .min(DECISION_REASON_MIN_CHARS, 'Give an internal reason')
      .max(APPLICATION_FIELD_LIMITS.decisionReason)
      .refine(hasNoControlChars, CONTROL_CHARS_MESSAGE),
    /** Optional message delivered to the applicant. */
    applicantMessage: draftText(APPLICATION_FIELD_LIMITS.applicantMessage),
  })
  .strict();

/** Longest render id accepted; the bot passes its job id. */
export const REVIEW_CARD_RENDER_ID_MAX_CHARS = 64;

/**
 * Identifies one render: the bot passes the job id, so a retry of the same
 * job keeps (or regains) its own lease.
 */
const renderIdSchema = z
  .string()
  .min(1)
  .max(REVIEW_CARD_RENDER_ID_MAX_CHARS)
  .regex(/^[A-Za-z0-9:_-]+$/, 'letters, digits, :, _ and - only');

const discordId = z.string().regex(/^\d{17,20}$/, 'must be a Discord ID');

export const beginReviewCardRenderSchema = z
  .object({
    applicationId: z.uuid(),
    /** The revision the job was enqueued for. */
    revision: z.number().int().min(1),
    renderId: renderIdSchema,
  })
  .strict();

export const reviewCardMessageSchema = z
  .object({
    applicationId: z.uuid(),
    channelId: discordId,
    messageId: discordId,
    /** `card.revision` of the card that was rendered. */
    revision: z.number().int().min(1),
    renderId: renderIdSchema,
  })
  .strict();

export const releaseReviewCardRenderSchema = z
  .object({ applicationId: z.uuid(), renderId: renderIdSchema })
  .strict();
