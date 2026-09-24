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

export interface AlertCardPerson {
  discordId: string;
  name: string;
}

export interface SecurityAlertCardInput {
  event: SecurityEventRecord;
  subject: AlertCardPerson | null;
  moderator: AlertCardPerson | null;
  quarantineRiskScore: number;
  /** Seconds of timeout applied by automod, when relevant. */
  timeoutSeconds?: number | null;
}

export interface SecurityAlertCard {
  securityEventId: string;
  reference: string;
  title: string;
  severity: 'critical' | 'elevated' | 'low';
  status: SecurityEventStatusKey;
  /** Buttons (ACKNOWLEDGE / DISMISS / QUARANTINE) are shown only while actionable. */
  actionable: boolean;
  /** Discord ID of the subject, for the QUARANTINE button and a non-pinging mention. */
  subjectDiscordId: string | null;
  /** USER · RISK SCORE · TRIGGER · EVIDENCE · ACTION · MODERATOR · TIMESTAMP. Values are user text: escape. */
  fields: { label: string; value: string }[];
  timestamp: Date;
}

/** Pure: the security alert card the bot renders as an embed. */
export function buildSecurityAlertCard(input: SecurityAlertCardInput): SecurityAlertCard {
  const { event } = input;
  const reference = securityReference(event.number);
  const severity =
    event.riskScore >= input.quarantineRiskScore
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
    fields: [
      {
        label: 'USER',
        value: input.subject ? `${input.subject.name} (${input.subject.discordId})` : '—',
      },
      { label: 'RISK SCORE', value: `${event.riskScore}/100` },
      { label: 'TRIGGER', value: TRIGGER_LABELS[event.trigger] },
      { label: 'EVIDENCE', value: evidence.length ? evidence.join('\n') : '—' },
      { label: 'ACTION', value: `${action} · ${event.status.toUpperCase()}` },
      {
        label: 'MODERATOR',
        value: input.moderator
          ? `${input.moderator.name} (${input.moderator.discordId})`
          : 'AUTOMOD',
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

/** Queue an edit of an already-posted card (after a review or an action). */
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
    { dedupeKey: `sec-alert:${event.id}:update` },
  );
}
