import type { research } from '@jave/core';

/** Custom-id namespace of the research feature. */
export const RESEARCH_NS = 'research';

export const ACTION = {
  /** Button / select: open an item card. */
  view: 'view',
  /** Select menu listing items (values are item ids). */
  open: 'open',
  /** Button: open the review modal. Modal: submit a review (`itemId`, `version`). */
  review: 'review',
  /** Button: queue the Sidus push for a verified item. */
  sync: 'sync',
} as const;

/** Items per /sidus search or /sidus recent reply (one select menu holds 25). */
export const LIST_LIMIT = 10;
export const AUTOCOMPLETE_LIMIT = 25;
/** Discord caps a select option label at 100 characters and a description at 100. */
export const OPTION_TEXT_MAX = 100;
/** Discord caps link-button URLs at 512 characters. */
export const LINK_URL_MAX = 512;
/** Longest search text the core service accepts. */
export const SEARCH_MAX = 100;
export const TITLE_MAX = 300;
export const SUMMARY_PREVIEW_MAX = 900;
export const AUTHORS_SHOWN = 6;
export const TOPIC_MAX = 80;
/** Room for ten tags of 32 characters plus separators. */
export const TAGS_INPUT_MAX = 400;
export const REVIEW_NOTE_MAX = 1000;

export type ResearchStatus = research.ResearchStatus;
export type EvidenceLevel = research.ResearchItemView['evidenceLevel'];

export const EVIDENCE_LABELS: Readonly<Record<EvidenceLevel, string>> = {
  unknown: 'UNKNOWN',
  anecdotal: 'ANECDOTAL',
  observational: 'OBSERVATIONAL',
  experimental: 'EXPERIMENTAL',
  peer_reviewed: 'PEER REVIEWED',
  meta_analysis: 'META-ANALYSIS',
};

export const EVIDENCE_LEVELS = Object.keys(EVIDENCE_LABELS) as EvidenceLevel[];

export const SYNC_LABELS: Readonly<
  Record<research.ResearchItemView['sidusSyncStatus'], string>
> = {
  not_synced: 'NOT SYNCED',
  pending: 'PENDING',
  synced: 'SYNCED',
  failed: 'FAILED',
};

/** Statuses a reviewer sets in the modal (archiving has its own path). */
export const REVIEW_STATUSES = ['needs_review', 'reviewed', 'verified'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const SIDUS_KICKER = 'SIDUS SCIENCE';
