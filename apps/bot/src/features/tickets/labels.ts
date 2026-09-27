import type { APISelectMenuOption } from 'discord.js';
import { tickets } from '@jave/core';
import { COLORS } from '../../ui/theme';

type TicketCategory = tickets.TicketCategory;
type TicketPriority = tickets.TicketPriority;
type TicketStatus = tickets.TicketStatus;
type SlaState = tickets.SlaState;

interface Described {
  label: string;
  description: string;
}

/** Category names and one-line guidance, as shown in the category select. */
export const CATEGORY_LABELS: Record<TicketCategory, Described> = {
  general: { label: 'GENERAL', description: 'Questions about JAVELIN or JAVE.' },
  application: { label: 'APPLICATION', description: 'Your application or its review.' },
  technical: { label: 'TECHNICAL', description: 'Bot, dashboard or account problems.' },
  report: {
    label: 'REPORT',
    description: 'Report a member or an incident. Handled by staff only.',
  },
  partnership: { label: 'PARTNERSHIP', description: 'Collaborations and sponsorship.' },
  trial: { label: 'TRIAL', description: 'Trials, results and evaluations.' },
  operations: { label: 'OPERATIONS', description: 'Events, projects and logistics.' },
  other: { label: 'OTHER', description: 'Anything else.' },
};

export const PRIORITY_LABELS: Record<TicketPriority, Described> = {
  low: { label: 'LOW', description: 'No time pressure.' },
  normal: { label: 'NORMAL', description: 'Standard response target.' },
  high: { label: 'HIGH', description: 'Time-sensitive. Staff are alerted.' },
  urgent: { label: 'URGENT', description: 'Safety or access emergencies. Staff are alerted.' },
};

export const STATUS_LABELS: Record<TicketStatus, string> = {
  open: 'OPEN',
  claimed: 'CLAIMED',
  waiting: 'WAITING ON REQUESTER',
  closed: 'CLOSED',
  archived: 'ARCHIVED',
};

export const STATUS_COLORS: Record<TicketStatus, number> = {
  open: COLORS.base,
  claimed: COLORS.info,
  waiting: COLORS.warning,
  closed: COLORS.steel,
  archived: COLORS.steel,
};

export const SLA_LABELS: Record<SlaState, string> = {
  pending: 'PENDING',
  met: 'MET',
  breached: 'MISSED',
  none: 'NO TARGET',
};

export function categoryOptions(): APISelectMenuOption[] {
  return tickets.TICKET_CATEGORIES.map((value) => ({
    value,
    label: CATEGORY_LABELS[value].label,
    description: CATEGORY_LABELS[value].description,
  }));
}

export function priorityOptions(selected?: TicketPriority): APISelectMenuOption[] {
  return tickets.TICKET_PRIORITIES.map((value) => ({
    value,
    label: PRIORITY_LABELS[value].label,
    description: PRIORITY_LABELS[value].description,
    default: value === selected,
  }));
}

export function isCategory(value: string | undefined): value is TicketCategory {
  return tickets.TICKET_CATEGORIES.some((category) => category === value);
}

export function isPriority(value: string | undefined): value is TicketPriority {
  return tickets.TICKET_PRIORITIES.some((priority) => priority === value);
}

export function isActiveStatus(status: TicketStatus): boolean {
  return tickets.ACTIVE_STATUSES.includes(status);
}
