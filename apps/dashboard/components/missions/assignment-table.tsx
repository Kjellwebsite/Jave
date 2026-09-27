import Link from 'next/link';
import { missions } from '@jave/core';
import {
  EmptyState,
  Mono,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@jave/ui';
import { ASSIGNMENT_STATUS_LABELS, ASSIGNMENT_STATUS_TONE } from '@/lib/mission-labels';
import { formatTimestamp } from '@/lib/time';

/** The mission roster for staff: who holds it, in which state, due when. */
export function AssignmentTable({
  assignments,
  timeZone,
}: {
  assignments: readonly missions.StaffAssignmentView[];
  timeZone: string;
}) {
  if (assignments.length === 0) {
    return (
      <EmptyState
        compact
        title="NOBODY ASSIGNED"
        description="Members appear here when they accept the mission or staff assign them."
      />
    );
  }
  return (
    <Table caption="Assignments">
      <TableHead>
        <tr>
          <TableHeaderCell>Member</TableHeaderCell>
          <TableHeaderCell>Status</TableHeaderCell>
          <TableHeaderCell className="hidden md:table-cell">Team</TableHeaderCell>
          <TableHeaderCell className="hidden sm:table-cell text-right">Due</TableHeaderCell>
          <TableHeaderCell className="hidden lg:table-cell text-right">Attempts</TableHeaderCell>
        </tr>
      </TableHead>
      <TableBody>
        {assignments.map((row) => (
          <TableRow key={row.id} data-assignment={row.memberHandle}>
            <TableCell>
              <Link
                href={`/members/${row.memberId}`}
                className="block min-w-0 hover:text-fg focus-visible:outline-none"
              >
                <span className="block truncate text-body text-fg">{row.memberDisplayName}</span>
                <Mono dim className="block truncate text-[12px]">
                  @{row.memberHandle}
                </Mono>
              </Link>
            </TableCell>
            <TableCell>
              <StatusBadge
                quiet={row.status === 'verified'}
                tone={ASSIGNMENT_STATUS_TONE[row.status]}
                label={ASSIGNMENT_STATUS_LABELS[row.status].toUpperCase()}
              />
            </TableCell>
            <TableCell className="hidden md:table-cell">
              {row.teamKey ? <Mono>{row.teamKey}</Mono> : <Mono dim>—</Mono>}
            </TableCell>
            <TableCell className="hidden sm:table-cell text-right">
              <Mono dim>{row.dueAt ? formatTimestamp(row.dueAt, timeZone) : '—'}</Mono>
            </TableCell>
            <TableCell className="hidden lg:table-cell text-right">
              <Mono dim>
                {row.attempts} / {missions.MAX_SUBMISSION_ATTEMPTS}
              </Mono>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
