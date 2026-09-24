import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  uniqueIndex,
  uuid,
  varchar,
  boolean,
} from 'drizzle-orm/pg-core';
import { createdAt, id, ts } from './_shared';
import { users } from './identity';

export const notificationSeverity = pgEnum('notification_severity', [
  'info',
  'notice',
  'important',
  'critical',
]);
export const notificationChannel = pgEnum('notification_channel', [
  'discord_dm',
  'discord_channel',
  'dashboard',
  'email',
  'webhook',
]);

export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    recipientUserId: uuid('recipient_user_id')
      .notNull()
      .references(() => users.id),
    /** e.g. application.updated, mission.assigned, achievement.unlocked */
    type: varchar('type', { length: 64 }).notNull(),
    severity: notificationSeverity('severity').notNull().default('info'),
    title: varchar('title', { length: 120 }).notNull(),
    body: text('body').notNull(),
    url: text('url'),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    /** Prevents duplicate notifications for the same underlying fact. */
    dedupeKey: varchar('dedupe_key', { length: 200 }),
    createdAt: createdAt(),
    readAt: ts('read_at'),
  },
  (t) => [
    uniqueIndex('notifications_dedupe_uq').on(t.dedupeKey),
    index('notifications_recipient_idx').on(t.recipientUserId, t.createdAt),
  ],
);

export const deliveryStatus = pgEnum('delivery_status', [
  'pending',
  'deferred',
  'sent',
  'failed',
  'skipped',
]);

export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: id(),
    notificationId: uuid('notification_id')
      .notNull()
      .references(() => notifications.id, { onDelete: 'cascade' }),
    channel: notificationChannel('channel').notNull(),
    status: deliveryStatus('status').notNull().default('pending'),
    attempts: smallint('attempts').notNull().default(0),
    lastError: text('last_error'),
    /** Quiet hours defer delivery until this time. */
    deliverAfter: ts('deliver_after'),
    sentAt: ts('sent_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('notification_deliveries_uq').on(t.notificationId, t.channel),
    index('notification_deliveries_status_idx').on(t.status, t.deliverAfter),
  ],
);

/** Per-user opt-outs. type '*' applies to all notification types. */
export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    type: varchar('type', { length: 64 }).notNull(),
    channel: notificationChannel('channel').notNull(),
    enabled: boolean('enabled').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.type, t.channel] })],
);
