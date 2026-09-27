/**
 * Human labels, tones and URL-filter parsing for the moderation console.
 * Pure (no server imports) so client dialogs can share it.
 */
import { firstParam, offsetParam, type SearchParams } from './search-params';

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export const CASE_ACTION_LABELS = {
  warn: 'Warning',
  timeout: 'Timeout',
  untimeout: 'Timeout lifted',
  kick: 'Kick',
  ban: 'Ban',
  unban: 'Unban',
  quarantine: 'Quarantine',
  release: 'Release',
  note: 'Note',
} as const;
export type CaseActionKey = keyof typeof CASE_ACTION_LABELS;
export const CASE_ACTIONS = Object.keys(CASE_ACTION_LABELS) as CaseActionKey[];

/** Restrictive actions read as warnings, removals as danger, the rest stay neutral. */
export const CASE_ACTION_TONE: Record<CaseActionKey, Tone> = {
  warn: 'warning',
  timeout: 'warning',
  untimeout: 'neutral',
  kick: 'danger',
  ban: 'danger',
  unban: 'neutral',
  quarantine: 'warning',
  release: 'neutral',
  note: 'neutral',
};

/** Reversal cases lift another case; they are never revoked themselves. */
export const REVERSAL_ACTIONS: readonly CaseActionKey[] = ['untimeout', 'release', 'unban'];

export const CASE_SOURCE_LABELS = {
  manual: 'Manual',
  automod: 'Automod',
  ai_suggested: 'AI suggested',
  security_event: 'Security event',
  system: 'System',
} as const;
export type CaseSourceKey = keyof typeof CASE_SOURCE_LABELS;

/** Keyed by the case view's `discordState` (core derives `not_applied`). */
export const SYNC_LABELS = {
  pending: 'Pending',
  applied: 'Applied',
  failed: 'Failed',
  not_required: 'Not required',
  not_applied: 'Not applied',
} as const;
export type SyncKey = keyof typeof SYNC_LABELS;
export const SYNC_TONE: Record<SyncKey, Tone> = {
  pending: 'info',
  applied: 'success',
  failed: 'danger',
  not_required: 'neutral',
  not_applied: 'neutral',
};
/** Expected sync outcomes render quietly so failures stand out. */
export const SYNC_QUIET: Record<SyncKey, boolean> = {
  pending: false,
  applied: true,
  failed: false,
  not_required: true,
  not_applied: true,
};

const SYNC_EXPLANATION: Record<Exclude<SyncKey, 'failed'>, string> = {
  pending: 'Queued for the bot. Discord applies it within seconds while the bot is online.',
  applied: 'Discord reflects this case.',
  not_required: 'Nothing to apply in Discord (a note, or the member is not in the server).',
  not_applied: 'Ended before the bot applied it, so the bot skipped it.',
};
const SYNC_FAILED_MANUAL =
  'Discord refused or could not be reached. The issuing moderator was notified.';
const SYNC_FAILED_AUTOMATED =
  'Discord refused or could not be reached. Moderators were alerted, once per cause per hour.';

/** Why a case reads as it does in Discord. Failures name who was told: issuer or all moderators. */
export function syncExplanation(view: { discordState: SyncKey; moderator: unknown }): string {
  if (view.discordState !== 'failed') return SYNC_EXPLANATION[view.discordState];
  return view.moderator ? SYNC_FAILED_MANUAL : SYNC_FAILED_AUTOMATED;
}

export const END_REASON_LABELS = {
  expired: 'Expired',
  lifted: 'Lifted',
  superseded: 'Superseded',
  revoked: 'Revoked',
} as const;

export interface CaseStateInput {
  inForce: boolean;
  revokedAt: Date | null;
  endedAt: Date | null;
  endedReason: keyof typeof END_REASON_LABELS | null;
}

/** One state per case: REVOKED › IN FORCE › ENDED (reason) › RECORDED. */
export function caseState(view: CaseStateInput): { label: string; tone: Tone; quiet: boolean } {
  if (view.revokedAt) return { label: 'Revoked', tone: 'neutral', quiet: false };
  if (view.inForce) return { label: 'In force', tone: 'warning', quiet: false };
  if (view.endedAt && view.endedReason) {
    return { label: END_REASON_LABELS[view.endedReason], tone: 'neutral', quiet: true };
  }
  return { label: 'Recorded', tone: 'neutral', quiet: true };
}

export const TRIGGER_LABELS = {
  spam_rate: 'Spam rate',
  duplicate_content: 'Duplicate content',
  mention_spam: 'Mention spam',
  blocked_link: 'Blocked link',
  foreign_invite: 'Foreign invite',
  join_burst: 'Join burst',
  suspicious_account: 'Suspicious account',
  manual_report: 'Member report',
} as const;
export type TriggerKey = keyof typeof TRIGGER_LABELS;
export const TRIGGERS = Object.keys(TRIGGER_LABELS) as TriggerKey[];

export const EVENT_SOURCE_LABELS = {
  automod: 'Automod',
  join_screening: 'Join screening',
  manual: 'Report',
  integration: 'Integration',
  system: 'System',
} as const;

export const SECURITY_ACTION_LABELS = {
  none: 'No action',
  flagged: 'Flagged',
  message_deleted: 'Message deleted',
  timeout: 'Timeout',
  quarantine: 'Quarantine',
  kick: 'Kick',
  ban: 'Ban',
  lockdown: 'Raid mode',
} as const;

export const EVENT_STATUS_LABELS = {
  open: 'Open',
  acknowledged: 'Acknowledged',
  dismissed: 'Dismissed',
  actioned: 'Actioned',
} as const;
export type EventStatusKey = keyof typeof EVENT_STATUS_LABELS;
export const EVENT_STATUS_TONE: Record<EventStatusKey, Tone> = {
  open: 'warning',
  acknowledged: 'info',
  dismissed: 'neutral',
  actioned: 'success',
};
/** Reviews still possible from each status (mirrors the core state machine). */
export const REVIEW_TARGETS: Record<EventStatusKey, readonly Exclude<EventStatusKey, 'open'>[]> = {
  open: ['acknowledged', 'dismissed', 'actioned'],
  acknowledged: ['dismissed', 'actioned'],
  dismissed: [],
  actioned: [],
};

/** `unscored`: a report nobody assessed. Not low risk — staff judgement. */
export type Severity = 'critical' | 'elevated' | 'low' | 'unscored';
export const SEVERITY_LABELS: Record<Severity, string> = {
  critical: 'Critical',
  elevated: 'Elevated',
  low: 'Low',
  unscored: 'Not scored',
};
export const SEVERITY_TONE: Record<Severity, Tone> = {
  critical: 'danger',
  elevated: 'warning',
  low: 'neutral',
  unscored: 'info',
};

/** Same thresholds as the Discord alert card: quarantine threshold › elevated › low. */
export function riskSeverity(
  score: number,
  thresholds: { critical: number; elevated: number },
): Exclude<Severity, 'unscored'> {
  if (score >= thresholds.critical) return 'critical';
  if (score >= thresholds.elevated) return 'elevated';
  return 'low';
}

/** An event's severity: core's `riskScored` decides whether a score exists at all. */
export function eventSeverity(
  event: { riskScore: number; riskScored: boolean },
  thresholds: { critical: number; elevated: number },
): Severity {
  return event.riskScored ? riskSeverity(event.riskScore, thresholds) : 'unscored';
}

// ─── URL filters ─────────────────────────────────────────────────────────────

const CASE_NUMBER = /^(?:case-?)?0*(\d{1,9})$/i;
const SNOWFLAKE = /^\d{17,20}$/;
const MAX_RISK = 100;

/** "CASE-0042", "case42", "42" → 42; anything else → undefined. */
export function parseCaseNumber(value: string | undefined): number | undefined {
  const match = value ? CASE_NUMBER.exec(value.trim()) : null;
  const number = match ? Number(match[1]) : NaN;
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

export function isSnowflake(value: string | undefined): value is string {
  return Boolean(value && SNOWFLAKE.test(value));
}

function pick<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

export const CASE_STATE_FILTERS = {
  live: 'In force',
  standing: 'Not revoked',
} as const;
export type CaseStateFilter = keyof typeof CASE_STATE_FILTERS;

export interface CaseFilters {
  q: string | undefined;
  number: number | undefined;
  action: CaseActionKey | undefined;
  source: CaseSourceKey | undefined;
  state: CaseStateFilter | undefined;
  offset: number;
  /** A filter value was given but could not be understood. */
  invalid: boolean;
}

export function parseCaseFilters(params: SearchParams): CaseFilters {
  const q = firstParam(params.q)?.trim() || undefined;
  const number = parseCaseNumber(q);
  const rawAction = firstParam(params.action) || undefined;
  const rawSource = firstParam(params.source) || undefined;
  const rawState = firstParam(params.state) || undefined;
  const action = pick(rawAction, CASE_ACTIONS);
  const source = pick(rawSource, Object.keys(CASE_SOURCE_LABELS) as CaseSourceKey[]);
  const state = pick(rawState, Object.keys(CASE_STATE_FILTERS) as CaseStateFilter[]);
  return {
    q,
    number,
    action,
    source,
    state,
    offset: offsetParam(params.offset),
    invalid:
      Boolean(q && number === undefined) ||
      Boolean(rawAction && !action) ||
      Boolean(rawSource && !source) ||
      Boolean(rawState && !state),
  };
}

export const EVENT_VIEW_FILTERS = {
  review: 'Needs review',
  open: 'Open',
  acknowledged: 'Acknowledged',
  dismissed: 'Dismissed',
  actioned: 'Actioned',
  all: 'All events',
} as const;
export type EventViewFilter = keyof typeof EVENT_VIEW_FILTERS;

export const MIN_RISK_FILTERS = { '50': 'Risk 50+', '85': 'Risk 85+' } as const;

export interface EventFilters {
  view: EventViewFilter;
  statuses: EventStatusKey[] | undefined;
  trigger: TriggerKey | undefined;
  minRisk: number | undefined;
  offset: number;
  invalid: boolean;
}

export function parseEventFilters(params: SearchParams): EventFilters {
  const rawView = firstParam(params.view) || undefined;
  const rawTrigger = firstParam(params.trigger) || undefined;
  const rawRisk = firstParam(params.minRisk) || undefined;
  const view = pick(rawView, Object.keys(EVENT_VIEW_FILTERS) as EventViewFilter[]) ?? 'review';
  const trigger = pick(rawTrigger, TRIGGERS);
  const risk = rawRisk === undefined ? NaN : Number(rawRisk);
  const minRisk = Number.isInteger(risk) && risk >= 0 && risk <= MAX_RISK ? risk : undefined;
  const statuses: EventStatusKey[] | undefined =
    view === 'all' ? undefined : view === 'review' ? ['open', 'acknowledged'] : [view];
  return {
    view,
    statuses,
    trigger,
    minRisk,
    offset: offsetParam(params.offset),
    invalid:
      Boolean(rawView && !pick(rawView, Object.keys(EVENT_VIEW_FILTERS) as EventViewFilter[])) ||
      Boolean(rawTrigger && !trigger) ||
      Boolean(rawRisk && minRisk === undefined),
  };
}

/** The lookup box accepts a Discord ID, an @handle or a name. */
export function parseLookupQuery(value: string | undefined): {
  query: string | undefined;
  discordId: string | undefined;
} {
  const query = value?.trim().replace(/^@/, '') || undefined;
  return { query, discordId: isSnowflake(query) ? query : undefined };
}

export interface EvidenceModifier {
  key: string;
  factor: number;
  detail: string;
}

/**
 * Risk-context modifiers stored by automod in the evidence document (untyped
 * JSON). Anything malformed is skipped rather than rendered.
 */
export function evidenceModifiers(evidence: Record<string, unknown>): EvidenceModifier[] {
  const raw = evidence.modifiers;
  if (!Array.isArray(raw)) return [];
  const out: EvidenceModifier[] = [];
  for (const item of raw as unknown[]) {
    if (typeof item !== 'object' || item === null) continue;
    const { key, factor, detail } = item as Record<string, unknown>;
    if (typeof key !== 'string' || typeof factor !== 'number' || !Number.isFinite(factor)) continue;
    out.push({ key, factor, detail: typeof detail === 'string' ? detail : '' });
  }
  return out;
}
