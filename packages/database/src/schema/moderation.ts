import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  uniqueIndex,
  uuid,
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
    userId: uuid('user_id').references(() => users.id),
    riskScore: smallint('risk_score').notNull(),
    trigger: securityTrigger('trigger').notNull(),
    evidence: jsonb('evidence').$type<SecurityEvidence>().notNull(),
    actionTaken: securityAction('action_taken').notNull().default('none'),
    status: securityEventStatus('status').notNull().default('open'),
    channelId: snowflake('channel_id'),
    reviewedByUserId: uuid('reviewed_by_user_id').references(() => users.id),
    reviewedAt: ts('reviewed_at'),
    reviewNote: text('review_note'),
    createdAt: createdAt(),
  },
  (t) => [
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
]);
export const discordSyncState = pgEnum('discord_sync_state', [
  'pending',
  'applied',
  'failed',
  'not_required',
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
    source: modSource('source').notNull().default('manual'),
    securityEventId: uuid('security_event_id').references(() => securityEvents.id),
    discordSync: discordSyncState('discord_sync').notNull().default('pending'),
    discordError: text('discord_error'),
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
  ],
);
