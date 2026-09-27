import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  Badge,
  formatRate,
  Mono,
  Table,
  TableBody,
  TableCell,
  TableEmptyRow,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@jave/ui';
import type { invites } from '@jave/core';

const COLUMNS = 7;

function Count({ value }: { value: number }) {
  return value > 0 ? <Mono className="text-fg">{value}</Mono> : <Mono dim>0</Mono>;
}

function InviterName({
  row,
  linkToMember,
}: {
  row: invites.InviterFunnelRow;
  linkToMember: boolean;
}) {
  const name = row.displayName ?? 'Unlinked Discord user';
  const body = (
    <span className="min-w-0">
      <span className="block truncate text-body font-medium text-fg">{name}</span>
      <span className="type-data block truncate text-[12px] text-fg-subtle">
        {row.handle ? `@${row.handle}` : 'no JVLN profile'}
      </span>
    </span>
  );
  if (!linkToMember || !row.memberId) return body;
  return (
    <Link
      href={`/members/${row.memberId}`}
      className="block min-w-0 decoration-line-strong underline-offset-4 hover:underline"
    >
      {body}
    </Link>
  );
}

/**
 * Per-inviter funnels. VALID leads (it is the only stage that counts); rows
 * carrying anomaly flags show how many referrals await review, never why.
 */
export function InvitersTable({
  rows,
  linkToMembers,
  empty,
  caption = 'Inviters',
}: {
  rows: readonly invites.InviterFunnelRow[];
  linkToMembers: boolean;
  empty: { title: string; description: string; action?: ReactNode };
  caption?: string;
}) {
  return (
    <Table caption={caption}>
      <TableHead>
        <tr>
          <TableHeaderCell>Inviter</TableHeaderCell>
          <TableHeaderCell className="hidden text-right md:table-cell">Invited</TableHeaderCell>
          <TableHeaderCell className="text-right">Joined</TableHeaderCell>
          <TableHeaderCell className="hidden text-right sm:table-cell">Retained</TableHeaderCell>
          <TableHeaderCell className="text-right">Valid</TableHeaderCell>
          <TableHeaderCell className="hidden text-right lg:table-cell">Valid rate</TableHeaderCell>
          <TableHeaderCell className="hidden text-right md:table-cell">Signals</TableHeaderCell>
        </tr>
      </TableHead>
      <TableBody>
        {rows.length === 0 ? (
          <TableEmptyRow colSpan={COLUMNS} {...empty} />
        ) : (
          rows.map((row) => {
            const { funnel } = row;
            return (
              <TableRow key={row.inviterUserId}>
                <TableCell>
                  <InviterName row={row} linkToMember={linkToMembers} />
                  {funnel.flagged > 0 ? (
                    <span className="mt-1.5 block md:hidden">
                      <Badge tone="warning">{funnel.flagged} under review</Badge>
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="hidden text-right md:table-cell">
                  <Count value={funnel.invited} />
                </TableCell>
                <TableCell className="text-right">
                  <Count value={funnel.joined} />
                </TableCell>
                <TableCell className="hidden text-right sm:table-cell">
                  <Count value={funnel.retained} />
                </TableCell>
                <TableCell className="text-right">
                  <Count value={funnel.valid} />
                </TableCell>
                <TableCell className="hidden text-right lg:table-cell">
                  <Mono dim={funnel.validRate === null}>{formatRate(funnel.validRate)}</Mono>
                </TableCell>
                <TableCell className="hidden text-right md:table-cell">
                  <span className="inline-flex flex-wrap justify-end gap-1.5">
                    {funnel.flagged > 0 ? (
                      <Badge tone="warning">{funnel.flagged} under review</Badge>
                    ) : null}
                    {funnel.fastLeaves > 0 ? <Badge>{funnel.fastLeaves} fast leaves</Badge> : null}
                    {funnel.flagged === 0 && funnel.fastLeaves === 0 ? (
                      <Mono dim aria-label="none">
                        —
                      </Mono>
                    ) : null}
                  </span>
                </TableCell>
              </TableRow>
            );
          })
        )}
      </TableBody>
    </Table>
  );
}
