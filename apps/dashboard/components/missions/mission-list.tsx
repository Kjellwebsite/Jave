import Link from 'next/link';
import { Target } from 'lucide-react';
import type { missions, Page } from '@jave/core';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Mono,
  NativeSelect,
  Pagination,
  StatusBadge,
  Toolbar,
  buttonStyles,
} from '@jave/ui';
import {
  ASSIGNMENT_STATUS_LABELS,
  ASSIGNMENT_STATUS_TONE,
  MISSION_TYPE_LABELS,
  type MissionTypeKey,
} from '@/lib/mission-labels';
import { optionsFrom } from '@/lib/member-labels';
import { toQueryString } from '@/lib/search-params';
import { formatDate } from '@/lib/time';
import { NextLink } from '../next-link';

function slotsText(item: missions.OpenMissionItem): string {
  if (item.type === 'team') return 'Teams formed by staff';
  if (item.slotsLeft === null) return 'Open to every member';
  return item.slotsLeft === 0 ? 'Full' : `${item.slotsLeft} of ${item.maxAssignees} slots left`;
}

/** Open missions for members: type filter, cards linking to the detail, paging. */
export function MissionList({
  page,
  type,
  timeZone,
}: {
  page: Page<missions.OpenMissionItem>;
  type: MissionTypeKey | undefined;
  timeZone: string;
}) {
  return (
    <section aria-labelledby="open-missions" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id="open-missions" className="type-eyebrow text-fg-subtle">
          OPEN MISSIONS · {page.total}
        </h2>
        <form method="get" action="/missions" aria-label="Filter missions">
          <Toolbar className="gap-2">
            <NativeSelect
              name="type"
              aria-label="Mission type"
              size="sm"
              defaultValue={type ?? ''}
              placeholder="Every type"
              options={optionsFrom(MISSION_TYPE_LABELS)}
              className="w-40"
            />
            <Button type="submit" size="sm" variant="secondary">
              Filter
            </Button>
          </Toolbar>
        </form>
      </div>
      {page.items.length === 0 ? (
        <Card padding="none">
          <EmptyState
            icon={Target}
            title={type ? 'NO MATCHES' : 'NO OPEN MISSIONS'}
            description={
              type
                ? 'No open mission of this type right now.'
                : 'New missions are announced in Discord and appear here.'
            }
            action={
              type ? (
                <Link href="/missions" className={buttonStyles({ size: 'sm' })}>
                  Clear filter
                </Link>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {page.items.map((item) => (
            <li key={item.id}>
              <Link
                href={`/missions/${item.id}`}
                className="machined flex h-full flex-col rounded-lg border border-line bg-surface p-4 transition-colors hover:border-line-strong hover:bg-surface-raised"
              >
                <span className="flex items-center justify-between gap-3">
                  <Mono dim className="text-[12px]">
                    {item.number}
                  </Mono>
                  <Badge>{MISSION_TYPE_LABELS[item.type]}</Badge>
                </span>
                <span className="mt-2 block text-body font-medium text-fg">{item.title}</span>
                <span className="mt-1 line-clamp-2 text-small text-fg-subtle">{item.brief}</span>
                <span className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-4 text-small text-fg-muted">
                  <span>{slotsText(item)}</span>
                  {item.deadlineAt ? (
                    <Mono dim className="text-[12px]">
                      closes {formatDate(item.deadlineAt, timeZone)}
                    </Mono>
                  ) : null}
                  {item.myAssignment ? (
                    <StatusBadge
                      tone={ASSIGNMENT_STATUS_TONE[item.myAssignment.status]}
                      label={ASSIGNMENT_STATUS_LABELS[item.myAssignment.status].toUpperCase()}
                    />
                  ) : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {page.total > page.limit ? (
        <Pagination
          offset={page.offset}
          limit={page.limit}
          total={page.total}
          linkComponent={NextLink}
          hrefForOffset={(next) => `/missions${toQueryString({ type, offset: next || undefined })}`}
        />
      ) : null}
    </section>
  );
}
