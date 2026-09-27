import type { BadgeTone } from '@jave/ui';

/** Human labels for the AI module's enums (client-safe; shared by pages and filters). */

export const AI_FEATURE_LABELS: Readonly<Record<string, string>> = {
  ask: 'Ask',
  research: 'Research',
  summarize: 'Summarize',
  analyze: 'Analyze',
  brainstorm: 'Brainstorm',
  explain: 'Explain',
  draft_announcement: 'Draft announcement',
  draft_task: 'Draft mission',
  ticket_summary: 'Ticket summary',
};

export function featureLabel(feature: string): string {
  return AI_FEATURE_LABELS[feature] ?? feature;
}

export const AI_REQUEST_STATUS_LABELS = {
  ok: 'OK',
  error: 'Error',
  refused: 'Refused',
  rate_limited: 'Rate limited',
  disabled: 'Disabled',
  pending: 'Pending',
} as const;

export type AiRequestStatus = keyof typeof AI_REQUEST_STATUS_LABELS;

export const AI_REQUEST_STATUS_TONE: Readonly<Record<AiRequestStatus, BadgeTone>> = {
  ok: 'success',
  error: 'danger',
  refused: 'warning',
  rate_limited: 'warning',
  disabled: 'neutral',
  pending: 'info',
};

export const PROPOSAL_STATUS_LABELS = {
  pending: 'Pending',
  confirmed: 'Queued',
  executed: 'Executed',
  rejected: 'Rejected',
  expired: 'Expired',
  failed: 'Failed',
} as const;

export type ProposalStatus = keyof typeof PROPOSAL_STATUS_LABELS;

export const PROPOSAL_STATUS_TONE: Readonly<Record<ProposalStatus, BadgeTone>> = {
  pending: 'info',
  confirmed: 'info',
  executed: 'success',
  rejected: 'neutral',
  expired: 'neutral',
  failed: 'danger',
};

export const PROPOSAL_KIND_LABELS: Readonly<Record<string, string>> = {
  create_task: 'Draft mission',
  draft_announcement: 'Announcement',
  create_research_item: 'Save to research library',
};

export function kindLabel(kind: string): string {
  return PROPOSAL_KIND_LABELS[kind] ?? kind;
}

export const PROVIDER_STATE_LABELS = {
  ok: 'Reachable',
  down: 'Unreachable',
  disabled: 'Disabled',
} as const;

export const PROVIDER_STATE_TONE: Readonly<Record<keyof typeof PROVIDER_STATE_LABELS, BadgeTone>> =
  {
    ok: 'success',
    down: 'danger',
    disabled: 'neutral',
  };
