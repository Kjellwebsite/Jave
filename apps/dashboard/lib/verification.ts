import type { verification } from '@jave/core';
import type { BadgeTone } from '@jave/ui';

/** Client-safe copy and filters for the verification pages. */

type Status = verification.VerificationStatus;
type VerificationType = verification.VerificationType;

export const VERIFICATION_STATUS_LABELS: Readonly<Record<Status, string>> = {
  pending: 'Pending',
  in_review: 'In review',
  approved: 'Approved',
  rejected: 'Rejected',
  revoked: 'Revoked',
  expired: 'Expired',
};

export const VERIFICATION_STATUS_TONE: Readonly<Record<Status, BadgeTone>> = {
  pending: 'info',
  in_review: 'warning',
  approved: 'success',
  rejected: 'danger',
  revoked: 'danger',
  expired: 'neutral',
};

export const VERIFICATION_TYPE_LABELS: Readonly<Record<VerificationType, string>> = {
  identity: 'Identity',
  skill: 'Skill',
  project: 'Project',
  contribution: 'Contribution',
  achievement: 'Achievement',
  trial: 'Trial result',
};

export const VERIFICATION_TYPES = Object.keys(VERIFICATION_TYPE_LABELS) as VerificationType[];

export const OPENED_BY_LABELS: Readonly<Record<verification.OpenedBy, string>> = {
  subject: 'The member',
  staff: 'Staff, on their behalf',
  system: 'JAVE',
};

/** What an approval changes, per type (the strategies in core decide; this states it). */
export const APPROVAL_CONSEQUENCES: Readonly<Record<VerificationType, string>> = {
  identity: 'Grants the VERIFIED role in place of their current progression role.',
  skill: 'Sets their verified rank for this capability to the rank you grant.',
  project: 'Records their project membership as accepted evidence.',
  contribution: 'Marks the contribution verified.',
  achievement: 'Marks the achievement verified.',
  trial: 'Records the trial result as accepted evidence.',
};

/** Queue status filter. `open` (the default) is pending and in review. */
export const VERIFICATION_STATUS_FILTERS = [
  'open',
  'pending',
  'in_review',
  'approved',
  'rejected',
  'revoked',
  'expired',
  'all',
] as const;
export type VerificationStatusFilter = (typeof VERIFICATION_STATUS_FILTERS)[number];

export const VERIFICATION_STATUS_FILTER_LABELS: Readonly<Record<VerificationStatusFilter, string>> =
  {
    open: 'Open',
    pending: 'Pending',
    in_review: 'In review',
    approved: 'Approved',
    rejected: 'Rejected',
    revoked: 'Revoked',
    expired: 'Expired',
    all: 'Every status',
  };

const OPEN: readonly Status[] = ['pending', 'in_review'];

export function verificationStatusesFor(filter: VerificationStatusFilter): Status[] | undefined {
  if (filter === 'all') return undefined;
  if (filter === 'open') return [...OPEN];
  return [filter];
}

/** Who the queue shows: everyone's, assigned to the viewer, or nobody's yet. */
export const VERIFICATION_SCOPES = ['all', 'mine', 'unassigned'] as const;
export type VerificationScope = (typeof VERIFICATION_SCOPES)[number];
export const VERIFICATION_SCOPE_LABELS: Readonly<Record<VerificationScope, string>> = {
  all: 'Any verifier',
  mine: 'Assigned to me',
  unassigned: 'Unassigned',
};

/** `/verification?subject=me`: the viewer's own verifications, for verifiers too. */
export const MY_VERIFICATIONS_SUBJECT = 'me';
/** Every verification about the viewer, decided ones included (their notes stay readable). */
export const MY_VERIFICATIONS_HREF = `/verification?subject=${MY_VERIFICATIONS_SUBJECT}&status=all`;

/** What an identity approval does; its stored target label is only the subject's handle. */
export const IDENTITY_TARGET_LINE = 'Identity · grants VERIFIED';

interface CatalogLabels {
  domains: readonly { key: string; label: string }[];
  facets: readonly { key: string; label: string; domainKey: string }[];
}

/** `Mind · Research` for a facet key, or null when the catalog does not know it. */
export function capabilityLabelFor(catalog: CatalogLabels, facetKey: string | null): string | null {
  const facet = catalog.facets.find((candidate) => candidate.key === facetKey);
  if (!facet) return null;
  const domain = catalog.domains.find((candidate) => candidate.key === facet.domainKey);
  return `${domain?.label ?? facet.domainKey} · ${facet.label}`;
}

/**
 * `Mind · Research at A` — the target in one line (rendered as text, never
 * HTML). `capabilityLabel` replaces a skill's stored facet label with its
 * `Domain · Facet` form.
 */
export function verificationTargetLine(
  v: {
    type: VerificationType;
    targetLabel: string;
    requestedRank: string | null;
    grantedRank: string | null;
  },
  capabilityLabel: string | null = null,
): string {
  if (v.type === 'identity') return IDENTITY_TARGET_LINE;
  const rank = v.grantedRank
    ? ` · verified at ${v.grantedRank}`
    : v.requestedRank
      ? ` at ${v.requestedRank}`
      : '';
  return `${capabilityLabel ?? v.targetLabel}${rank}`;
}
