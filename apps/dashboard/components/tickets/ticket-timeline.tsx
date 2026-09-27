import type { tickets } from '@jave/core';
import { Timeline, type TimelineItem, type TimelineTone } from '@jave/ui';
import {
  CATEGORY_LABELS,
  PRIORITY_LABELS,
  type TicketCategory,
  type TicketPriority,
} from '@/lib/ticket-view';
import { formatTimestamp } from '@/lib/time';

type TicketEvent = tickets.TicketEventView;

interface Described {
  title: string;
  description?: string;
  tone?: TimelineTone;
}

function text(data: Record<string, unknown>, key: string): string | null {
  const value = data[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function priorityLabel(value: string | null): string {
  return value && value in PRIORITY_LABELS
    ? PRIORITY_LABELS[value as TicketPriority].toUpperCase()
    : '—';
}

/**
 * One timeline entry per ticket event. Event data is JSON written by core;
 * every field is narrowed here and rendered as text, never as markup.
 */
function describe(event: TicketEvent, names: ReadonlyMap<string, string>): Described {
  const data = event.data;
  const reason = text(data, 'reason') ?? undefined;
  switch (event.type) {
    case 'created': {
      const category = text(data, 'category');
      const label =
        category && category in CATEGORY_LABELS
          ? CATEGORY_LABELS[category as TicketCategory]
          : 'Ticket';
      return {
        title: 'Opened',
        description: `${label} · ${priorityLabel(text(data, 'priority'))} priority`,
        tone: 'info',
      };
    }
    case 'claimed':
      return { title: 'Claimed', tone: 'success' };
    case 'unclaimed':
      return {
        title: 'Released',
        description:
          text(data, 'trigger') === 'reopen_without_handler_rights'
            ? 'The former handler no longer handles tickets.'
            : undefined,
      };
    case 'transferred': {
      const target = text(data, 'toUserId');
      return {
        title: `Transferred to ${(target && names.get(target)) ?? 'another handler'}`,
        description: reason,
        tone: 'success',
      };
    }
    case 'priority_changed':
      return {
        title: `Priority ${priorityLabel(text(data, 'from'))} → ${priorityLabel(text(data, 'to'))}`,
      };
    case 'status_changed': {
      if (text(data, 'to') === 'waiting') {
        return { title: 'Waiting on requester', description: reason, tone: 'warning' };
      }
      return {
        title: 'Resumed',
        description:
          text(data, 'trigger') === 'requester_replied' ? 'The requester replied.' : undefined,
      };
    }
    case 'closed':
      return { title: 'Closed', description: reason };
    case 'reopened':
      return { title: 'Reopened', description: reason, tone: 'info' };
    case 'archived':
      return {
        title: data.automatic === true ? 'Archived automatically' : 'Archived',
        description: 'Read-only from here on.',
      };
    case 'note_added':
      return { title: 'Internal note added' };
    case 'summary_generated':
      return { title: 'AI summary generated' };
    case 'transcript_accessed': {
      const format = text(data, 'format') === 'markdown' ? 'Markdown' : 'HTML';
      return {
        title: `Transcript exported · ${format}`,
        description: data.includeInternal === true ? 'Including internal notes.' : undefined,
      };
    }
    case 'sla_breached':
      return { title: 'First-response target missed', tone: 'danger' };
    case 'sla_breach_retracted':
      return {
        title: 'Missed target withdrawn',
        description: 'The first reply was on time; it was recorded late.',
        tone: 'success',
      };
  }
}

export interface TicketTimelineProps {
  events: readonly TicketEvent[];
  /** Names for user ids referenced in staff-only events (transfer targets). */
  names: ReadonlyMap<string, string>;
  timeZone: string;
}

/** The ticket's own history, newest first. */
export function TicketTimeline({ events, names, timeZone }: TicketTimelineProps) {
  const items: TimelineItem[] = [...events].reverse().map((event) => {
    const described = describe(event, names);
    return {
      id: event.id,
      title: described.title,
      description: described.description,
      tone: described.tone,
      at: event.createdAt,
      atLabel: formatTimestamp(event.createdAt, timeZone),
      meta: event.actorName ? `by ${event.actorName}` : 'by JAVE',
    };
  });
  return <Timeline items={items} label="Ticket timeline" />;
}

/** User ids referenced by events whose names the timeline shows. */
export function referencedUserIds(events: readonly TicketEvent[]): string[] {
  return events.flatMap((event) => {
    const target = event.type === 'transferred' ? text(event.data, 'toUserId') : null;
    return target ? [target] : [];
  });
}
