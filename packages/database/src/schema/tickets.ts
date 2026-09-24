import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { createdAt, id, snowflake, ts, updatedAt } from './_shared';
import { users } from './identity';

export const ticketCategory = pgEnum('ticket_category', [
  'general',
  'application',
  'technical',
  'report',
  'partnership',
  'trial',
  'operations',
  'other',
]);
export const ticketPriority = pgEnum('ticket_priority', ['low', 'normal', 'high', 'urgent']);
export const ticketStatus = pgEnum('ticket_status', [
  'open',
  'claimed',
  'waiting',
  'closed',
  'archived',
]);

export const tickets = pgTable(
  'tickets',
  {
    id: id(),
    number: integer('number').notNull().generatedAlwaysAsIdentity(),
    category: ticketCategory('category').notNull(),
    priority: ticketPriority('priority').notNull().default('normal'),
    status: ticketStatus('status').notNull().default('open'),
    subject: varchar('subject', { length: 120 }).notNull(),
    openerUserId: uuid('opener_user_id')
      .notNull()
      .references(() => users.id),
    assigneeUserId: uuid('assignee_user_id').references(() => users.id),
    /** Tickets live in private threads under the configured ticket channel. */
    discordChannelId: snowflake('discord_channel_id'),
    discordThreadId: snowflake('discord_thread_id'),
    slaFirstResponseDueAt: ts('sla_first_response_due_at'),
    firstResponseAt: ts('first_response_at'),
    slaBreachedAt: ts('sla_breached_at'),
    lastActivityAt: ts('last_activity_at').notNull().defaultNow(),
    closedAt: ts('closed_at'),
    closedByUserId: uuid('closed_by_user_id').references(() => users.id),
    closeReason: text('close_reason'),
    reopenCount: integer('reopen_count').notNull().default(0),
    aiSummary: text('ai_summary'),
    aiSummaryAt: ts('ai_summary_at'),
    archivedAt: ts('archived_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('tickets_number_uq').on(t.number),
    uniqueIndex('tickets_thread_uq').on(t.discordThreadId),
    index('tickets_status_idx').on(t.status, t.createdAt),
    index('tickets_assignee_idx').on(t.assigneeUserId),
    index('tickets_opener_idx').on(t.openerUserId),
  ],
);

export interface TicketAttachment {
  name: string;
  url: string;
  size: number;
  contentType?: string;
}

/** Transcript. Internal notes are messages with is_internal = true. */
export const ticketMessages = pgTable(
  'ticket_messages',
  {
    id: id(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    authorUserId: uuid('author_user_id').references(() => users.id),
    discordMessageId: snowflake('discord_message_id'),
    body: text('body').notNull(),
    attachments: jsonb('attachments').$type<TicketAttachment[]>().notNull().default([]),
    isInternal: boolean('is_internal').notNull().default(false),
    createdAt: createdAt(),
    editedAt: ts('edited_at'),
    deletedAt: ts('deleted_at'),
  },
  (t) => [
    index('ticket_messages_ticket_idx').on(t.ticketId, t.createdAt),
    uniqueIndex('ticket_messages_discord_uq').on(t.discordMessageId),
  ],
);

export const ticketEventType = pgEnum('ticket_event_type', [
  'created',
  'claimed',
  'unclaimed',
  'transferred',
  'priority_changed',
  'status_changed',
  'closed',
  'reopened',
  'archived',
  'note_added',
  'summary_generated',
  'transcript_accessed',
  'sla_breached',
]);

export const ticketEvents = pgTable(
  'ticket_events',
  {
    id: id(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    type: ticketEventType('type').notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index('ticket_events_ticket_idx').on(t.ticketId, t.createdAt)],
);
