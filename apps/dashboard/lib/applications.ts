import type { applications } from '@jave/core';
import type { BadgeTone } from '@jave/ui';
import { formEnum, formString } from './form-data';

/** Client-safe copy and form parsing for the application pages. */

type ApplicationStatus = applications.ApplicationStatus;
type Recommendation = applications.ApplicationRecommendation;
type FormFieldKey = applications.ApplicationFormFieldKey;

export const APPLICATION_STATUS_LABELS: Readonly<Record<ApplicationStatus, string>> = {
  draft: 'Draft',
  submitted: 'Submitted',
  review: 'In review',
  interview: 'Interview',
  accepted: 'Accepted',
  rejected: 'Not accepted',
  withdrawn: 'Withdrawn',
};

export const APPLICATION_STATUS_TONE: Readonly<Record<ApplicationStatus, BadgeTone>> = {
  draft: 'neutral',
  submitted: 'info',
  review: 'info',
  interview: 'warning',
  accepted: 'success',
  rejected: 'danger',
  withdrawn: 'neutral',
};

export const RECOMMENDATION_LABELS: Readonly<Record<Recommendation, string>> = {
  accept: 'Accept',
  reject: 'Reject',
  interview: 'Interview first',
  abstain: 'Abstain',
};

export const RECOMMENDATION_TONE: Readonly<Record<Recommendation, BadgeTone>> = {
  accept: 'success',
  reject: 'danger',
  interview: 'warning',
  abstain: 'neutral',
};

export const RECOMMENDATIONS = Object.keys(RECOMMENDATION_LABELS) as Recommendation[];

export const REVIEW_SCORES = ['5', '4', '3', '2', '1'] as const;

export const SCORE_LABELS: Readonly<Record<(typeof REVIEW_SCORES)[number], string>> = {
  '5': '5 — Exceptional evidence of capability',
  '4': '4 — Strong, clear proof of work',
  '3': '3 — Solid, with gaps',
  '2': '2 — Thin evidence',
  '1': '1 — No convincing evidence',
};

/** Queue status filter. `in_flight` (the default) is every undecided state. */
export const QUEUE_STATUS_FILTERS = [
  'in_flight',
  'submitted',
  'review',
  'interview',
  'accepted',
  'rejected',
  'withdrawn',
  'all',
] as const;
export type QueueStatusFilter = (typeof QUEUE_STATUS_FILTERS)[number];

export const QUEUE_STATUS_FILTER_LABELS: Readonly<Record<QueueStatusFilter, string>> = {
  in_flight: 'Undecided',
  submitted: 'Submitted',
  review: 'In review',
  interview: 'Interview',
  accepted: 'Accepted',
  rejected: 'Not accepted',
  withdrawn: 'Withdrawn',
  all: 'Every status',
};

/** Statuses staff can list (drafts never reach staff). */
type StaffStatus = (typeof applications.STAFF_VISIBLE_STATUSES)[number];

const IN_FLIGHT: readonly StaffStatus[] = ['submitted', 'review', 'interview'];

/** Service status filter for a queue filter (undefined = no filter). */
export function statusesFor(filter: QueueStatusFilter): StaffStatus[] | undefined {
  if (filter === 'all') return undefined;
  if (filter === 'in_flight') return [...IN_FLIGHT];
  return [filter];
}

export const QUEUE_SORTS = ['oldest', 'newest'] as const;
export type QueueSort = (typeof QUEUE_SORTS)[number];
export const QUEUE_SORT_LABELS: Readonly<Record<QueueSort, string>> = {
  oldest: 'Oldest first',
  newest: 'Newest first',
};

/** `APP-0042`, `app-42` or `42` → 42; anything else → undefined. */
export function parseApplicationNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = /^(?:app-)?0*(\d{1,9})$/i.exec(value.trim());
  if (!match) return undefined;
  const number = Number(match[1]);
  return number >= 1 ? number : undefined;
}

/** The draft fields a dashboard form edits, in form order. */
export const DRAFT_TEXT_FIELDS: readonly Exclude<FormFieldKey, 'domainKey'>[] = [
  'motivation',
  'experience',
  'projects',
  'portfolioUrl',
  'evidenceLinks',
  'references',
  'referralCode',
];

/**
 * The draft patch a submitted form describes. Every field is sent, so an
 * emptied field clears it (the service treats "" as clear).
 */
export function draftPatchFrom(data: FormData): applications.UpdateDraftInput {
  const patch: applications.UpdateDraftInput = { domainKey: formString(data, 'domainKey') };
  for (const key of DRAFT_TEXT_FIELDS) patch[key] = formString(data, key);
  return patch;
}

export function recommendationFrom(data: FormData): Recommendation | undefined {
  return formEnum(data, 'recommendation', RECOMMENDATIONS);
}

export function scoreFrom(data: FormData): number | undefined {
  const score = formEnum(data, 'score', REVIEW_SCORES);
  return score === undefined ? undefined : Number(score);
}
