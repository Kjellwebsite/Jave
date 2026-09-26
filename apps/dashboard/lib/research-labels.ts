import type { BadgeTone } from '@jave/ui';

/** Human labels and links for the research module (client-safe). */

export const RESEARCH_STATUS_LABELS = {
  new: 'New',
  needs_review: 'Needs review',
  reviewed: 'Reviewed',
  verified: 'Verified',
  archived: 'Archived',
} as const;

export type ResearchStatus = keyof typeof RESEARCH_STATUS_LABELS;

export const RESEARCH_STATUS_TONE: Readonly<Record<ResearchStatus, BadgeTone>> = {
  new: 'info',
  needs_review: 'warning',
  reviewed: 'info',
  verified: 'success',
  archived: 'neutral',
};

export const EVIDENCE_LABELS = {
  unknown: 'Unknown',
  anecdotal: 'Anecdotal',
  observational: 'Observational',
  experimental: 'Experimental',
  peer_reviewed: 'Peer reviewed',
  meta_analysis: 'Meta-analysis',
} as const;

export type EvidenceLevel = keyof typeof EVIDENCE_LABELS;

export const SIDUS_SYNC_LABELS = {
  not_synced: 'Not synced',
  pending: 'Pending',
  synced: 'Synced',
  failed: 'Failed',
} as const;

export type SidusSyncStatus = keyof typeof SIDUS_SYNC_LABELS;

export const SIDUS_SYNC_TONE: Readonly<Record<SidusSyncStatus, BadgeTone>> = {
  not_synced: 'neutral',
  pending: 'info',
  synced: 'success',
  failed: 'danger',
};

export const ENRICHMENT_LABELS = {
  pending: 'Pending',
  enriched: 'Enriched',
  not_found: 'Not found',
  failed: 'Failed',
  skipped: 'Skipped',
} as const;

/** Statuses a reviewer can set (archiving is its own action; NEW is never set by hand). */
export const REVIEW_STATUSES = ['needs_review', 'reviewed', 'verified'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/** Path segments encoded one by one so identifiers keep their slashes. */
function encodePath(identifier: string): string {
  return identifier.split('/').map(encodeURIComponent).join('/');
}

export function doiUrl(doi: string): string {
  return `https://doi.org/${encodePath(doi)}`;
}

export function arxivUrl(arxivId: string): string {
  return `https://arxiv.org/abs/${encodePath(arxivId)}`;
}

/** A Discord message link JAVE stored when the item was saved from a message. */
export function discordMessageUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  return /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/channels\/\d{17,20}\/\d{17,20}\/\d{17,20}$/.test(
    value,
  )
    ? value
    : null;
}

/** "numpy, Python , arrays" → ["numpy", "Python", "arrays"] (core lower-cases and validates). */
export function parseTagList(raw: string): string[] {
  return raw
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}
