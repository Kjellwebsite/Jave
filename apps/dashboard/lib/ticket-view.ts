import type { Capability, tickets } from '@jave/core';

/**
 * Client-safe ticket presentation: labels, tones, SLA readouts and which
 * controls to show. Visibility only — every action is authorized again by
 * the core service it calls.
 */

export type TicketStatus = tickets.TicketStatus;
export type TicketPriority = tickets.TicketPriority;
export type TicketCategory = tickets.TicketCategory;
export type SlaState = tickets.SlaState;
export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export const STATUS_LABELS: Record<TicketStatus, string> = {
  open: 'Open',
  claimed: 'Claimed',
  waiting: 'Waiting on requester',
  closed: 'Closed',
  archived: 'Archived',
};

export const STATUS_TONE: Record<TicketStatus, Tone> = {
  open: 'info',
  claimed: 'success',
  waiting: 'warning',
  closed: 'neutral',
  archived: 'neutral',
};

/** The expected, settled states read quietly so the ones that need a person stand out. */
export const STATUS_QUIET: Record<TicketStatus, boolean> = {
  open: false,
  claimed: true,
  waiting: false,
  closed: true,
  archived: true,
};

export const PRIORITY_LABELS: Record<TicketPriority, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  urgent: 'Urgent',
};

/** Only escalated priorities carry colour. */
export const PRIORITY_TONE: Record<TicketPriority, Tone> = {
  low: 'neutral',
  normal: 'neutral',
  high: 'warning',
  urgent: 'danger',
};

export const CATEGORY_LABELS: Record<TicketCategory, string> = {
  general: 'General',
  application: 'Application',
  technical: 'Technical',
  report: 'Report',
  partnership: 'Partnership',
  trial: 'Trial',
  operations: 'Operations',
  other: 'Other',
};

export const CATEGORY_HINTS: Record<TicketCategory, string> = {
  general: 'Questions about JAVELIN or JAVE.',
  application: 'Your application or its review.',
  technical: 'Bot, dashboard or account problems.',
  report: 'Report a member or an incident. Staff only.',
  partnership: 'Collaborations and sponsorship.',
  trial: 'Trials, results and evaluations.',
  operations: 'Events, projects and logistics.',
  other: 'Anything else.',
};

export const AUTHOR_ROLE_LABELS: Record<tickets.TicketAuthorRole, string> = {
  requester: 'Requester',
  handler: 'Staff',
  participant: 'Participant',
};

/** Tickets one bulk action may touch: one queue page. */
export const BULK_LIMIT = 25;

export function optionsOf<K extends string>(labels: Record<K, string>) {
  return (Object.keys(labels) as K[]).map((value) => ({ value, label: labels[value] }));
}

export function isActiveStatus(status: TicketStatus): boolean {
  return status === 'open' || status === 'claimed' || status === 'waiting';
}

// ─── Durations & SLA ─────────────────────────────────────────────────────────

const MINUTE_MS = 60_000;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;

/** `<1m` · `42m` · `3h 12m` · `2d 4h` — compact and exact enough for a queue. */
export function formatDuration(ms: number): string {
  const minutes = Math.floor(Math.abs(ms) / MINUTE_MS);
  if (minutes < 1) return '<1m';
  if (minutes < MINUTES_PER_HOUR) return `${minutes}m`;
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  if (hours < HOURS_PER_DAY) {
    const rest = minutes % MINUTES_PER_HOUR;
    return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
  }
  const days = Math.floor(hours / HOURS_PER_DAY);
  const restHours = hours % HOURS_PER_DAY;
  return restHours === 0 ? `${days}d` : `${days}d ${restHours}h`;
}

/** Minutes (possibly fractional, as core reports them) → `14m`, `3h 2m`. */
export function formatMinutes(minutes: number): string {
  return formatDuration(minutes * MINUTE_MS);
}

const BYTES_PER_KB = 1024;
const BYTE_UNITS = ['B', 'KB', 'MB', 'GB'] as const;

/** `512 B` · `2.0 KB` · `1.4 MB` for attachment sizes. */
export function formatBytes(bytes: number): string {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= BYTES_PER_KB && unit < BYTE_UNITS.length - 1) {
    value /= BYTES_PER_KB;
    unit += 1;
  }
  return unit === 0 ? `${Math.round(value)} B` : `${value.toFixed(1)} ${BYTE_UNITS[unit]}`;
}

/** The last quarter of the response window reads as a warning. */
export const SLA_WARNING_FRACTION = 0.25;

export interface SlaInput {
  state: SlaState;
  dueAt: Date | null;
  firstResponseMinutes: number | null;
}

export interface SlaReadout {
  label: string;
  tone: Tone;
  /** A live countdown: re-render as time passes. */
  ticking: boolean;
}

/**
 * The first-response target as a calm readout. Derived from core's stored
 * outcome (`state`); the countdown only describes time left, it never
 * decides a breach.
 */
export function slaReadout(
  sla: SlaInput,
  ticket: { createdAt: Date; status: TicketStatus },
  now: Date,
): SlaReadout {
  switch (sla.state) {
    case 'none':
      return { label: 'No target', tone: 'neutral', ticking: false };
    case 'met':
      return {
        label:
          sla.firstResponseMinutes === null
            ? 'Met'
            : `Met in ${formatMinutes(sla.firstResponseMinutes)}`,
        tone: 'success',
        ticking: false,
      };
    case 'breached':
      return { label: 'Missed', tone: 'danger', ticking: false };
    case 'pending': {
      if (!isActiveStatus(ticket.status) || !sla.dueAt) {
        return { label: 'Not answered', tone: 'neutral', ticking: false };
      }
      const remaining = sla.dueAt.getTime() - now.getTime();
      if (remaining < 0) {
        return { label: `Overdue ${formatDuration(remaining)}`, tone: 'danger', ticking: true };
      }
      const window = sla.dueAt.getTime() - ticket.createdAt.getTime();
      const late = window > 0 && remaining <= window * SLA_WARNING_FRACTION;
      return {
        label: `Due in ${formatDuration(remaining)}`,
        tone: late ? 'warning' : 'neutral',
        ticking: true,
      };
    }
  }
}

// ─── Controls ────────────────────────────────────────────────────────────────

export interface TicketActionInput {
  viewer: 'requester' | 'handler';
  status: TicketStatus;
  assignee: { userId: string } | null;
}

export interface TicketActionViewer {
  userId: string;
  capabilities: readonly Capability[];
}

export interface TicketControls {
  claim: boolean;
  unclaim: boolean;
  transfer: boolean;
  priority: boolean;
  waiting: boolean;
  resume: boolean;
  close: boolean;
  reopen: boolean;
  archive: boolean;
  note: boolean;
  summary: boolean;
  transcript: boolean;
  transcriptInternal: boolean;
}

/**
 * Which ticket controls to show. Mirrors the access table in
 * docs/modules/tickets.md so nobody is offered a button that always fails;
 * the services remain the authority.
 */
export function ticketControls(
  ticket: TicketActionInput,
  viewer: TicketActionViewer,
): TicketControls {
  const requester = ticket.viewer === 'requester';
  const handler = ticket.viewer === 'handler';
  const manager = handler && viewer.capabilities.includes('canManageTickets');
  const active = isActiveStatus(ticket.status);
  const mine = ticket.assignee?.userId === viewer.userId;
  const inScope = manager || !ticket.assignee || mine;
  const participant = requester || (handler && inScope);
  return {
    claim: handler && active && !ticket.assignee,
    unclaim: handler && active && ticket.assignee !== null && (mine || manager),
    transfer: handler && active && (mine || manager),
    priority: handler && active && inScope,
    waiting: handler && inScope && (ticket.status === 'open' || ticket.status === 'claimed'),
    resume: handler && inScope && ticket.status === 'waiting',
    close: active && participant,
    reopen: ticket.status === 'closed' && participant,
    archive: manager && ticket.status === 'closed',
    note: handler && ticket.status !== 'archived',
    summary: handler && ticket.status !== 'archived',
    transcript: requester || manager,
    transcriptInternal: manager,
  };
}
