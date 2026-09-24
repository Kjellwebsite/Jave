import type { ticketCategory, ticketEventType, ticketPriority, ticketStatus } from '@jave/database';
import { HOUR, MINUTE } from '../kernel/clock';

export type TicketCategory = (typeof ticketCategory.enumValues)[number];
export type TicketPriority = (typeof ticketPriority.enumValues)[number];
export type TicketStatus = (typeof ticketStatus.enumValues)[number];
export type TicketEventType = (typeof ticketEventType.enumValues)[number];

export const TICKET_CATEGORIES: readonly TicketCategory[] = [
  'general',
  'application',
  'technical',
  'report',
  'partnership',
  'trial',
  'operations',
  'other',
];
export const TICKET_PRIORITIES: readonly TicketPriority[] = ['low', 'normal', 'high', 'urgent'];
export const TICKET_STATUSES: readonly TicketStatus[] = [
  'open',
  'claimed',
  'waiting',
  'closed',
  'archived',
];

/** Statuses in which a ticket is still being worked on. */
export const ACTIVE_STATUSES: readonly TicketStatus[] = ['open', 'claimed', 'waiting'];

/** Priorities that alert every ticket handler when a ticket is opened or escalated. */
export const ALERT_PRIORITIES: readonly TicketPriority[] = ['high', 'urgent'];

/** Ordinal used to detect escalations (a higher number is more urgent). */
export const PRIORITY_ORDINAL: Record<TicketPriority, number> = {
  low: 0,
  normal: 1,
  high: 2,
  urgent: 3,
};

// ─── Input limits ─────────────────────────────────────────────────────────────

export const SUBJECT_MIN_LENGTH = 3;
export const SUBJECT_MAX_LENGTH = 120;
export const BODY_MIN_LENGTH = 3;
export const BODY_MAX_LENGTH = 4000;
export const REASON_MIN_LENGTH = 3;
export const REASON_MAX_LENGTH = 500;
export const MAX_ATTACHMENTS_PER_MESSAGE = 10;
export const ATTACHMENT_NAME_MAX_LENGTH = 256;
export const ATTACHMENT_CONTENT_TYPE_MAX_LENGTH = 128;
export const URL_MAX_LENGTH = 2048;
/** Discord caps attachments far below this; anything larger is malformed input. */
export const ATTACHMENT_MAX_BYTES = 1024 * 1024 * 1024;
export const DISCORD_NAME_MAX_LENGTH = 64;
export const SEARCH_MAX_LENGTH = 64;

// ─── Views & transcripts ─────────────────────────────────────────────────────

/** Most recent messages returned by getTicket. */
export const VIEW_MESSAGE_LIMIT = 500;
/** Hard cap on messages rendered into one transcript. */
export const TRANSCRIPT_MESSAGE_LIMIT = 5000;
/** Excerpt of the opening message carried on the Discord card. */
export const CARD_EXCERPT_LENGTH = 1000;
/** Discord thread names are limited to 100 characters. */
export const THREAD_NAME_MAX_LENGTH = 100;

// ─── AI summary ──────────────────────────────────────────────────────────────

export const AI_SUMMARY_LABEL = 'AI-GENERATED';
export const AI_SUMMARY_MAX_LENGTH = 2000;
/** Messages considered when building a summary (most recent first, then re-ordered). */
export const AI_SUMMARY_MESSAGE_LIMIT = 200;

// ─── Background work ─────────────────────────────────────────────────────────

export const SLA_SWEEP_JOB = 'tickets.sla_sweep';
export const ARCHIVE_SWEEP_JOB = 'tickets.archive_sweep';
export const SLA_SWEEP_EVERY_MS = 5 * MINUTE;
export const ARCHIVE_SWEEP_EVERY_MS = HOUR;
/** Tickets processed per sweep run; the next run picks up the remainder. */
export const SWEEP_BATCH_SIZE = 200;

/** Window for the per-user open rate limit (count comes from settings.tickets.openRatePerHour). */
export const OPEN_RATE_WINDOW_SECONDS = 3600;

/** Default analytics window for ticket stats. */
export const STATS_DEFAULT_WINDOW_DAYS = 30;
export const STATS_MAX_WINDOW_DAYS = 366;

/** Dashboard path for ticket links in notifications (`${publicUrl}${path}/${ticketId}`). */
export const TICKET_DASHBOARD_PATH = '/tickets';

/**
 * Ticket-event types the requester may see. Everything else (internal notes,
 * transfers, priority triage, SLA, AI summaries, transcript access) is staff-only.
 */
export const REQUESTER_VISIBLE_EVENTS: readonly TicketEventType[] = [
  'created',
  'claimed',
  'status_changed',
  'closed',
  'reopened',
  'archived',
];

/** Human-facing ticket reference: #0042. */
export function ticketReference(number: number): string {
  return `#${String(number).padStart(4, '0')}`;
}
