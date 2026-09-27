import type { securityAction, securityEvents, securityEventStatus } from '@jave/database';
import type { ServiceContext } from '../kernel/context';
import { getSettings } from '../settings/settings.service';
import { formatDuration, securityReference } from './copy';
import { enqueueDiscordJob, moderationAlertContract } from './discord-jobs';
import type { SecurityTriggerKey } from './engine/automod';

export type SecurityEventRecord = typeof securityEvents.$inferSelect;
export type SecurityActionKey = (typeof securityAction.enumValues)[number];
export type SecurityEventStatusKey = (typeof securityEventStatus.enumValues)[number];

export const TRIGGER_LABELS: Record<SecurityTriggerKey, string> = {
  spam_rate: 'SPAM RATE',
  duplicate_content: 'DUPLICATE CONTENT',
  mention_spam: 'MENTION SPAM',
  blocked_link: 'BLOCKED LINK',
  foreign_invite: 'FOREIGN INVITE',
  join_burst: 'JOIN BURST',
  suspicious_account: 'SUSPICIOUS ACCOUNT',
  manual_report: 'MANUAL REPORT',
};

export const ACTION_LABELS: Record<SecurityActionKey, string> = {
  none: 'NONE',
  flagged: 'FLAGGED',
  message_deleted: 'MESSAGE DELETED',
  timeout: 'TIMEOUT',
  quarantine: 'QUARANTINE',
  kick: 'KICK',
  ban: 'BAN',
  lockdown: 'RAID MODE',
};

/** Risk at or above this (below the quarantine threshold) renders as elevated. */
export const ELEVATED_RISK_SCORE = 50;
const MAX_CARD_SIGNALS = 5;

/**
 * The risk a manual report carries when nobody assessed it (a member's report
 * of a message). Such an event is NOT SCORED, which is not the same as low
 * risk: staff judge it. A staff report filed with a score keeps that score.
 */
export const UNSCORED_RISK_SCORE = 0;

/** False for a manual report without an assessed score: surfaces show NOT SCORED, never LOW. */
export function isRiskScored(event: Pick<SecurityEventRecord, 'trigger' | 'riskScore'>): boolean {
  return !(event.trigger === 'manual_report' && event.riskScore === UNSCORED_RISK_SCORE);
}

/** Who acted on an event nobody has reviewed yet, by source. Reports await a human. */
const UNREVIEWED_ACTOR: Record<SecurityEventRecord['source'], string> = {
  automod: 'AUTOMOD',
  join_screening: 'JOIN SCREENING',
  system: 'SYSTEM',
  integration: 'INTEGRATION',
  manual: '— awaiting review',
};

export interface AlertCardPerson {
  discordId: string;
  name: string;
  /** A bot or webhook account: never offered for quarantine. */
  isBot?: boolean;
}

export interface SecurityAlertCardInput {
  event: SecurityEventRecord;
  subject: AlertCardPerson | null;
  /**
   * The staff member who reviewed the event, if anyone. Never the reporter:
   * the card is posted in a shared channel and a member's report stays
   * confidential there (staff see the reporter on the dashboard).
   */
  moderator: AlertCardPerson | null;
  quarantineRiskScore: number;
  /** Seconds of timeout applied by automod, when relevant. */
  timeoutSeconds?: number | null;
}

export interface SecurityAlertCard {
  securityEventId: string;
  reference: string;
  title: string;
  /** `unscored`: a report nobody assessed — staff judgement, not low risk. */
  severity: 'critical' | 'elevated' | 'low' | 'unscored';
  status: SecurityEventStatusKey;
  /** Buttons (ACKNOWLEDGE / DISMISS / QUARANTINE) are shown only while actionable. */
  actionable: boolean;
  /** Discord ID of the subject, for a non-pinging mention. */
  subjectDiscordId: string | null;
  /** Offer QUARANTINE: the event is about a member (not a bot or webhook account). */
  quarantineOffered: boolean;
  /** USER · RISK SCORE · TRIGGER · EVIDENCE · ACTION · MODERATOR · TIMESTAMP. Values are user text: escape. */
  fields: { label: string; value: string }[];
  timestamp: Date;
}

/** Pure: the security alert card the bot renders as an embed. */
export function buildSecurityAlertCard(input: SecurityAlertCardInput): SecurityAlertCard {
  const { event } = input;
  const reference = securityReference(event.number);
  const scored = isRiskScored(event);
  const severity = !scored
    ? 'unscored'
    : event.riskScore >= input.quarantineRiskScore
      ? 'critical'
      : event.riskScore >= ELEVATED_RISK_SCORE
        ? 'elevated'
        : 'low';
  const signals = event.evidence.signals
    .slice(0, MAX_CARD_SIGNALS)
    .map((s) => `${s.key} (${s.weight})${s.detail ? ` — ${s.detail}` : ''}`);
  const evidence = [
    ...signals,
    ...(event.evidence.messageIds?.length
      ? [`${event.evidence.messageIds.length} message(s)`]
      : []),
    ...(event.evidence.excerpt ? [`“${event.evidence.excerpt}”`] : []),
  ];
  const action =
    event.actionTaken === 'timeout' && input.timeoutSeconds
      ? `${ACTION_LABELS.timeout} ${formatDuration(input.timeoutSeconds)}`
      : ACTION_LABELS[event.actionTaken];
  return {
    securityEventId: event.id,
    reference,
    title: `SECURITY EVENT ${reference} — ${TRIGGER_LABELS[event.trigger]}`,
    severity,
    status: event.status,
    actionable: event.status === 'open' || event.status === 'acknowledged',
    subjectDiscordId: input.subject?.discordId ?? null,
    quarantineOffered: Boolean(input.subject && !input.subject.isBot),
    fields: [
      {
        label: 'USER',
        value: input.subject ? `${input.subject.name} (${input.subject.discordId})` : '—',
      },
      {
        label: 'RISK SCORE',
        value: scored ? `${event.riskScore}/100` : 'NOT SCORED · staff judgement',
      },
      { label: 'TRIGGER', value: TRIGGER_LABELS[event.trigger] },
      { label: 'EVIDENCE', value: evidence.length ? evidence.join('\n') : '—' },
      { label: 'ACTION', value: `${action} · ${event.status.toUpperCase()}` },
      {
        label: 'MODERATOR',
        value: input.moderator
          ? `${input.moderator.name} (${input.moderator.discordId})`
          : UNREVIEWED_ACTOR[event.source],
      },
      { label: 'TIMESTAMP', value: event.createdAt.toISOString() },
    ],
    timestamp: event.createdAt,
  };
}

/** Queue the alert card post (no-op when no security-alerts channel is configured). */
export async function enqueueAlertPost(ctx: ServiceContext, eventId: string): Promise<void> {
  const channels = await getSettings(ctx, 'channels');
  if (!channels.securityAlerts) return;
  await enqueueDiscordJob(
    ctx,
    moderationAlertContract,
    { securityEventId: eventId, mode: 'post', channelId: channels.securityAlerts },
    { dedupeKey: `sec-alert:${eventId}:post` },
  );
}

/**
 * Queue an edit of an already-posted card (after a review or an action). The
 * card is re-rendered from current state, so a change while an edit is in
 * flight re-runs it instead of being dropped (the running edit may have read
 * the state before this change).
 */
export async function enqueueAlertRefresh(
  ctx: ServiceContext,
  event: Pick<SecurityEventRecord, 'id' | 'alertChannelId' | 'alertMessageId'>,
): Promise<void> {
  if (!event.alertChannelId || !event.alertMessageId) return;
  await enqueueDiscordJob(
    ctx,
    moderationAlertContract,
    {
      securityEventId: event.id,
      mode: 'update',
      channelId: event.alertChannelId,
      messageId: event.alertMessageId,
    },
    { dedupeKey: `sec-alert:${event.id}:update`, rerunIfRunning: true },
  );
}
