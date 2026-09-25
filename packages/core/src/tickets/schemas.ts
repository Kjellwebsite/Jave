import { z } from 'zod';
import { DAY } from '../kernel/clock';
import { pageSchema } from '../kernel/pagination';
import {
  ATTACHMENT_CONTENT_TYPE_MAX_LENGTH,
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_NAME_MAX_LENGTH,
  BODY_MAX_LENGTH,
  BODY_MIN_LENGTH,
  DISCORD_NAME_MAX_LENGTH,
  MAX_ATTACHMENTS_PER_MESSAGE,
  REASON_MAX_LENGTH,
  REASON_MIN_LENGTH,
  SEARCH_MAX_LENGTH,
  STATS_MAX_WINDOW_DAYS,
  SUBJECT_MAX_LENGTH,
  SUBJECT_MIN_LENGTH,
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  type TicketCategory,
  type TicketPriority,
  type TicketStatus,
  URL_MAX_LENGTH,
} from './constants';

/**
 * Raw input may be at most this many times the stored limit before
 * normalization; bounds the work done on hostile, oversized strings.
 */
const RAW_INPUT_FACTOR = 2;

// C0 controls except TAB (\x09), LF (\x0A) and CR (\x0D), plus DEL. NUL cannot be stored in Postgres text.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const WHITESPACE_RUN = /\s+/g;

/** Multi-line free text: strip control characters, normalize newlines, trim. */
export function cleanMultiline(value: string): string {
  return value.replace(/\r\n?/g, '\n').replace(CONTROL_CHARS, '').trim();
}

/** Single-line text: strip control characters and collapse all whitespace. */
export function cleanSingleLine(value: string): string {
  return value.replace(CONTROL_CHARS, '').replace(WHITESPACE_RUN, ' ').trim();
}

function multiline(min: number, max: number) {
  return z
    .string()
    .max(max * RAW_INPUT_FACTOR)
    .transform(cleanMultiline)
    .pipe(z.string().min(min).max(max));
}

function singleLine(min: number, max: number) {
  return z
    .string()
    .max(max * RAW_INPUT_FACTOR)
    .transform(cleanSingleLine)
    .pipe(z.string().min(min).max(max));
}

const snowflake = z.string().regex(/^\d{17,20}$/, 'must be a Discord ID');
const ticketId = z.uuid();
const reason = singleLine(REASON_MIN_LENGTH, REASON_MAX_LENGTH);
const categorySchema = z.enum(TICKET_CATEGORIES as [TicketCategory, ...TicketCategory[]]);
const prioritySchema = z.enum(TICKET_PRIORITIES as [TicketPriority, ...TicketPriority[]]);
const statusSchema = z.enum(TICKET_STATUSES as [TicketStatus, ...TicketStatus[]]);

/** Only http(s) links are ever stored (Discord CDN attachment URLs). */
export const httpUrlSchema = z
  .string()
  .trim()
  .max(URL_MAX_LENGTH)
  .pipe(z.url({ protocol: /^https?$/ }));

export const attachmentSchema = z.object({
  name: singleLine(1, ATTACHMENT_NAME_MAX_LENGTH),
  url: httpUrlSchema,
  size: z.number().int().min(0).max(ATTACHMENT_MAX_BYTES),
  contentType: z
    .string()
    .trim()
    .max(ATTACHMENT_CONTENT_TYPE_MAX_LENGTH)
    .regex(/^[\w.+-]+\/[\w.+-]+(;.*)?$/, 'must be a MIME type')
    .nullish(),
});

export const openTicketSchema = z.object({
  category: categorySchema,
  priority: prioritySchema.default('normal'),
  subject: singleLine(SUBJECT_MIN_LENGTH, SUBJECT_MAX_LENGTH),
  body: multiline(BODY_MIN_LENGTH, BODY_MAX_LENGTH),
});

export const ticketRefSchema = z.object({ ticketId });

export const transferTicketSchema = z.object({
  ticketId,
  toUserId: z.uuid(),
  reason: reason.optional(),
});

export const setPrioritySchema = z.object({ ticketId, priority: prioritySchema });

export const reasonedActionSchema = z.object({ ticketId, reason });

export const internalNoteSchema = z.object({
  ticketId,
  body: multiline(1, BODY_MAX_LENGTH),
});

const discordAuthorSchema = z.object({
  discordId: snowflake,
  username: singleLine(1, DISCORD_NAME_MAX_LENGTH),
  displayName: singleLine(1, DISCORD_NAME_MAX_LENGTH).nullish(),
  avatarHash: z
    .string()
    .regex(/^(a_)?[0-9a-f]{32}$/i)
    .nullish(),
  bot: z.boolean().default(false),
});

/**
 * A message the bot observed in a ticket thread. The body may be empty when
 * the message carries only attachments; the refine below enforces one of them.
 */
export const recordMessageSchema = z
  .object({
    threadId: snowflake,
    discordMessageId: snowflake,
    author: discordAuthorSchema,
    body: z
      .string()
      .max(BODY_MAX_LENGTH * RAW_INPUT_FACTOR)
      .transform(cleanMultiline)
      .pipe(z.string().max(BODY_MAX_LENGTH)),
    attachments: z.array(attachmentSchema).max(MAX_ATTACHMENTS_PER_MESSAGE).default([]),
    sentAt: z.coerce.date().optional(),
  })
  .refine((m) => m.body.length > 0 || m.attachments.length > 0, {
    message: 'A message needs text or an attachment.',
    path: ['body'],
  });

export const recordMessageEditSchema = z.object({
  discordMessageId: snowflake,
  body: z
    .string()
    .max(BODY_MAX_LENGTH * RAW_INPUT_FACTOR)
    .transform(cleanMultiline)
    .pipe(z.string().max(BODY_MAX_LENGTH)),
  editedAt: z.coerce.date().optional(),
});

export const recordMessageDeleteSchema = z.object({
  discordMessageId: snowflake,
  deletedAt: z.coerce.date().optional(),
});

export const markThreadCreatedSchema = z.object({
  ticketId,
  threadId: snowflake,
  cardMessageId: snowflake.optional(),
});

export const markThreadMissingSchema = z.object({ ticketId, threadId: snowflake });

export const threadLookupSchema = z.object({ threadId: snowflake });

export const transcriptSchema = z.object({
  ticketId,
  format: z.enum(['markdown', 'html']).default('html'),
  includeInternal: z.boolean().default(false),
});

export const listTicketsSchema = pageSchema.extend({
  /** Handlers: only tickets they opened themselves. Requesters always see only their own. */
  mine: z.boolean().default(false),
  status: z.array(statusSchema).min(1).max(TICKET_STATUSES.length).optional(),
  category: categorySchema.optional(),
  priority: prioritySchema.optional(),
  /** 'me', 'none' (unassigned) or a user id. Handler-only. */
  assignee: z.union([z.literal('me'), z.literal('none'), z.uuid()]).optional(),
  /** Handler-only: only tickets that missed (true) or have not missed (false) their SLA. */
  breached: z.boolean().optional(),
  /** Handler-only. */
  openerUserId: z.uuid().optional(),
  search: singleLine(1, SEARCH_MAX_LENGTH).optional(),
  sort: z.enum(['newest', 'oldest', 'activity', 'sla']).default('newest'),
});

export const ticketStatsSchema = z
  .object({
    since: z.coerce.date().optional(),
    until: z.coerce.date().optional(),
  })
  .refine((w) => !w.since || !w.until || w.since.getTime() < w.until.getTime(), {
    message: 'since must be before until',
    path: ['since'],
  })
  .refine(
    (w) =>
      !w.since || !w.until || w.until.getTime() - w.since.getTime() <= STATS_MAX_WINDOW_DAYS * DAY,
    { message: `window must be at most ${STATS_MAX_WINDOW_DAYS} days`, path: ['until'] },
  );

export type OpenTicketInput = z.input<typeof openTicketSchema>;
export type RecordMessageInput = z.input<typeof recordMessageSchema>;
export type ListTicketsInput = z.input<typeof listTicketsSchema>;
export type TranscriptInput = z.input<typeof transcriptSchema>;
