import { z } from 'zod';
import { verificationStatus, verificationType } from '@jave/database';
import { pageSchema } from '../kernel/pagination';
import { isSnowflake } from '../kernel/ids';
import { MAX_EVIDENCE_PER_VERIFICATION } from './rules';

/** Length caps for user-supplied text. */
export const TEXT_LIMITS = {
  claim: 500,
  note: 2000,
  reason: 1000,
  evidenceTitle: 200,
  evidenceDescription: 2000,
  url: 2048,
} as const;

const TAB = 0x09;
const LINE_FEED = 0x0a;
const CARRIAGE_RETURN = 0x0d;
const FIRST_PRINTABLE = 0x20;
const DELETE = 0x7f;

/** True when the text carries NUL or other C0 control characters (tab and newlines allowed). */
export function hasControlCharacters(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code === DELETE) return true;
    if (code < FIRST_PRINTABLE && code !== TAB && code !== LINE_FEED && code !== CARRIAGE_RETURN)
      return true;
  }
  return false;
}

/** Trimmed free text with length bounds and no control characters. */
export function safeText(min: number, max: number) {
  return z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((value) => !hasControlCharacters(value), 'must not contain control characters');
}

/** http(s) only, no embedded credentials. */
export function isSafeHttpUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return (
    (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
    parsed.hostname.length > 0 &&
    parsed.username === '' &&
    parsed.password === ''
  );
}

export const httpUrlSchema = z
  .string()
  .trim()
  .max(TEXT_LIMITS.url)
  .refine(isSafeHttpUrl, 'must be an http(s) URL without credentials');

const uuid = () => z.uuid().transform((value) => value.toLowerCase());

export const verificationTypeSchema = z.enum(verificationType.enumValues);
export const verificationStatusSchema = z.enum(verificationStatus.enumValues);

/** WHAT is being verified. One shape per verification type. */
export const verificationTargetSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('identity') }),
  z.object({
    type: z.literal('skill'),
    facetKey: z.string().trim().min(1).max(48),
    requestedRank: z.string().trim().toUpperCase().min(1).max(4),
  }),
  z.object({ type: z.literal('project'), projectId: uuid() }),
  z.object({ type: z.literal('contribution'), contributionId: uuid() }),
  z.object({ type: z.literal('achievement'), memberAchievementId: uuid() }),
  z.object({ type: z.literal('trial'), trialResultId: uuid() }),
]);

export type VerificationTarget = z.infer<typeof verificationTargetSchema>;

export const newEvidenceSchema = z.object({
  title: safeText(2, TEXT_LIMITS.evidenceTitle),
  url: httpUrlSchema.optional(),
  description: safeText(0, TEXT_LIMITS.evidenceDescription).optional(),
});

export type NewEvidenceInput = z.infer<typeof newEvidenceSchema>;

export const requestVerificationSchema = z
  .object({
    /** Defaults to the acting member. Staff with canVerifyMembers may open for others. */
    subjectMemberId: uuid().optional(),
    target: verificationTargetSchema,
    /** Defaults to a description of the target. */
    claim: safeText(3, TEXT_LIMITS.claim).optional(),
    /** New evidence rows created for the subject. */
    evidence: z.array(newEvidenceSchema).max(MAX_EVIDENCE_PER_VERIFICATION).default([]),
    /** Existing evidence owned by the subject. */
    evidenceIds: z.array(uuid()).max(MAX_EVIDENCE_PER_VERIFICATION).default([]),
  })
  .refine(
    (value) => value.evidence.length + value.evidenceIds.length <= MAX_EVIDENCE_PER_VERIFICATION,
    {
      message: `at most ${MAX_EVIDENCE_PER_VERIFICATION} evidence items per verification`,
      path: ['evidence'],
    },
  )
  .refine((value) => new Set(value.evidenceIds).size === value.evidenceIds.length, {
    message: 'evidence ids must be unique',
    path: ['evidenceIds'],
  });

export type RequestVerificationInput = z.input<typeof requestVerificationSchema>;

export const verificationIdSchema = z.object({ verificationId: uuid() });

export const assignVerifierSchema = z.object({
  verificationId: uuid(),
  /** Null unassigns (an in-review verification returns to pending). */
  verifierMemberId: uuid().nullable(),
});

export const decideVerificationSchema = z.object({
  verificationId: uuid(),
  decision: z.enum(['approve', 'reject']),
  note: safeText(3, TEXT_LIMITS.note),
  /** Skill approvals only: grant a rank other than the requested one. */
  grantedRank: z.string().trim().toUpperCase().min(1).max(4).optional(),
});

export const revokeVerificationSchema = z.object({
  verificationId: uuid(),
  reason: safeText(3, TEXT_LIMITS.reason),
});

const MAX_STATUS_FILTERS = verificationStatus.enumValues.length;

export const listVerificationsSchema = pageSchema.extend({
  status: z
    .union([
      verificationStatusSchema,
      z.array(verificationStatusSchema).min(1).max(MAX_STATUS_FILTERS),
    ])
    .optional(),
  type: verificationTypeSchema.optional(),
  subjectMemberId: uuid().optional(),
  /** Staff only: verifications assigned to the acting verifier. */
  assignedToMe: z.boolean().optional(),
  /** Staff only: verifications nobody is assigned to. */
  unassigned: z.boolean().optional(),
  sort: z.enum(['newest', 'oldest']).default('newest'),
});

export type ListVerificationsInput = z.input<typeof listVerificationsSchema>;

const snowflakeSchema = z.string().refine(isSnowflake, 'must be a Discord ID');

export const queueCardPostedSchema = z.object({
  verificationId: uuid(),
  channelId: snowflakeSchema,
  messageId: snowflakeSchema,
});
