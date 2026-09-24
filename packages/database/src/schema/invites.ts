import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
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

export const campaigns = pgTable(
  'campaigns',
  {
    id: id(),
    key: varchar('key', { length: 48 }).notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    description: text('description'),
    startsAt: ts('starts_at'),
    endsAt: ts('ends_at'),
    active: boolean('active').notNull().default(true),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('campaigns_key_uq').on(t.key)],
);

/** Mirror of Discord guild invites, synced to attribute joins by use-count deltas. */
export const inviteCodes = pgTable(
  'invite_codes',
  {
    code: varchar('code', { length: 32 }).primaryKey(),
    inviterUserId: uuid('inviter_user_id').references(() => users.id),
    channelId: snowflake('channel_id'),
    uses: integer('uses').notNull().default(0),
    maxUses: integer('max_uses'),
    temporary: boolean('temporary').notNull().default(false),
    campaignId: uuid('campaign_id').references(() => campaigns.id),
    createdAt: createdAt(),
    expiresAt: ts('expires_at'),
    deletedAt: ts('deleted_at'),
    lastSyncedAt: ts('last_synced_at'),
  },
  (t) => [index('invite_codes_inviter_idx').on(t.inviterUserId)],
);

/** JAVE-level referral codes (usable in applications and onboarding). */
export const referralCodes = pgTable(
  'referral_codes',
  {
    code: varchar('code', { length: 32 }).primaryKey(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id),
    campaignId: uuid('campaign_id').references(() => campaigns.id),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index('referral_codes_owner_idx').on(t.ownerUserId)],
);

export const referralMethod = pgEnum('referral_method', [
  'invite',
  'referral_code',
  'vanity',
  'unknown',
]);
/** INVITED → JOINED → RETAINED → VALID. LEFT / INVALID are terminal. */
export const referralStatus = pgEnum('referral_status', [
  'joined',
  'retained',
  'valid',
  'left',
  'invalid',
]);

export const referrals = pgTable(
  'referrals',
  {
    id: id(),
    inviteeUserId: uuid('invitee_user_id')
      .notNull()
      .references(() => users.id),
    inviterUserId: uuid('inviter_user_id').references(() => users.id),
    inviteCode: varchar('invite_code', { length: 32 }),
    referralCode: varchar('referral_code', { length: 32 }).references(() => referralCodes.code),
    campaignId: uuid('campaign_id').references(() => campaigns.id),
    method: referralMethod('method').notNull(),
    status: referralStatus('status').notNull().default('joined'),
    joinedAt: ts('joined_at').notNull().defaultNow(),
    leftAt: ts('left_at'),
    retainedAt: ts('retained_at'),
    validatedAt: ts('validated_at'),
    anomalyFlags: text('anomaly_flags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    anomalyScore: smallint('anomaly_score').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('referrals_inviter_idx').on(t.inviterUserId, t.status),
    index('referrals_invitee_idx').on(t.inviteeUserId),
    index('referrals_joined_idx').on(t.joinedAt),
  ],
);
