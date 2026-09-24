import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
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
import { createdAt, id, ts, updatedAt } from './_shared';
import { users } from './identity';

export const integrationProvider = pgEnum('integration_provider', [
  'github',
  'generic',
  'sidus',
  'supabase',
  'monitoring',
]);

export const integrations = pgTable(
  'integrations',
  {
    id: id(),
    provider: integrationProvider('provider').notNull(),
    name: varchar('name', { length: 80 }).notNull(),
    /** Used in the inbound webhook URL: /api/webhooks/{slug} */
    slug: varchar('slug', { length: 48 }).notNull(),
    enabled: boolean('enabled').notNull().default(true),
    /** Non-secret configuration only. */
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    /** AES-256-GCM ciphertext of the signing secret (JAVE_ENCRYPTION_KEY). */
    secretCiphertext: text('secret_ciphertext'),
    lastEventAt: ts('last_event_at'),
    lastErrorAt: ts('last_error_at'),
    lastError: text('last_error'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('integrations_slug_uq').on(t.slug)],
);

export const webhookDeliveryStatus = pgEnum('webhook_delivery_status', [
  'received',
  'processing',
  'processed',
  'ignored',
  'failed',
  'dead',
]);

/** Inbound webhook deliveries. (provider, delivery_id) is the idempotency key. */
export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: id(),
    integrationId: uuid('integration_id').references(() => integrations.id),
    provider: integrationProvider('provider').notNull(),
    deliveryId: varchar('delivery_id', { length: 128 }).notNull(),
    eventType: varchar('event_type', { length: 64 }).notNull(),
    status: webhookDeliveryStatus('status').notNull().default('received'),
    payload: jsonb('payload').$type<unknown>().notNull(),
    attempts: smallint('attempts').notNull().default(0),
    lastError: text('last_error'),
    receivedAt: ts('received_at').notNull().defaultNow(),
    processedAt: ts('processed_at'),
  },
  (t) => [
    uniqueIndex('webhook_deliveries_idempotency_uq').on(t.provider, t.deliveryId),
    index('webhook_deliveries_status_idx').on(t.status, t.receivedAt),
  ],
);

/** Outbound webhook subscriptions (JAVE → external services). */
export const outboundWebhooks = pgTable('outbound_webhooks', {
  id: id(),
  name: varchar('name', { length: 80 }).notNull(),
  url: text('url').notNull(),
  eventTypes: text('event_types')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  secretCiphertext: text('secret_ciphertext').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  consecutiveFailures: integer('consecutive_failures').notNull().default(0),
  lastDeliveryAt: ts('last_delivery_at'),
  createdByUserId: uuid('created_by_user_id').references(() => users.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const outboundDeliveries = pgTable(
  'outbound_deliveries',
  {
    id: id(),
    webhookId: uuid('webhook_id')
      .notNull()
      .references(() => outboundWebhooks.id, { onDelete: 'cascade' }),
    eventId: bigint('event_id', { mode: 'number' }).notNull(),
    eventType: varchar('event_type', { length: 64 }).notNull(),
    status: webhookDeliveryStatus('status').notNull().default('received'),
    responseStatus: smallint('response_status'),
    attempts: smallint('attempts').notNull().default(0),
    lastError: text('last_error'),
    createdAt: createdAt(),
    deliveredAt: ts('delivered_at'),
  },
  (t) => [uniqueIndex('outbound_deliveries_uq').on(t.webhookId, t.eventId)],
);
