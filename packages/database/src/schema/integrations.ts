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
import { createdAt, id, snowflake, ts, updatedAt } from './_shared';
import { members, users } from './identity';

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
    secretRotatedAt: ts('secret_rotated_at'),
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

/**
 * Inbound webhook deliveries. (integration_id, delivery_id) is the idempotency
 * key: delivery IDs are only unique per sender, so two integrations of the
 * same provider can never shadow each other's deliveries.
 */
export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: id(),
    integrationId: uuid('integration_id')
      .notNull()
      .references(() => integrations.id),
    provider: integrationProvider('provider').notNull(),
    deliveryId: varchar('delivery_id', { length: 128 }).notNull(),
    eventType: varchar('event_type', { length: 64 }).notNull(),
    /**
     * SHA-256 of the verified signature. Unique per integration, so a captured
     * request replayed with a different (unsigned) delivery id is still a duplicate.
     */
    signatureDigest: varchar('signature_digest', { length: 64 }).notNull(),
    status: webhookDeliveryStatus('status').notNull().default('received'),
    /** Why processing ended where it did (e.g. 'no processor configured'). */
    statusReason: varchar('status_reason', { length: 200 }),
    payload: jsonb('payload').$type<unknown>().notNull(),
    attempts: smallint('attempts').notNull().default(0),
    lastError: text('last_error'),
    /** Discord message the relay posted (discord.integrations.relay callback). */
    relayMessageId: snowflake('relay_message_id'),
    relayedAt: ts('relayed_at'),
    receivedAt: ts('received_at').notNull().defaultNow(),
    processedAt: ts('processed_at'),
  },
  (t) => [
    uniqueIndex('webhook_deliveries_idempotency_uq').on(t.integrationId, t.deliveryId),
    uniqueIndex('webhook_deliveries_signature_uq').on(t.integrationId, t.signatureDigest),
    /**
     * GitHub deliveries share one deployment-wide secret, so their idempotency
     * is deployment-wide too: (provider, delivery_id) and (provider, digest).
     * A request captured for one GitHub integration cannot be replayed to another.
     */
    uniqueIndex('webhook_deliveries_github_delivery_uq')
      .on(t.provider, t.deliveryId)
      .where(sql`${t.provider} = 'github'`),
    uniqueIndex('webhook_deliveries_github_signature_uq')
      .on(t.provider, t.signatureDigest)
      .where(sql`${t.provider} = 'github'`),
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
  secretRotatedAt: ts('secret_rotated_at'),
  enabled: boolean('enabled').notNull().default(true),
  consecutiveFailures: integer('consecutive_failures').notNull().default(0),
  lastDeliveryAt: ts('last_delivery_at'),
  lastFailureAt: ts('last_failure_at'),
  lastError: varchar('last_error', { length: 500 }),
  /** Set when JAVE disables the subscription itself (e.g. too many consecutive failures). */
  disabledAt: ts('disabled_at'),
  disabledReason: varchar('disabled_reason', { length: 200 }),
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

export const externalAccountProvider = pgEnum('external_account_provider', ['github']);

/**
 * External identities linked to a member. Self-declared links are unverified;
 * staff mark them verified (never their own). Usernames are stored lowercase.
 */
export const externalAccounts = pgTable(
  'external_accounts',
  {
    id: id(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id),
    provider: externalAccountProvider('provider').notNull(),
    /** Provider's stable numeric ID (GitHub user id), recorded on verification. */
    externalId: varchar('external_id', { length: 64 }),
    username: varchar('username', { length: 64 }).notNull(),
    verifiedAt: ts('verified_at'),
    verifiedByUserId: uuid('verified_by_user_id').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('external_accounts_member_provider_uq').on(t.memberId, t.provider),
    uniqueIndex('external_accounts_username_uq').on(t.provider, t.username),
    uniqueIndex('external_accounts_external_id_uq')
      .on(t.provider, t.externalId)
      .where(sql`${t.externalId} is not null`),
  ],
);
