import Link from 'next/link';
import type { calendar, Page } from '@jave/core';
import {
  Mono,
  Pagination,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableEmptyRow,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@jave/ui';
import { NextLink } from '@/components/next-link';
import { RSVP_LABELS, RSVP_TONE } from '@/lib/event-labels';
import { formatTimestamp } from '@/lib/time';

const COLUMNS = 4;

export interface ParticipantsTableProps {
  page: Page<calendar.ParticipantView>;
  timeZone: string;
  /** Waitlist positions by member id (1-based), in queue order. */
  waitlistPositions: ReadonlyMap<string, number>;
  hrefForOffset: (offset: number) => string;
}

/** Staff: everyone who responded, grouped by response, oldest response first. */
export function ParticipantsTable({
  page,
  timeZone,
  waitlistPositions,
  hrefForOffset,
}: ParticipantsTableProps) {
  return (
    <>
      <Table caption="Responses">
        <TableHead>
          <tr>
            <TableHeaderCell>Member</TableHeaderCell>
            <TableHeaderCell>Response</TableHeaderCell>
            <TableHeaderCell className="hidden md:table-cell">Responded</TableHeaderCell>
            <TableHeaderCell className="text-right">Checked in</TableHeaderCell>
          </tr>
        </TableHead>
        <TableBody>
          {page.items.length === 0 ? (
            <TableEmptyRow
              colSpan={COLUMNS}
              title="NO RESPONSES YET"
              description="Responses appear as members RSVP here or on the Discord announcement."
            />
          ) : (
            page.items.map((participant) => {
              const position = waitlistPositions.get(participant.memberId);
              return (
                <TableRow key={participant.memberId}>
                  <TableCell>
                    <Link
                      href={`/members/${participant.memberId}`}
                      className="block min-w-0 hover:underline"
                    >
                      <span className="block truncate text-body text-fg">
                        {participant.displayName}
                      </span>
                      <span className="type-data block truncate text-[12px] text-fg-subtle">
                        @{participant.handle}
                      </span>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <StatusBadge
                      quiet={participant.status === 'going'}
                      tone={RSVP_TONE[participant.status]}
                      label={`${RSVP_LABELS[participant.status].toUpperCase()}${position ? ` #${position}` : ''}`}
                    />
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <Mono dim>{formatTimestamp(participant.respondedAt, timeZone)}</Mono>
                  </TableCell>
                  <TableCell className="text-right">
                    {participant.checkedInAt ? (
                      <Mono className="text-success">
                        ✓
                        <span className="hidden sm:inline">
                          {' '}
                          {formatTimestamp(participant.checkedInAt, timeZone)}
                        </span>
                      </Mono>
                    ) : (
                      <Mono dim aria-label="not checked in">
                        —
                      </Mono>
                    )}
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
      {page.total > page.limit ? (
        <div className="border-t border-line-subtle px-5 py-3">
          <Pagination
            offset={page.offset}
            limit={page.limit}
            total={page.total}
            linkComponent={NextLink}
            hrefForOffset={hrefForOffset}
          />
        </div>
      ) : null}
    </>
  );
}
