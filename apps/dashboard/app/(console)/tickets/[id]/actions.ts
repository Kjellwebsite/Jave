'use server';

import { revalidatePath } from 'next/cache';
import { ai, DisabledError, isUuid, tickets, ValidationError } from '@jave/core';
import type { ActionState } from '@/lib/action-state';
import { formEnum, formOptional, formString } from '@/lib/form-data';
import { PRIORITY_LABELS } from '@/lib/ticket-view';
import { runAction } from '@/server/actions';
import { getTicketAi } from '@/server/tickets/ai';

/**
 * Ticket mutations from the dashboard. Each one is a thin envelope around a
 * core service called as the signed-in user: the service authorizes, audits
 * and enqueues the Discord side effects (the bot's worker runs them).
 */

const REASON_FIELDS = ['reason'] as const;

function ticketIdOf(data: FormData): string {
  const ticketId = formString(data, 'ticketId');
  if (!isUuid(ticketId)) throw new ValidationError('Unknown ticket.');
  return ticketId;
}

function refresh(ticketId: string): void {
  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath('/tickets');
}

export async function claimTicketAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction('ticket.claim', async (ctx) => {
    const ticket = await tickets.claimTicket(ctx, { ticketId: ticketIdOf(data) });
    refresh(ticket.id);
    return `TICKET CLAIMED — ${ticket.reference}. The requester is notified.`;
  });
}

export async function unclaimTicketAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction('ticket.unclaim', async (ctx) => {
    const ticket = await tickets.unclaimTicket(ctx, { ticketId: ticketIdOf(data) });
    refresh(ticket.id);
    return `TICKET RELEASED — ${ticket.reference}. Back in the queue, unassigned.`;
  });
}

export async function transferTicketAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction(
    'ticket.transfer',
    async (ctx) => {
      const toUserId = formString(data, 'toUserId');
      if (!isUuid(toUserId)) {
        throw new ValidationError('Choose a handler.', [
          { path: 'toUserId', message: 'Choose a handler.' },
        ]);
      }
      const ticket = await tickets.transferTicket(ctx, {
        ticketId: ticketIdOf(data),
        toUserId,
        reason: formOptional(data, 'reason'),
      });
      refresh(ticket.id);
      return `TICKET TRANSFERRED — ${ticket.reference} — ${ticket.assignee?.displayName ?? 'new handler'}.`;
    },
    { fieldNames: ['toUserId', 'reason'] },
  );
}

export async function setPriorityAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction(
    'ticket.set_priority',
    async (ctx) => {
      const priority = formEnum(data, 'priority', tickets.TICKET_PRIORITIES);
      if (!priority) {
        throw new ValidationError('Choose a priority.', [
          { path: 'priority', message: 'Choose a priority.' },
        ]);
      }
      const ticket = await tickets.setPriority(ctx, { ticketId: ticketIdOf(data), priority });
      refresh(ticket.id);
      return `PRIORITY SET — ${ticket.reference} — ${PRIORITY_LABELS[ticket.priority].toUpperCase()}.`;
    },
    { fieldNames: ['priority'] },
  );
}

export async function setWaitingAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction(
    'ticket.set_waiting',
    async (ctx) => {
      const ticket = await tickets.setWaiting(ctx, {
        ticketId: ticketIdOf(data),
        reason: formString(data, 'reason'),
      });
      refresh(ticket.id);
      return `WAITING ON REQUESTER — ${ticket.reference}. Their next reply resumes it.`;
    },
    { fieldNames: REASON_FIELDS },
  );
}

export async function resumeTicketAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction('ticket.resume', async (ctx) => {
    const ticket = await tickets.resumeTicket(ctx, { ticketId: ticketIdOf(data) });
    refresh(ticket.id);
    return `TICKET RESUMED — ${ticket.reference}.`;
  });
}

export async function closeTicketAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction(
    'ticket.close',
    async (ctx) => {
      const ticket = await tickets.closeTicket(ctx, {
        ticketId: ticketIdOf(data),
        reason: formString(data, 'reason'),
      });
      refresh(ticket.id);
      return `TICKET CLOSED — ${ticket.reference}. The thread is locked and archived.`;
    },
    { fieldNames: REASON_FIELDS },
  );
}

export async function reopenTicketAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction(
    'ticket.reopen',
    async (ctx) => {
      const ticket = await tickets.reopenTicket(ctx, {
        ticketId: ticketIdOf(data),
        reason: formString(data, 'reason'),
      });
      refresh(ticket.id);
      return `TICKET REOPENED — ${ticket.reference}. The thread is open again.`;
    },
    { fieldNames: REASON_FIELDS },
  );
}

export async function archiveTicketAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction('ticket.archive', async (ctx) => {
    const ticket = await tickets.archiveTicket(ctx, { ticketId: ticketIdOf(data) });
    refresh(ticket.id);
    return `TICKET ARCHIVED — ${ticket.reference}. It is now read-only.`;
  });
}

export async function addNoteAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction(
    'ticket.add_note',
    async (ctx) => {
      const ticketId = ticketIdOf(data);
      await tickets.addInternalNote(ctx, { ticketId, body: formString(data, 'body') });
      refresh(ticketId);
      return 'INTERNAL NOTE ADDED — staff only, never posted to the thread.';
    },
    { fieldNames: ['body'] },
  );
}

/**
 * AI summary through the tickets extension point. DISABLED unless this
 * deployment configures an AI provider; never a fabricated summary.
 */
export async function summarizeTicketAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction('ticket.summarize', async (ctx) => {
    const ticketId = ticketIdOf(data);
    const { deps } = getTicketAi();
    if (!deps) throw new DisabledError('JAVE AI');
    // Reuses the stored summary while no message was added, edited or deleted.
    const summary = await tickets.summarizeTicket(
      ctx,
      ticketId,
      ai.ticketSummarizer(ctx, deps, 'dashboard'),
    );
    refresh(ticketId);
    return summary.cached
      ? 'SUMMARY CURRENT — no messages since it was generated.'
      : 'SUMMARY GENERATED — AI-generated and unverified. Check the conversation before acting.';
  });
}
