import {
  boolean,
  bigint,
  date,
  doublePrecision,
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
import { sql } from 'drizzle-orm';
import { createdAt, ts } from './_shared';
import { users } from './identity';

// ─── Audit log ───────────────────────────────────────────────────────────────

export const actorType = pgEnum('actor_type', ['user', 'system', 'ai', 'integration']);
export const auditResult = pgEnum('audit_result', ['success', 'denied', 'failure']);

/** ACTOR · ACTION · TARGET · TIMESTAMP · CONTEXT · RESULT. Append-only. Never contains secrets. */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    actorType: actorType('actor_type').notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    action: varchar('action', { length: 64 }).notNull(),
    targetType: varchar('target_type', { length: 32 }),
    targetId: varchar('target_id', { length: 64 }),
    context: jsonb('context').$type<Record<string, unknown>>().notNull().default({}),
    result: auditResult('result').notNull().default('success'),
    requestId: varchar('request_id', { length: 64 }),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_logs_time_idx').on(t.createdAt),
    index('audit_logs_actor_idx').on(t.actorUserId, t.createdAt),
    index('audit_logs_target_idx').on(t.targetType, t.targetId),
    index('audit_logs_action_idx').on(t.action, t.createdAt),
  ],
);

// ─── Domain events (transactional outbox) ────────────────────────────────────

/**
 * Every meaningful state change emits a domain event in the same transaction.
 * Consumers (achievements, notifications, analytics, outbound webhooks) are
 * driven from here via the job queue.
 */
export const domainEvents = pgTable(
  'domain_events',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    type: varchar('type', { length: 64 }).notNull(),
    aggregateType: varchar('aggregate_type', { length: 32 }).notNull(),
    aggregateId: varchar('aggregate_id', { length: 64 }).notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    /** The member this event is about (drives achievement counting). */
    subjectMemberId: uuid('subject_member_id'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: ts('occurred_at').notNull().defaultNow(),
  },
  (t) => [
    index('domain_events_type_subject_idx').on(t.type, t.subjectMemberId),
    index('domain_events_aggregate_idx').on(t.aggregateType, t.aggregateId),
    index('domain_events_time_idx').on(t.occurredAt),
  ],
);

// ─── Job queue ───────────────────────────────────────────────────────────────

export const jobStatus = pgEnum('job_status', [
  'pending',
  'running',
  'completed',
  'failed',
  'dead',
  'cancelled',
]);

/** Postgres-backed job queue (FOR UPDATE SKIP LOCKED). No Redis required. */
export const jobs = pgTable(
  'jobs',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    type: varchar('type', { length: 64 }).notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    status: jobStatus('status').notNull().default('pending'),
    runAt: ts('run_at').notNull().defaultNow(),
    attempts: smallint('attempts').notNull().default(0),
    maxAttempts: smallint('max_attempts').notNull().default(5),
    lockedAt: ts('locked_at'),
    lockedBy: varchar('locked_by', { length: 64 }),
    lastError: text('last_error'),
    result: jsonb('result').$type<Record<string, unknown>>(),
    /** At most one live (pending/running) job per dedupe key. */
    dedupeKey: varchar('dedupe_key', { length: 200 }),
    /** A same-key enqueue arrived while this job ran: it runs once more when it ends. */
    rerunRequested: boolean('rerun_requested').notNull().default(false),
    createdAt: createdAt(),
    completedAt: ts('completed_at'),
  },
  (t) => [
    index('jobs_ready_idx').on(t.status, t.runAt),
    uniqueIndex('jobs_dedupe_live_uq')
      .on(t.dedupeKey)
      .where(sql`${t.status} in ('pending', 'running')`),
  ],
);

// ─── Settings ────────────────────────────────────────────────────────────────

/** One row per settings section; values validated by zod schemas in @jave/core. */
export const serverSettings = pgTable('server_settings', {
  section: varchar('section', { length: 32 }).primaryKey(),
  value: jsonb('value').$type<Record<string, unknown>>().notNull(),
  version: integer('version').notNull().default(1),
  updatedByUserId: uuid('updated_by_user_id').references(() => users.id),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

// ─── Analytics ───────────────────────────────────────────────────────────────

export const analyticsSnapshots = pgTable(
  'analytics_snapshots',
  {
    day: date('day', { mode: 'string' }).notNull(),
    metric: varchar('metric', { length: 64 }).notNull(),
    dimension: varchar('dimension', { length: 64 }).notNull().default(''),
    value: doublePrecision('value').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('analytics_snapshots_uq').on(t.day, t.metric, t.dimension)],
);

// ─── Rate limiting ───────────────────────────────────────────────────────────

/** Fixed-window counters shared by bot and dashboard processes. */
export const rateLimitBuckets = pgTable('rate_limit_buckets', {
  key: varchar('key', { length: 160 }).primaryKey(),
  windowStart: ts('window_start').notNull(),
  count: smallint('count').notNull().default(0),
});
