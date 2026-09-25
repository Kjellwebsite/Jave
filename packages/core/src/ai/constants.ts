import type { AIErrorKind } from '@jave/ai';
import { HOUR, MINUTE } from '../kernel/clock';

export const AI_FEATURES = [
  'ask',
  'research',
  'summarize',
  'analyze',
  'brainstorm',
  'explain',
  'draft_announcement',
  'draft_task',
] as const;
export type AiFeature = (typeof AI_FEATURES)[number];

/** Short-window burst limit per user, on top of the daily limit from settings. */
export const AI_BURST_LIMIT = 6;
export const AI_BURST_WINDOW_SECONDS = 60;

/**
 * Generation budget per feature. It bounds output (including any model-internal
 * reasoning), it is not a spend target.
 */
export const FEATURE_MAX_TOKENS: Readonly<Record<AiFeature, number>> = {
  ask: 8000,
  research: 12_000,
  summarize: 8000,
  analyze: 8000,
  brainstorm: 6000,
  explain: 6000,
  draft_announcement: 4000,
  draft_task: 4000,
};

/** Absolute input ceiling (the settings maximum); the live limit is settings.ai.maxInputChars. */
export const MAX_ABSOLUTE_INPUT_CHARS = 100_000;
/** Longest answer returned to a surface; longer output is cut with an ellipsis. */
export const MAX_OUTPUT_CHARS = 16_000;
export const MAX_SUMMARIZE_MESSAGES = 200;
export const MAX_MESSAGE_AUTHOR_LENGTH = 64;
export const MAX_SUMMARIZE_MESSAGE_LENGTH = 4000;

/** Ledger error codes JAVE sets itself; provider failures use the AIError kind. */
export const EMPTY_RESPONSE_CODE = 'empty_response';
export const UNEXPECTED_ERROR_CODE = 'unexpected';
export const ABANDONED_REQUEST_CODE = 'abandoned';
type LedgerErrorCode =
  | AIErrorKind
  | typeof EMPTY_RESPONSE_CODE
  | typeof UNEXPECTED_ERROR_CODE
  | typeof ABANDONED_REQUEST_CODE;

/** Ledger statuses that always count toward the daily limit. */
export const COUNTED_REQUEST_STATUSES = ['pending', 'ok', 'refused'] as const;
/**
 * Failed requests (`error` rows) that still count: the model probably ran —
 * and was billed — before the failure (timeout, unusable or empty output), or
 * the outcome is unknown (aborted, abandoned by a crash, unexpected error).
 * Requests turned away before any work (rate limit, overload, 5xx, auth,
 * invalid request) do not count.
 */
export const COUNTED_ERROR_CODES = [
  'timeout',
  'malformed_response',
  'aborted',
  EMPTY_RESPONSE_CODE,
  ABANDONED_REQUEST_CODE,
  UNEXPECTED_ERROR_CODE,
] as const satisfies readonly LedgerErrorCode[];
/** Advisory-lock namespace serializing daily-limit reservations per user. */
export const AI_LEDGER_LOCK_NAMESPACE = 424_201;

export const MAX_PENDING_PROPOSALS_PER_USER = 10;
export const MAX_PROPOSAL_PAYLOAD_CHARS = 16_384;
export const MAX_PREVIEW_CHARS = 1900;
export const MAX_REJECTION_REASON_LENGTH = 500;
export const MAX_PROPOSAL_ERROR_LENGTH = 500;

/** Recurring maintenance: expire proposals, close ledger rows abandoned by a crash. */
export const AI_MAINTENANCE_JOB = 'ai.maintenance';
export const AI_MAINTENANCE_EVERY_MS = 5 * MINUTE;
export const STALE_PENDING_REQUEST_MS = HOUR;

export const MAX_USAGE_DAYS = 90;
