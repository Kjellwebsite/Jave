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
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { createdAt, id, snowflake, ts, updatedAt } from './_shared';
import { users } from './identity';

export const gameSessionStatus = pgEnum('game_session_status', [
  'lobby',
  'active',
  'completed',
  'abandoned',
]);
export const gameSurface = pgEnum('game_surface', ['discord', 'activity', 'dashboard']);

export const gameSessions = pgTable(
  'game_sessions',
  {
    id: id(),
    gameKey: varchar('game_key', { length: 32 }).notNull(),
    status: gameSessionStatus('status').notNull().default('lobby'),
    surface: gameSurface('surface').notNull(),
    hostUserId: uuid('host_user_id')
      .notNull()
      .references(() => users.id),
    discordChannelId: snowflake('discord_channel_id'),
    discordMessageId: snowflake('discord_message_id'),
    /** Discord Activity instance id when played inside an Activity. */
    activityInstanceId: varchar('activity_instance_id', { length: 128 }),
    /** Never shown to players: with the engine code it would predict hidden state. */
    seed: varchar('seed', { length: 64 }).notNull(),
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    /** Engine-owned state snapshot; lets sessions survive restarts. */
    state: jsonb('state').$type<Record<string, unknown>>().notNull().default({}),
    /** Optimistic concurrency guard for state updates. */
    version: integer('version').notNull().default(0),
    /** Players at start; sessions with fewer than two are practice and never ranked. */
    playerCount: smallint('player_count'),
    /** Last join/leave/move/tick; drives the stale-session sweep. */
    lastActivityAt: ts('last_activity_at').notNull().defaultNow(),
    endReason: varchar('end_reason', { length: 200 }),
    startedAt: ts('started_at'),
    endedAt: ts('ended_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('game_sessions_status_idx').on(t.gameKey, t.status),
    index('game_sessions_activity_idx').on(t.activityInstanceId),
    index('game_sessions_sweep_idx').on(t.status, t.lastActivityAt),
    uniqueIndex('game_sessions_live_channel_uq')
      .on(t.discordChannelId)
      .where(sql`${t.status} in ('lobby', 'active') and ${t.discordChannelId} is not null`),
    uniqueIndex('game_sessions_live_activity_uq')
      .on(t.activityInstanceId)
      .where(sql`${t.status} in ('lobby', 'active') and ${t.activityInstanceId} is not null`),
  ],
);

export const gamePlayers = pgTable(
  'game_players',
  {
    id: id(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => gameSessions.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    /** 1-based join order, assigned under the session lock; the engine's player order. */
    seat: integer('seat').notNull(),
    team: varchar('team', { length: 32 }),
    score: integer('score').notNull().default(0),
    placement: smallint('placement'),
    joinedAt: ts('joined_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('game_players_uq').on(t.sessionId, t.userId),
    uniqueIndex('game_players_seat_uq').on(t.sessionId, t.seat),
    index('game_players_user_idx').on(t.userId),
  ],
);

export const gameMoves = pgTable(
  'game_moves',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => gameSessions.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    round: smallint('round').notNull(),
    move: jsonb('move').$type<Record<string, unknown>>().notNull(),
    correct: boolean('correct'),
    points: integer('points').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('game_moves_round_uq').on(t.sessionId, t.userId, t.round)],
);
