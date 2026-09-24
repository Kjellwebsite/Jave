import { sql } from 'drizzle-orm';
import {
  bigint,
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
import { createdAt, deletedAt, id, snowflake, ts, updatedAt } from './_shared';

// ─── Organizational roles ────────────────────────────────────────────────────

/**
 * JAVELIN organizational roles. JAVE is the source of truth; Discord roles are
 * synchronized from these (see settings.roles for the Discord role mapping).
 */
export const orgRole = pgEnum('org_role', [
  'founder',
  'core',
  'operations',
  'moderator',
  'verified',
  'trial',
  'applicant',
  'member',
  'supporter',
]);

export const guildStatus = pgEnum('guild_status', ['present', 'departed', 'never_joined']);
export const memberStanding = pgEnum('member_standing', [
  'good',
  'restricted',
  'quarantined',
  'banned',
]);
export const onboardingState = pgEnum('onboarding_state', [
  'not_started',
  'in_progress',
  'completed',
]);
export const profileVisibility = pgEnum('profile_visibility', ['public', 'members', 'staff']);

// ─── Accounts ────────────────────────────────────────────────────────────────

/** A Discord account known to JAVE. Identity only — no organizational meaning. */
export const users = pgTable(
  'users',
  {
    id: id(),
    discordId: snowflake('discord_id').notNull(),
    username: varchar('username', { length: 64 }).notNull(),
    displayName: varchar('display_name', { length: 64 }),
    avatarHash: varchar('avatar_hash', { length: 128 }),
    isBot: boolean('is_bot').notNull().default(false),
    discordCreatedAt: ts('discord_created_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [uniqueIndex('users_discord_id_uq').on(t.discordId)],
);

/** JAVELIN membership record. One per user. */
export const members = pgTable(
  'members',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    /** Public profile handle, used in shareable URLs. Lowercase. */
    handle: varchar('handle', { length: 32 }).notNull(),
    displayName: varchar('display_name', { length: 64 }).notNull(),
    headline: varchar('headline', { length: 160 }),
    bio: text('bio'),
    primaryDomain: varchar('primary_domain', { length: 32 }).references(
      () => capabilityDomains.key,
    ),
    guildStatus: guildStatus('guild_status').notNull().default('present'),
    standing: memberStanding('standing').notNull().default('good'),
    onboardingState: onboardingState('onboarding_state').notNull().default('not_started'),
    profileVisibility: profileVisibility('profile_visibility').notNull().default('members'),
    showClaimsPublicly: boolean('show_claims_publicly').notNull().default(true),
    showOnLeaderboards: boolean('show_on_leaderboards').notNull().default(true),
    joinedGuildAt: ts('joined_guild_at'),
    leftGuildAt: ts('left_guild_at'),
    onboardedAt: ts('onboarded_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex('members_user_id_uq').on(t.userId),
    uniqueIndex('members_handle_uq').on(t.handle),
    index('members_guild_status_idx').on(t.guildStatus),
  ],
);

export const memberRoles = pgTable(
  'member_roles',
  {
    id: id(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id),
    role: orgRole('role').notNull(),
    grantedByUserId: uuid('granted_by_user_id').references(() => users.id),
    reason: text('reason'),
    grantedAt: ts('granted_at').notNull().defaultNow(),
    expiresAt: ts('expires_at'),
    revokedAt: ts('revoked_at'),
    revokedByUserId: uuid('revoked_by_user_id').references(() => users.id),
  },
  (t) => [
    uniqueIndex('member_roles_active_uq')
      .on(t.memberId, t.role)
      .where(sql`${t.revokedAt} is null`),
    index('member_roles_role_idx').on(t.role),
  ],
);

/** Dashboard sessions. Only a SHA-256 hash of the session token is stored. */
export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    userAgent: varchar('user_agent', { length: 256 }),
    ipHash: varchar('ip_hash', { length: 64 }),
    createdAt: createdAt(),
    expiresAt: ts('expires_at').notNull(),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
    revokedAt: ts('revoked_at'),
  },
  (t) => [
    uniqueIndex('sessions_token_hash_uq').on(t.tokenHash),
    index('sessions_user_idx').on(t.userId),
  ],
);

export const userPreferences = pgTable('user_preferences', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id),
  timezone: varchar('timezone', { length: 64 }).notNull().default('UTC'),
  /** Minutes after local midnight. Both null = no quiet hours. */
  quietHoursStart: smallint('quiet_hours_start'),
  quietHoursEnd: smallint('quiet_hours_end'),
  dmNotifications: boolean('dm_notifications').notNull().default(true),
  updatedAt: updatedAt(),
});

// ─── Capability catalog ──────────────────────────────────────────────────────

/**
 * Rank ladder. Data-driven so S+ / SS can be added later as rows with higher
 * ordinals — no code or schema change required.
 */
export const rankTiers = pgTable('rank_tiers', {
  code: varchar('code', { length: 4 }).primaryKey(),
  ordinal: smallint('ordinal').notNull().unique(),
  label: varchar('label', { length: 32 }).notNull(),
  description: text('description').notNull(),
  enabled: boolean('enabled').notNull().default(true),
});

export const capabilityDomains = pgTable('capability_domains', {
  key: varchar('key', { length: 32 }).primaryKey(),
  label: varchar('label', { length: 32 }).notNull(),
  description: text('description').notNull(),
  ordinal: smallint('ordinal').notNull(),
});

export const capabilityFacets = pgTable('capability_facets', {
  key: varchar('key', { length: 48 }).primaryKey(),
  domainKey: varchar('domain_key', { length: 32 })
    .notNull()
    .references(() => capabilityDomains.key),
  label: varchar('label', { length: 48 }).notNull(),
  description: text('description').notNull(),
  ordinal: smallint('ordinal').notNull(),
  enabled: boolean('enabled').notNull().default(true),
});

// ─── Member capabilities ─────────────────────────────────────────────────────

/**
 * One row per (member, facet). Claimed and verified ranks are tracked
 * separately: status is VERIFIED when verified_rank is set, CLAIMED when only
 * claimed_rank is set, UNKNOWN otherwise.
 */
export const memberCapabilities = pgTable(
  'member_capabilities',
  {
    id: id(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id),
    facetKey: varchar('facet_key', { length: 48 })
      .notNull()
      .references(() => capabilityFacets.key),
    claimedRank: varchar('claimed_rank', { length: 4 }).references(() => rankTiers.code),
    claimedAt: ts('claimed_at'),
    verifiedRank: varchar('verified_rank', { length: 4 }).references(() => rankTiers.code),
    verifiedAt: ts('verified_at'),
    verifiedByUserId: uuid('verified_by_user_id').references(() => users.id),
    /** Evaluator notes. Staff-only. */
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('member_capabilities_member_facet_uq').on(t.memberId, t.facetKey)],
);

export const evidenceKind = pgEnum('evidence_kind', [
  'link',
  'document',
  'project',
  'trial',
  'mission',
  'achievement',
  'contribution',
  'evaluation',
  'other',
]);
export const evidenceStatus = pgEnum('evidence_status', ['submitted', 'accepted', 'rejected']);

/** A piece of evidence supporting a capability claim or verification. */
export const evidence = pgTable(
  'evidence',
  {
    id: id(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id),
    kind: evidenceKind('kind').notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    url: text('url'),
    description: text('description'),
    facetKey: varchar('facet_key', { length: 48 }).references(() => capabilityFacets.key),
    /** Originating record for system-generated evidence (e.g. 'trial', trial id). */
    sourceType: varchar('source_type', { length: 32 }),
    sourceId: uuid('source_id'),
    status: evidenceStatus('status').notNull().default('submitted'),
    reviewedByUserId: uuid('reviewed_by_user_id').references(() => users.id),
    reviewedAt: ts('reviewed_at'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index('evidence_member_idx').on(t.memberId),
    index('evidence_source_idx').on(t.sourceType, t.sourceId),
  ],
);

export const rankTrack = pgEnum('rank_track', ['claimed', 'verified']);
export const rankChangeSource = pgEnum('rank_change_source', [
  'self',
  'evaluator',
  'trial',
  'verification',
  'system',
  'import',
]);

/** Append-only history of every rank change. */
export const rankHistory = pgTable(
  'rank_history',
  {
    id: id(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id),
    facetKey: varchar('facet_key', { length: 48 })
      .notNull()
      .references(() => capabilityFacets.key),
    track: rankTrack('track').notNull(),
    fromRank: varchar('from_rank', { length: 4 }).references(() => rankTiers.code),
    toRank: varchar('to_rank', { length: 4 }).references(() => rankTiers.code),
    source: rankChangeSource('source').notNull(),
    sourceRef: uuid('source_ref'),
    reason: text('reason'),
    evidenceId: uuid('evidence_id').references(() => evidence.id),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('rank_history_member_idx').on(t.memberId, t.createdAt)],
);

/** Private staff notes about a member. */
export const memberNotes = pgTable(
  'member_notes',
  {
    id: id(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id),
    authorUserId: uuid('author_user_id')
      .notNull()
      .references(() => users.id),
    body: text('body').notNull(),
    createdAt: createdAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index('member_notes_member_idx').on(t.memberId)],
);

export const guildMemberEventType = pgEnum('guild_member_event_type', ['join', 'leave']);

/** Raw join/leave stream. Source for retention analytics and raid detection. */
export const guildMemberEvents = pgTable(
  'guild_member_events',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    type: guildMemberEventType('type').notNull(),
    accountAgeDays: integer('account_age_days'),
    occurredAt: ts('occurred_at').notNull().defaultNow(),
  },
  (t) => [
    index('guild_member_events_time_idx').on(t.occurredAt),
    index('guild_member_events_user_idx').on(t.userId),
  ],
);
