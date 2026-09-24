import {
  type AnyPgColumn,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { createdAt, id, snowflake, ts, updatedAt } from './_shared';
import { members, users } from './identity';

export const eventKind = pgEnum('event_kind', [
  'meetup',
  'workshop',
  'talk',
  'tournament',
  'session',
  'social',
  'other',
]);
export const eventStatus = pgEnum('event_status', ['scheduled', 'live', 'completed', 'cancelled']);

export const events = pgTable(
  'events',
  {
    id: id(),
    title: varchar('title', { length: 120 }).notNull(),
    description: text('description'),
    kind: eventKind('kind').notNull(),
    status: eventStatus('status').notNull().default('scheduled'),
    startsAt: ts('starts_at').notNull(),
    /** Always set: the service derives a default from startsAt when the host gives none. */
    endsAt: ts('ends_at').notNull(),
    /** Discord channel id, external http(s) URL, or a short physical location. */
    location: varchar('location', { length: 200 }),
    discordScheduledEventId: snowflake('discord_scheduled_event_id'),
    /** Announcement message with RSVP buttons, posted by the bot. */
    announcementChannelId: snowflake('announcement_channel_id'),
    announcementMessageId: snowflake('announcement_message_id'),
    capacity: integer('capacity'),
    rsvpClosesAt: ts('rsvp_closes_at'),
    /** SHA-256 of the check-in code; the code itself is shown once to the host. */
    checkInCodeHash: varchar('check_in_code_hash', { length: 64 }),
    checkInCodeIssuedAt: ts('check_in_code_issued_at'),
    hostMemberId: uuid('host_member_id').references(() => members.id),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    /** Bumped on every change the Discord mirror must reflect; stale sync jobs skip. */
    revision: integer('revision').notNull().default(0),
    liveAt: ts('live_at'),
    completedAt: ts('completed_at'),
    cancelledAt: ts('cancelled_at'),
    cancelReason: varchar('cancel_reason', { length: 500 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('events_starts_idx').on(t.status, t.startsAt),
    index('events_ends_idx').on(t.endsAt),
  ],
);

export const rsvpStatus = pgEnum('rsvp_status', ['going', 'maybe', 'declined', 'waitlist']);

export const eventRsvps = pgTable(
  'event_rsvps',
  {
    id: id(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id),
    status: rsvpStatus('status').notNull(),
    /** When the member last changed their response; orders the waitlist (FIFO). */
    respondedAt: ts('responded_at').notNull().defaultNow(),
    checkedInAt: ts('checked_in_at'),
  },
  (t) => [
    uniqueIndex('event_rsvps_uq').on(t.eventId, t.memberId),
    index('event_rsvps_member_idx').on(t.memberId),
    index('event_rsvps_status_idx').on(t.eventId, t.status, t.respondedAt),
  ],
);

export const eventTeams = pgTable(
  'event_teams',
  {
    id: id(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 64 }).notNull(),
    seed: smallint('seed'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('event_teams_name_uq').on(t.eventId, t.name)],
);

export const eventTeamMembers = pgTable(
  'event_team_members',
  {
    teamId: uuid('team_id')
      .notNull()
      .references(() => eventTeams.id, { onDelete: 'cascade' }),
    /** Denormalized so a member sits on at most one team per event (unique index). */
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id),
  },
  (t) => [
    primaryKey({ columns: [t.teamId, t.memberId] }),
    uniqueIndex('event_team_members_event_member_uq').on(t.eventId, t.memberId),
  ],
);

export const matchStatus = pgEnum('match_status', ['pending', 'ready', 'completed', 'bye']);
export const bracketSlot = pgEnum('bracket_slot', ['a', 'b']);

/** Single-elimination bracket. Winners advance via next_match_id / next_slot. */
export const tournamentMatches = pgTable(
  'tournament_matches',
  {
    id: id(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    round: smallint('round').notNull(),
    position: smallint('position').notNull(),
    teamAId: uuid('team_a_id').references(() => eventTeams.id),
    teamBId: uuid('team_b_id').references(() => eventTeams.id),
    winnerTeamId: uuid('winner_team_id').references(() => eventTeams.id),
    scoreA: integer('score_a'),
    scoreB: integer('score_b'),
    status: matchStatus('status').notNull().default('pending'),
    nextMatchId: uuid('next_match_id').references((): AnyPgColumn => tournamentMatches.id),
    nextSlot: bracketSlot('next_slot'),
    reportedByUserId: uuid('reported_by_user_id').references(() => users.id),
    completedAt: ts('completed_at'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('tournament_matches_pos_uq').on(t.eventId, t.round, t.position)],
);
