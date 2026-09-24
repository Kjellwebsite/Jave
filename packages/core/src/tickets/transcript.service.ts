import { recordAudit } from '../audit/audit.service';
import type { ServiceContext } from '../kernel/context';
import { parseInput } from '../kernel/validation';
import { can } from '../permissions/authorize';
import {
  hideTicket,
  forbidTicket,
  isOpener,
  loadTicket,
  type TicketRecord,
  ticketTransaction,
} from './access';
import { TRANSCRIPT_MESSAGE_LIMIT, ticketReference } from './constants';
import { appendTicketEvent, userSummaries } from './records';
import { type TranscriptInput, transcriptSchema } from './schemas';
import {
  renderTranscriptDocument,
  type TranscriptFormat,
  type TranscriptModel,
} from './transcript';
import { aiSummaryOf, loadEvents, loadMessages, slaOf } from './views';

export interface RenderedTranscript {
  ticketId: string;
  filename: string;
  contentType: string;
  format: TranscriptFormat;
  includesInternal: boolean;
  messageCount: number;
  content: string;
}

const CONTENT_TYPES: Record<TranscriptFormat, string> = {
  html: 'text/html; charset=utf-8',
  markdown: 'text/markdown; charset=utf-8',
};
const EXTENSIONS: Record<TranscriptFormat, string> = { html: 'html', markdown: 'md' };

/**
 * Transcript access rules:
 * - the opener may export their own ticket, never with internal notes;
 * - ticket managers (canManageTickets) may export any ticket, optionally with
 *   internal notes, deleted messages and edit history;
 * - everyone else is refused (and cannot learn whether the ticket exists).
 */
function authorizeTranscript(
  ctx: ServiceContext,
  ticket: TicketRecord,
  includeInternal: boolean,
): void {
  if (isOpener(ctx, ticket)) {
    if (includeInternal) {
      forbidTicket(ticket.id, 'requester_internal_transcript', 'Internal notes are staff-only.');
    }
    return;
  }
  if (!can(ctx, 'canManageTickets')) hideTicket(ctx, ticket.id, 'canManageTickets');
}

/**
 * Render a ticket transcript as Markdown or self-contained HTML (escaped,
 * script-free, CSP-locked). Every access is audited
 * ('ticket.transcript_accessed') and recorded on the ticket timeline.
 */
export async function renderTranscript(
  ctx: ServiceContext,
  input: TranscriptInput,
): Promise<RenderedTranscript> {
  const data = parseInput(transcriptSchema, input);
  return ticketTransaction(ctx, async (tx) => {
    const ticket = await loadTicket(tx, data.ticketId);
    authorizeTranscript(tx, ticket, data.includeInternal);
    const full = data.includeInternal;
    const [people, { messages, truncated }, events] = await Promise.all([
      userSummaries(tx, [ticket.openerUserId, ticket.assigneeUserId]),
      loadMessages(tx, ticket.id, {
        includeInternal: full,
        includeDeleted: full,
        limit: TRANSCRIPT_MESSAGE_LIMIT,
      }),
      loadEvents(tx, ticket.id, full ? 'full' : 'requester'),
    ]);
    await appendTicketEvent(tx, ticket.id, 'transcript_accessed', {
      format: data.format,
      includeInternal: full,
    });
    await recordAudit(tx, {
      action: 'ticket.transcript_accessed',
      targetType: 'ticket',
      targetId: ticket.id,
      context: {
        number: ticket.number,
        format: data.format,
        includeInternal: full,
        messageCount: messages.length,
      },
    });
    const model: TranscriptModel = {
      reference: ticketReference(ticket.number),
      subject: ticket.subject,
      category: ticket.category,
      priority: ticket.priority,
      status: ticket.status,
      openedAt: ticket.createdAt,
      closedAt: ticket.closedAt,
      closeReason: ticket.closeReason,
      opener: people.get(ticket.openerUserId)?.displayName ?? null,
      assignee: ticket.assigneeUserId
        ? (people.get(ticket.assigneeUserId)?.displayName ?? null)
        : null,
      reopenCount: ticket.reopenCount,
      generatedAt: tx.clock.now(),
      includesInternal: full,
      sla: full ? slaOf(ticket, tx.clock.now()) : null,
      aiSummary: full ? aiSummaryOf(ticket) : null,
      messages: full ? messages : messages.map((m) => ({ ...m, originalBody: null })),
      events,
      truncated,
    };
    const suffix = full ? '-internal' : '';
    return {
      ticketId: ticket.id,
      filename: `ticket-${String(ticket.number).padStart(4, '0')}${suffix}.${EXTENSIONS[data.format]}`,
      contentType: CONTENT_TYPES[data.format],
      format: data.format,
      includesInternal: full,
      messageCount: messages.length,
      content: renderTranscriptDocument(model, data.format),
    };
  });
}
