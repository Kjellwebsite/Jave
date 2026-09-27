'use client';

import Link from 'next/link';
import { type ReactNode, useId, useState } from 'react';
import { CheckCheck, SignalHigh, X, XCircle } from 'lucide-react';
import {
  Button,
  Checkbox,
  Mono,
  NativeSelect,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  Textarea,
} from '@jave/ui';
import {
  BULK_LIMIT,
  CATEGORY_LABELS,
  optionsOf,
  PRIORITY_LABELS,
  type SlaInput,
  type TicketCategory,
  type TicketPriority,
  type TicketStatus,
} from '@/lib/ticket-view';
import type { FormAction } from '../forms/action-form';
import { ConfirmActionDialog } from '../forms/confirm-action-dialog';
import { FormField } from '../forms/form-field';
import { SlaTimer } from './sla-timer';
import { TicketPriorityBadge, TicketStatusBadge } from './ticket-badges';

export interface QueueRow {
  id: string;
  reference: string;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  category: TicketCategory;
  assigneeName: string | null;
  createdAt: Date;
  /** Pre-formatted in the viewer's time zone ("3h ago"). */
  activityLabel: string;
  activityAt: Date;
  /** Staff only. */
  sla: SlaInput | null;
  dueLabel: string | null;
}

export interface BulkActions {
  claim: FormAction;
  priority: FormAction;
  close: FormAction;
}

export interface QueueTableProps {
  rows: readonly QueueRow[];
  /** Staff queue: SLA column and bulk selection. Otherwise the requester's own list. */
  staff: boolean;
  renderedAt: Date;
  bulk: BulkActions | null;
  empty: ReactNode;
}

function BulkBar({
  ids,
  references,
  actions,
  onClear,
}: {
  ids: readonly string[];
  references: string;
  actions: BulkActions;
  onClear: () => void;
}) {
  const hidden = { ticketIds: ids.join(',') };
  const count = ids.length;
  const noun = count === 1 ? 'ticket' : 'tickets';
  return (
    <div
      role="region"
      aria-label="Bulk actions"
      className="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 border-t border-line bg-surface-raised px-4 py-3"
    >
      <Mono className="mr-auto text-small text-fg" data-testid="bulk-count">
        {count} selected
      </Mono>
      <ConfirmActionDialog
        eyebrow="BULK"
        title={`Claim ${count} ${noun}`}
        description={`You become the handler of ${references}. Tickets claimed by someone else are skipped.`}
        confirmLabel={`Claim ${count}`}
        action={actions.claim}
        hidden={hidden}
        trigger={
          <Button size="sm" variant="secondary" iconLeft={CheckCheck}>
            Claim
          </Button>
        }
      />
      <ConfirmActionDialog
        eyebrow="BULK"
        title={`Set priority on ${count} ${noun}`}
        description="First-response targets follow the new priority while a ticket is unanswered. Raising to HIGH or URGENT alerts staff."
        confirmLabel="Set priority"
        action={actions.priority}
        hidden={hidden}
        trigger={
          <Button size="sm" variant="secondary" iconLeft={SignalHigh}>
            Priority
          </Button>
        }
      >
        <FormField name="priority" label="Priority" required>
          <NativeSelect name="priority" defaultValue="high" options={optionsOf(PRIORITY_LABELS)} />
        </FormField>
      </ConfirmActionDialog>
      <ConfirmActionDialog
        eyebrow="BULK"
        title={`Close ${count} ${noun}`}
        description={`Closes ${references}. Each requester sees the reason in their thread, which is then locked.`}
        confirmLabel={`Close ${count}`}
        tone="danger"
        action={actions.close}
        hidden={hidden}
        trigger={
          <Button size="sm" variant="secondary" iconLeft={XCircle}>
            Close
          </Button>
        }
      >
        <FormField
          name="reason"
          label="Reason"
          description="Shown to every requester. Recorded in the audit log."
          required
        >
          <Textarea name="reason" required minLength={3} maxLength={500} rows={3} />
        </FormField>
      </ConfirmActionDialog>
      <Button size="sm" variant="ghost" iconLeft={X} onClick={onClear}>
        Clear
      </Button>
    </div>
  );
}

/**
 * The ticket queue. Rows link to the ticket; staff can select up to one page
 * and act on the selection. Selection only routes: each ticket is authorized
 * individually by core, and refusals are reported per ticket.
 */
export function QueueTable({ rows, staff, renderedAt, bulk, empty }: QueueTableProps) {
  const baseId = useId();
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const selected = rows.filter((row) => picked.has(row.id)).slice(0, BULK_LIMIT);
  const selectable = staff && bulk !== null;
  const allSelected = rows.length > 0 && selected.length === rows.length;

  function toggle(id: string, checked: boolean) {
    setPicked((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  const columns = selectable ? 7 : staff ? 6 : 5;
  return (
    <div>
      <Table caption="Tickets">
        <TableHead>
          <tr>
            {selectable ? (
              <TableHeaderCell className="w-10 pr-0">
                <Checkbox
                  id={`${baseId}-all`}
                  checked={allSelected}
                  onCheckedChange={(checked) =>
                    setPicked(checked ? new Set(rows.map((row) => row.id)) : new Set())
                  }
                  label={<span className="sr-only">Select every ticket on this page</span>}
                />
              </TableHeaderCell>
            ) : null}
            <TableHeaderCell>Ticket</TableHeaderCell>
            <TableHeaderCell className="hidden md:table-cell">Status</TableHeaderCell>
            <TableHeaderCell className="hidden sm:table-cell">Priority</TableHeaderCell>
            <TableHeaderCell className="hidden lg:table-cell">Handler</TableHeaderCell>
            {staff ? (
              <TableHeaderCell className="text-right">First response</TableHeaderCell>
            ) : null}
            <TableHeaderCell className="hidden text-right md:table-cell">Activity</TableHeaderCell>
          </tr>
        </TableHead>
        <TableBody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns}>{empty}</td>
            </tr>
          ) : (
            rows.map((row) => (
              <TableRow key={row.id} className="relative" data-ticket-row={row.reference}>
                {selectable ? (
                  <TableCell className="relative z-10 w-10 pr-0">
                    <Checkbox
                      id={`${baseId}-${row.id}`}
                      checked={picked.has(row.id)}
                      onCheckedChange={(checked) => toggle(row.id, checked)}
                      label={<span className="sr-only">Select {row.reference}</span>}
                    />
                  </TableCell>
                ) : null}
                <TableCell className="min-w-0 max-w-0 w-full">
                  <Link
                    href={`/tickets/${row.id}`}
                    className="block min-w-0 after:absolute after:inset-0 focus-visible:outline-none"
                  >
                    <span className="flex min-w-0 flex-col sm:flex-row sm:items-baseline sm:gap-2.5">
                      <Mono className="shrink-0 text-small text-fg-muted sm:text-body sm:text-fg">
                        {row.reference}
                      </Mono>
                      <span className="line-clamp-2 break-words text-body font-medium text-fg sm:truncate">
                        {row.subject}
                      </span>
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-small text-fg-subtle">
                      <span className="md:hidden">
                        <TicketStatusBadge status={row.status} />
                      </span>
                      <span className="sm:hidden">
                        <TicketPriorityBadge priority={row.priority} />
                      </span>
                      <span>{CATEGORY_LABELS[row.category]}</span>
                      <span className="lg:hidden">{row.assigneeName ?? 'Unassigned'}</span>
                    </span>
                  </Link>
                </TableCell>
                <TableCell className="hidden whitespace-nowrap md:table-cell">
                  <TicketStatusBadge status={row.status} />
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  <TicketPriorityBadge priority={row.priority} />
                </TableCell>
                <TableCell className="hidden whitespace-nowrap lg:table-cell">
                  {row.assigneeName ? (
                    <span className="text-small text-fg-muted">{row.assigneeName}</span>
                  ) : (
                    <span className="text-small text-fg-subtle">Unassigned</span>
                  )}
                </TableCell>
                {staff ? (
                  <TableCell className="whitespace-nowrap text-right">
                    {row.sla ? (
                      <SlaTimer
                        sla={row.sla}
                        ticket={{ createdAt: row.createdAt, status: row.status }}
                        renderedAt={renderedAt}
                        dueLabel={row.dueLabel ?? undefined}
                        className="justify-end"
                      />
                    ) : null}
                  </TableCell>
                ) : null}
                <TableCell className="hidden whitespace-nowrap text-right md:table-cell">
                  <Mono dim>
                    <time dateTime={row.activityAt.toISOString()}>{row.activityLabel}</time>
                  </Mono>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      {selectable && bulk && selected.length > 0 ? (
        <BulkBar
          ids={selected.map((row) => row.id)}
          references={selected.map((row) => row.reference).join(', ')}
          actions={bulk}
          onClear={() => setPicked(new Set())}
        />
      ) : null}
    </div>
  );
}
