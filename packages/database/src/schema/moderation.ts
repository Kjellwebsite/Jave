import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { createdAt, id, snowflake, ts, updatedAt } from './_shared';
import { users } from './identity';

export const securityTrigger = pgEnum('security_trigger', [
  'spam_rate',
  'duplicate_content',
  'mention_spam',
  'blocked_link',
  'foreign_invite',
  'join_burst',
  'suspicious_account',
  'manual_report',
]);

export const securityAction = pgEnum('security_action', [
  'none',
  'flagged',
  'message_deleted',
  'timeout',
  'quarantine',
  'kick',
  'ban',
  'lockdown',
]);

export const securityEventStatus = pgEnum('security_event_status', [
  'open',
  'acknowledged',
  'dismissed',
  'actioned',
]);

/** Who raised a security event. */
export const securityEventSource = pgEnum('security_event_source', [
  'automod',
  'join_screening',
  'manual',
  'integration',
  'system',
]);

export interface SecurityEvidence {
  signals: { key: string; weight: number; detail?: string }[];
  channelId?: string;
  messageIds?: string[];
  /** Truncated excerpt. Never full message history. */
  excerpt?: string;
  [key: string]: unknown;
}

/** USER · RISK SCORE · TRIGGER · EVIDENCE · ACTION · MODERATOR · TIMESTAMP */
export const securityEvents = pgTable(
  'security_events',
  {
    id: id(),
    /** Human-facing reference (SEC-0042). */
    number: integer('number').notNull().generatedAlwaysAsIdentity(),
    userId: uuid('user_id').references(() => users.id),
    riskScore: smallint('risk_score').notNull(),
    trigger: securityTrigger('trigger').notNull(),
    source: securityEventSource('source').notNull().default('system'),
    evidence: jsonb('evidence').$type<SecurityEvidence>().notNull(),
    actionTaken: securityAction('action_taken').notNull().default('none'),
    status: securityEventStatus('status').notNull().default('open'),
    channelId: snowflake('channel_id'),
    /** Staff member who filed a manual report. */
    reportedByUserId: uuid('reported_by_user_id').references(() => users.id),
    /** Idempotency key for automated sources (e.g. `automod:<messageId>`). */
    dedupeKey: varchar('dedupe_key', { length: 128 }),
    /** Where the bot posted the alert card, so it can be edited after review. */
    alertChannelId: snowflake('alert_channel_id'),
    alertMessageId: snowflake('alert_message_id'),
    reviewedByUserId: uuid('reviewed_by_user_id').references(() => users.id),
    reviewedAt: ts('reviewed_at'),
    reviewNote: text('review_note'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('security_events_number_uq').on(t.number),
    uniqueIndex('security_events_dedupe_uq').on(t.dedupeKey),
    index('security_events_time_idx').on(t.createdAt),
    index('security_events_user_idx').on(t.userId),
    index('security_events_status_idx').on(t.status),
  ],
);

export const modAction = pgEnum('mod_action', [
  'warn',
  'timeout',
  'untimeout',
  'kick',
  'ban',
  'unban',
  'quarantine',
  'release',
  'note',
]);
export const modSource = pgEnum('mod_source', [
  'manual',
  'automod',
  'ai_suggested',
  'security_event',
  'system',
]);
export const discordSyncState = pgEnum('discord_sync_state', [
  'pending',
  'applied',
  'failed',
  'not_required',
]);
/** Why a live case (timeout / quarantine / ban) stopped being in force. */
export const modCaseEndReason = pgEnum('mod_case_end_reason', [
  'expired',
  'lifted',
  'superseded',
  'revoked',
]);

export const modCases = pgTable(
  'mod_cases',
  {
    id: id(),
    number: integer('number').notNull().generatedAlwaysAsIdentity(),
    action: modAction('action').notNull(),
    targetUserId: uuid('target_user_id')
      .notNull()
      .references(() => users.id),
    /** Null for automod/system actions. */
    moderatorUserId: uuid('moderator_user_id').references(() => users.id),
    reason: text('reason').notNull(),
    durationSeconds: integer('duration_seconds'),
    expiresAt: ts('expires_at'),
    /** Ban only: days of the target's message history Discord deletes (0–7). */
    deleteMessageDays: smallint('delete_message_days'),
    source: modSource('source').notNull().default('manual'),
    securityEventId: uuid('security_event_id').references(() => securityEvents.id),
    /** Reversal cases (untimeout / unban / release) point at the case they lift. */
    revertsCaseId: uuid('reverts_case_id').references((): AnyPgColumn => modCases.id),
    discordSync: discordSyncState('discord_sync').notNull().default('pending'),
    discordError: text('discord_error'),
    discordSyncedAt: ts('discord_synced_at'),
    /** Live cases only: when the timeout / quarantine / ban stopped being in force. */
    endedAt: ts('ended_at'),
    endedReason: modCaseEndReason('ended_reason'),
    revokedAt: ts('revoked_at'),
    revokedByUserId: uuid('revoked_by_user_id').references(() => users.id),
    revokeReason: text('revoke_reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('mod_cases_number_uq').on(t.number),
    index('mod_cases_target_idx').on(t.targetUserId, t.createdAt),
    index('mod_cases_time_idx').on(t.createdAt),
    index('mod_cases_security_event_idx').on(t.securityEventId),
    /** At most one live timeout / quarantine / ban per user (race backstop). */
    uniqueIndex('mod_cases_live_uq')
      .on(t.targetUserId, t.action)
      .where(sql`${t.endedAt} is null and ${t.action} in ('timeout', 'quarantine', 'ban')`),
    /** Expiry sweep: live cases with a deadline. */
    index('mod_cases_expiry_idx')
      .on(t.expiresAt)
      .where(sql`${t.endedAt} is null and ${t.expiresAt} is not null`),
  ],
);
