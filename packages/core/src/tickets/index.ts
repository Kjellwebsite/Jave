import type { EventSubscriber } from '../events/bus';
import type { JobHandlerMap, RecurringJob } from '../jobs/worker';
import { sweepJobHandlers, sweepRecurringJobs } from './sweeps';

// Module: tickets — premium support tickets living in private Discord threads.
// See docs/modules/tickets.md for state machine, capabilities and Discord contracts.

export {
  ACTIVE_STATUSES,
  AI_SUMMARY_LABEL,
  ARCHIVE_SWEEP_JOB,
  SLA_SWEEP_JOB,
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  ticketReference,
  type TicketCategory,
  type TicketPriority,
  type TicketStatus,
  type TicketEventType,
} from './constants';
export { TicketForbiddenError, TicketHiddenError, type TicketViewer } from './access';
export {
  CARD_CHANGES,
  CLOSE_THREAD_JOB,
  closeThreadPayloadSchema,
  OPEN_THREAD_JOB,
  openThreadPayloadSchema,
  parseTicketDiscordJobPayload,
  REOPEN_THREAD_JOB,
  reopenThreadPayloadSchema,
  TICKET_DISCORD_JOB_MAX_ATTEMPTS,
  TICKET_DISCORD_JOBS,
  UPDATE_CARD_JOB,
  updateCardPayloadSchema,
  type CardChange,
  type TicketDiscordJobPayload,
  type TicketDiscordJobType,
} from './discord-jobs';
export {
  attachmentSchema,
  listTicketsSchema,
  openTicketSchema,
  recordMessageSchema,
  transcriptSchema,
  type ListTicketsInput,
  type OpenTicketInput,
  type RecordMessageInput,
  type TranscriptInput,
} from './schemas';
export type { SlaState } from './sla';
export type {
  TicketAiSummary,
  TicketAuthorRole,
  TicketEventView,
  TicketMessageView,
  TicketSla,
  TicketSummary,
  TicketView,
} from './views';

// Services
export { archiveTicket, closeTicket, openTicket, reopenTicket } from './lifecycle.service';
export {
  claimTicket,
  resumeTicket,
  setPriority,
  setWaiting,
  transferTicket,
  unclaimTicket,
} from './assignment.service';
export {
  addInternalNote,
  recordMessage,
  recordMessageDelete,
  recordMessageEdit,
  type IgnoreReason,
  type RecordMessageResult,
  type RecordOutcome,
} from './messages.service';
export {
  getTicketCard,
  getTicketIdForThread,
  markThreadCreated,
  markThreadMissing,
  type TicketCard,
  type ThreadCallbackResult,
} from './thread.service';
export { getTicket, getTicketStats, listTickets, type TicketStats } from './queries.service';
export { renderTranscript, type RenderedTranscript } from './transcript.service';
export {
  summarizeTicket,
  TICKET_SUMMARY_INSTRUCTIONS,
  type TicketSummarizer,
  type TicketSummaryInput,
  type TicketSummaryResult,
} from './summary.service';
export { runArchiveSweep, runSlaSweep } from './sweeps';

/** Job handlers owned by this module (non-Discord). */
export const jobHandlers: JobHandlerMap = sweepJobHandlers;
/** Domain event subscribers owned by this module. */
export const subscribers: readonly EventSubscriber[] = [];
/** Periodic work owned by this module. */
export const recurringJobs: readonly RecurringJob[] = sweepRecurringJobs;
