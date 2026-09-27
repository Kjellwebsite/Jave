import { Badge, Mono, StatusBadge } from '@jave/ui';
import {
  PRIORITY_LABELS,
  PRIORITY_TONE,
  STATUS_LABELS,
  STATUS_QUIET,
  STATUS_TONE,
  type TicketPriority,
  type TicketStatus,
} from '@/lib/ticket-view';

export function TicketStatusBadge({ status }: { status: TicketStatus }) {
  return (
    <StatusBadge
      tone={STATUS_TONE[status]}
      quiet={STATUS_QUIET[status]}
      label={STATUS_LABELS[status].toUpperCase()}
      className="whitespace-nowrap"
      data-ticket-status={status}
    />
  );
}

/** High and urgent carry a badge; low and normal read as plain data. */
export function TicketPriorityBadge({ priority }: { priority: TicketPriority }) {
  if (PRIORITY_TONE[priority] === 'neutral') {
    return (
      <Mono dim className="type-eyebrow" data-ticket-priority={priority}>
        {PRIORITY_LABELS[priority].toUpperCase()}
      </Mono>
    );
  }
  return (
    <Badge tone={PRIORITY_TONE[priority]} data-ticket-priority={priority}>
      {PRIORITY_LABELS[priority].toUpperCase()}
    </Badge>
  );
}
