import { and, count, eq, inArray } from 'drizzle-orm';
import { tickets, users } from '@jave/database';
import { recordAudit } from '../audit/audit.service';
import { type ServiceContext, withTransaction } from '../kernel/context';
import {
  ConflictError,
  ForbiddenError,
  InvalidStateError,
  NotFoundError,
  UnauthenticatedError,
} from '../kernel/errors';
import type { UserActor } from '../permissions/actor';
import { can } from '../permissions/authorize';
import type { Capability } from '../permissions/capabilities';
import { ACTIVE_STATUSES, ticketReference } from './constants';

export type TicketRecord = typeof tickets.$inferSelect;

/** How the current actor relates to a ticket. */
export type TicketViewer = 'requester' | 'handler';

/** Handler rights: managers act on any ticket; handlers on unassigned tickets or their own. */
export type HandlerAccess = 'manager' | 'handler';

// ─── Denials ─────────────────────────────────────────────────────────────────

interface DenialRecord {
  ticketId: string | null;
  context: Record<string, unknown>;
}

/**
 * Object-level denial reported as "not found", so a caller cannot probe
 * which ticket IDs exist (IDOR hardening). Carries its audit record.
 */
export class TicketHiddenError extends NotFoundError {
  readonly denial: DenialRecord;
  constructor(denial: DenialRecord) {
    super('Ticket');
    this.denial = denial;
  }
}

/** The actor can see the ticket but may not perform this action on it. */
export class TicketForbiddenError extends ForbiddenError {
  readonly denial: DenialRecord;
  constructor(message: string, denial: DenialRecord) {
    super(message);
    this.denial = denial;
  }
}

function denialOf(error: unknown): DenialRecord | null {
  return error instanceof TicketHiddenError || error instanceof TicketForbiddenError
    ? error.denial
    : null;
}

/**
 * Run a ticket operation and audit any denial durably *after* it unwound.
 * Denials raised inside a transaction are written once the transaction has
 * rolled back — never from inside it (a second connection would be needed
 * while the transaction holds its locks).
 */
export async function auditingDenials<T>(ctx: ServiceContext, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const denial = denialOf(error);
    if (denial) {
      await recordAudit(
        ctx,
        {
          action: 'access.denied',
          targetType: 'ticket',
          targetId: denial.ticketId,
          context: denial.context,
          result: 'denied',
        },
        { durable: true },
      ).catch((auditError: unknown) =>
        ctx.logger.error({ err: auditError }, 'failed to audit ticket denial'),
      );
    }
    throw error;
  }
}

/** withTransaction + durable denial audit after rollback. */
export function ticketTransaction<T>(
  ctx: ServiceContext,
  fn: (tx: ServiceContext) => Promise<T>,
): Promise<T> {
  return auditingDenials(ctx, () => withTransaction(ctx, fn));
}

export function hideTicket(ctx: ServiceContext, ticketId: string, capability: Capability): never {
  if (ctx.actor.kind === 'anonymous') throw new UnauthenticatedError();
  throw new TicketHiddenError({ ticketId, context: { capability, rule: 'not_opener_or_handler' } });
}

export function forbidTicket(ticketId: string, rule: string, message: string): never {
  throw new TicketForbiddenError(message, { ticketId, context: { rule } });
}

// ─── Loading ─────────────────────────────────────────────────────────────────

export async function loadTicket(
  ctx: ServiceContext,
  ticketId: string,
  options: { forUpdate?: boolean } = {},
): Promise<TicketRecord> {
  const query = ctx.db.select().from(tickets).where(eq(tickets.id, ticketId));
  const [row] = options.forUpdate ? await query.for('update') : await query;
  if (!row) throw new NotFoundError('Ticket');
  return row;
}

export function isOpener(ctx: ServiceContext, ticket: TicketRecord): boolean {
  return ctx.actor.kind === 'user' && ctx.actor.userId === ticket.openerUserId;
}

export function isAssignee(ctx: ServiceContext, ticket: TicketRecord): boolean {
  return ctx.actor.kind === 'user' && ctx.actor.userId === ticket.assigneeUserId;
}

export function isActive(ticket: TicketRecord): boolean {
  return ACTIVE_STATUSES.includes(ticket.status);
}

// ─── Rules ───────────────────────────────────────────────────────────────────

/**
 * Who may read a ticket: its opener (requester view) and ticket handlers.
 * The opener always gets the requester view of their own ticket, even when
 * they are staff — nobody handles, or reads staff notes on, their own case.
 */
export function requireViewer(ctx: ServiceContext, ticket: TicketRecord): TicketViewer {
  if (isOpener(ctx, ticket)) return 'requester';
  if (can(ctx, 'canHandleTickets')) return 'handler';
  return hideTicket(ctx, ticket.id, 'canHandleTickets');
}

/**
 * Handler actions on a specific ticket. Callers authorize `canHandleTickets`
 * first. `scope: 'assignment'` additionally limits plain handlers to tickets
 * that are unassigned or assigned to them.
 */
export function requireHandler(
  ctx: ServiceContext,
  ticket: TicketRecord,
  scope: 'any' | 'assignment',
): HandlerAccess {
  if (isOpener(ctx, ticket)) {
    return forbidTicket(ticket.id, 'own_ticket', 'You cannot handle your own ticket.');
  }
  if (can(ctx, 'canManageTickets')) return 'manager';
  if (!can(ctx, 'canHandleTickets')) return hideTicket(ctx, ticket.id, 'canHandleTickets');
  if (scope === 'assignment' && ticket.assigneeUserId && !isAssignee(ctx, ticket)) {
    return forbidTicket(
      ticket.id,
      'assigned_elsewhere',
      'This ticket is assigned to another handler. Ask them or a ticket manager.',
    );
  }
  return 'handler';
}

/** Opener or a handler within assignment scope (close, reopen). */
export function requireParticipant(
  ctx: ServiceContext,
  ticket: TicketRecord,
): 'requester' | HandlerAccess {
  if (isOpener(ctx, ticket)) return 'requester';
  if (!can(ctx, 'canHandleTickets')) return hideTicket(ctx, ticket.id, 'canHandleTickets');
  return requireHandler(ctx, ticket, 'assignment');
}

/**
 * Bot callbacks (thread messages, thread provisioning) are system-only: no
 * user, whatever their role, may forge a message or re-point a thread.
 * Called before any transaction opens, so the denial is audited directly.
 */
export async function requireSystemActor(ctx: ServiceContext, operation: string): Promise<void> {
  if (ctx.actor.kind === 'system') return;
  if (ctx.actor.kind === 'anonymous') throw new UnauthenticatedError();
  await auditingDenials(ctx, async () => {
    throw new TicketForbiddenError('Only JAVE itself can do that.', {
      ticketId: null,
      context: { rule: 'system_only', operation },
    });
  });
}

/** Quarantined and banned members cannot open or reopen tickets. */
export function assertRequesterStanding(actor: UserActor): void {
  if (actor.standing === 'quarantined' || actor.standing === 'banned') {
    throw new ForbiddenError('Tickets are unavailable while your account is restricted.');
  }
}

/**
 * Enforce settings.tickets.maxOpenPerUser. Locks the opener's user row first
 * so concurrent opens/reopens by the same person serialize (no double-spend).
 */
export async function assertBelowOpenLimit(
  ctx: ServiceContext,
  openerUserId: string,
  maxOpen: number,
): Promise<void> {
  await ctx.db.select({ id: users.id }).from(users).where(eq(users.id, openerUserId)).for('update');
  const [row] = await ctx.db
    .select({ value: count() })
    .from(tickets)
    .where(
      and(eq(tickets.openerUserId, openerUserId), inArray(tickets.status, [...ACTIVE_STATUSES])),
    );
  const open = row?.value ?? 0;
  if (open >= maxOpen) {
    throw new ConflictError(
      `You already have ${open} open ticket${open === 1 ? '' : 's'} (limit ${maxOpen}). Close one first.`,
    );
  }
}

export function assertActive(ticket: TicketRecord): void {
  if (!isActive(ticket)) {
    throw new InvalidStateError(`Ticket ${ticketReference(ticket.number)} is ${ticket.status}.`);
  }
}
