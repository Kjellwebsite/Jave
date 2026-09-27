'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { isJaveError, newErrorId, tickets, ValidationError } from '@jave/core';
import type { ActionState } from '@/lib/action-state';
import { formEnum, formString } from '@/lib/form-data';
import { PRIORITY_LABELS } from '@/lib/ticket-view';
import { runAction } from '@/server/actions';
import type { UserContext } from '@/server/context';
import { bulkOutcome, parseTicketIds, type BulkResult } from '@/server/tickets/bulk';

/** Open a ticket as yourself; the bot provisions the private thread. */
export async function openTicketAction(_: ActionState, data: FormData): Promise<ActionState> {
  let ticketId: string | null = null;
  const state = await runAction(
    'ticket.open',
    async (ctx) => {
      const category = formEnum(data, 'category', tickets.TICKET_CATEGORIES);
      if (!category) {
        throw new ValidationError('Choose a category.', [
          { path: 'category', message: 'Choose a category.' },
        ]);
      }
      const ticket = await tickets.openTicket(ctx, {
        category,
        priority: formEnum(data, 'priority', tickets.TICKET_PRIORITIES) ?? 'normal',
        subject: formString(data, 'subject'),
        body: formString(data, 'body'),
      });
      ticketId = ticket.id;
      revalidatePath('/tickets');
      return `TICKET OPENED — ${ticket.reference}.`;
    },
    { fieldNames: ['category', 'priority', 'subject', 'body'] },
  );
  if (state.status === 'success' && ticketId) redirect(`/tickets/${ticketId}`);
  return state;
}

/**
 * Apply one core action to each selected ticket, one transaction per ticket,
 * as the signed-in user. Partial success is reported per ticket; nothing is
 * rolled back because another ticket was refused.
 */
async function applyToEach(
  ctx: UserContext,
  action: string,
  ids: readonly string[],
  apply: (ticketId: string) => Promise<tickets.TicketSummary>,
): Promise<BulkResult[]> {
  const results: BulkResult[] = [];
  for (const ticketId of ids) {
    try {
      const ticket = await apply(ticketId);
      results.push({ ok: true, reference: ticket.reference });
    } catch (error) {
      if (isJaveError(error)) {
        results.push({ ok: false, message: error.userMessage });
        continue;
      }
      const reference = newErrorId();
      ctx.logger.error({ err: error, reference, action, ticketId }, 'bulk ticket action failed');
      results.push({ ok: false, message: `Unexpected error (${reference}).` });
    }
  }
  revalidatePath('/tickets');
  return results;
}

async function runBulk(
  action: string,
  verb: string,
  data: FormData,
  apply: (ctx: UserContext, ticketId: string) => Promise<tickets.TicketSummary>,
): Promise<ActionState> {
  return runAction(action, async (ctx) => {
    const ids = parseTicketIds(formString(data, 'ticketIds'));
    const results = await applyToEach(ctx, action, ids, (ticketId) => apply(ctx, ticketId));
    const outcome = bulkOutcome(verb, results);
    if (!outcome.ok) throw new ValidationError(outcome.message);
    return outcome.message;
  });
}

export async function bulkClaimAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runBulk('ticket.bulk_claim', 'CLAIMED', data, (ctx, ticketId) =>
    tickets.claimTicket(ctx, { ticketId }),
  );
}

export async function bulkPriorityAction(_: ActionState, data: FormData): Promise<ActionState> {
  const priority = formEnum(data, 'priority', tickets.TICKET_PRIORITIES);
  if (!priority) {
    return {
      status: 'error',
      message: 'Choose a priority.',
      fieldErrors: { priority: 'Choose a priority.' },
      at: Date.now(),
    };
  }
  return runBulk(
    'ticket.bulk_priority',
    `SET TO ${PRIORITY_LABELS[priority].toUpperCase()}`,
    data,
    (ctx, ticketId) => tickets.setPriority(ctx, { ticketId, priority }),
  );
}

export async function bulkCloseAction(_: ActionState, data: FormData): Promise<ActionState> {
  const reason = formString(data, 'reason');
  return runBulk('ticket.bulk_close', 'CLOSED', data, (ctx, ticketId) =>
    tickets.closeTicket(ctx, { ticketId, reason }),
  );
}
