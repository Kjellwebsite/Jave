import Link from 'next/link';
import { BadgeCheck } from 'lucide-react';
import type { achievements, Page } from '@jave/core';
import {
  Badge,
  EmptyState,
  Mono,
  Pagination,
  Panel,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@jave/ui';
import { RARITY_LABELS, RARITY_TONE } from '@/lib/achievement-labels';
import { toQueryString } from '@/lib/search-params';
import { formatTimestamp } from '@/lib/time';
import type { FormAction } from '../forms/action-form';
import { NextLink } from '../next-link';
import { VerifyAwardButton } from './award-controls';

/** Awards waiting for a second person, oldest first. */
export function PendingAwards({
  page,
  timeZone,
  verifyAction,
}: {
  page: Page<achievements.PendingAwardItem>;
  timeZone: string;
  verifyAction: FormAction;
}) {
  return (
    <Panel
      title="Pending verification"
      description="Awards on achievements that require a second person. Nobody verifies their own award or one they made."
      flush
    >
      {page.items.length === 0 ? (
        <EmptyState
          icon={BadgeCheck}
          title="NOTHING PENDING"
          description="Every award is verified."
        />
      ) : (
        <Table caption="Awards pending verification">
          <TableHead>
            <tr>
              <TableHeaderCell>Member</TableHeaderCell>
              <TableHeaderCell>Achievement</TableHeaderCell>
              <TableHeaderCell className="hidden md:table-cell">Awarded</TableHeaderCell>
              <TableHeaderCell className="text-right">
                <span className="sr-only">Actions</span>
              </TableHeaderCell>
            </tr>
          </TableHead>
          <TableBody>
            {page.items.map((item) => (
              <TableRow key={item.awardId}>
                <TableCell>
                  <Link href={`/members/${item.memberId}`} className="block min-w-0">
                    <span className="block truncate text-body text-fg">
                      {item.memberDisplayName}
                    </span>
                    <Mono dim className="block truncate text-[12px]">
                      @{item.memberHandle}
                    </Mono>
                  </Link>
                </TableCell>
                <TableCell>
                  <span className="block text-body text-fg-muted">{item.title}</span>
                  <Badge tone={RARITY_TONE[item.rarity]} className="mt-1">
                    {RARITY_LABELS[item.rarity]}
                  </Badge>
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <Mono dim className="block text-[12px]">
                    {formatTimestamp(item.awardedAt, timeZone)}
                  </Mono>
                  <span className="block text-small text-fg-subtle">
                    {item.awardedByName ? `by ${item.awardedByName}` : 'automatic'}
                    {item.note ? ` — ${item.note}` : ''}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  {item.isOwn ? (
                    <Badge>Your award</Badge>
                  ) : item.awardedByViewer ? (
                    <Badge>You awarded it</Badge>
                  ) : (
                    <VerifyAwardButton
                      memberId={item.memberId}
                      achievementKey={item.key}
                      label={`${item.title} — ${item.memberDisplayName}`}
                      action={verifyAction}
                    />
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {page.total > page.limit ? (
        <div className="border-t border-line-subtle px-5 py-3">
          <Pagination
            offset={page.offset}
            limit={page.limit}
            total={page.total}
            linkComponent={NextLink}
            hrefForOffset={(next) =>
              `/achievements${toQueryString({ tab: 'pending', offset: next || undefined })}`
            }
          />
        </div>
      ) : null}
    </Panel>
  );
}
