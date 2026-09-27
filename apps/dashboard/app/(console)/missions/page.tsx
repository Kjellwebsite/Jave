import type { Metadata } from 'next';
import Link from 'next/link';
import { Plus, Target } from 'lucide-react';
import { can, missions } from '@jave/core';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Icon,
  LinkTabs,
  Mono,
  NativeSelect,
  PageHeader,
  Pagination,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableEmptyRow,
  TableHead,
  TableHeaderCell,
  TableRow,
  Toolbar,
  buttonStyles,
} from '@jave/ui';
import { NextLink } from '@/components/next-link';
import { MissionList } from '@/components/missions/mission-list';
import {
  ASSIGNMENT_STATUS_LABELS,
  ASSIGNMENT_STATUS_TONE,
  holdingLabel,
  MISSION_STATUS_LABELS,
  MISSION_STATUS_TONE,
  MISSION_TABS,
  MISSION_TYPE_LABELS,
  type MissionStatusKey,
  type MissionTypeKey,
} from '@/lib/mission-labels';
import { optionsFrom } from '@/lib/member-labels';
import { firstParam, offsetParam, type SearchParams, toQueryString } from '@/lib/search-params';
import { formatDate } from '@/lib/time';
import { requireConsoleContext, type UserContext } from '@/server/context';
import { isMissionStaff } from '@/server/data/missions';
import { loadViewer } from '@/server/data/viewer';

export const metadata: Metadata = { title: 'Missions' };

const PAGE_SIZE = 25;
const STAFF_COLUMNS = 5;

function parseTab(value: string | undefined): MissionStatusKey {
  return (MISSION_TABS as readonly string[]).includes(value ?? '')
    ? (value as MissionStatusKey)
    : 'open';
}

function parseType(value: string | undefined): MissionTypeKey | undefined {
  return value && Object.hasOwn(MISSION_TYPE_LABELS, value) ? (value as MissionTypeKey) : undefined;
}

export default async function MissionsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { ctx } = await requireConsoleContext();
  const params = await searchParams;
  const type = parseType(firstParam(params.type));
  const offset = offsetParam(params.offset);
  if (isMissionStaff(ctx)) {
    return (
      <StaffMissions
        ctx={ctx}
        tab={parseTab(firstParam(params.status))}
        type={type}
        offset={offset}
      />
    );
  }
  return <MemberMissions ctx={ctx} type={type} offset={offset} />;
}

async function StaffMissions({
  ctx,
  tab,
  type,
  offset,
}: {
  ctx: UserContext;
  tab: MissionStatusKey;
  type: MissionTypeKey | undefined;
  offset: number;
}) {
  const [page, queue, viewer] = await Promise.all([
    missions.listMissions(ctx, { status: tab, type, limit: PAGE_SIZE, offset }),
    can(ctx, 'canVerifyMissions') ? missions.listSubmissionsForReview(ctx, { limit: 1 }) : null,
    loadViewer(ctx),
  ]);
  const query = { status: tab === 'open' ? undefined : tab, type };
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="OPERATIONS"
        title="Missions"
        description="Concrete, verifiable work. A verified mission becomes evidence on the member's record."
        meta={
          queue && queue.total > 0 ? (
            <Badge tone="warning">{queue.total} awaiting review</Badge>
          ) : (
            <Mono dim>Review queue clear</Mono>
          )
        }
        actions={
          can(ctx, 'canManageMissions') ? (
            <Link
              href="/missions/new"
              className={buttonStyles({ variant: 'primary' })}
              data-testid="new-mission"
            >
              <Icon icon={Plus} size="sm" />
              New mission
            </Link>
          ) : null
        }
      />

      <Card padding="none">
        <div className="flex flex-col gap-3 border-b border-line-subtle px-4 pt-2 md:flex-row md:items-end md:justify-between">
          <LinkTabs
            label="Mission status"
            linkComponent={NextLink}
            className="border-b-0"
            tabs={MISSION_TABS.map((status) => ({
              href: `/missions${toQueryString({ status: status === 'open' ? undefined : status, type })}`,
              label: MISSION_STATUS_LABELS[status],
              active: status === tab,
              meta: (
                <Mono dim className="text-[11px]">
                  {page.statusCounts[status]}
                </Mono>
              ),
            }))}
          />
          <form method="get" action="/missions" aria-label="Filter missions" className="pb-3">
            {tab !== 'open' ? <input type="hidden" name="status" value={tab} /> : null}
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

        {page.total === 0 && !type ? (
          <EmptyState
            icon={Target}
            title={`NO ${MISSION_STATUS_LABELS[tab].toUpperCase()} MISSIONS`}
            description={
              tab === 'draft'
                ? 'Drafts appear here until they are published.'
                : tab === 'open'
                  ? 'Publish a draft to open it for members.'
                  : 'Nothing here yet.'
            }
          />
        ) : (
          <Table caption="Missions">
            <TableHead>
              <tr>
                <TableHeaderCell>Mission</TableHeaderCell>
                <TableHeaderCell className="hidden sm:table-cell">Status</TableHeaderCell>
                <TableHeaderCell className="hidden md:table-cell">Holding</TableHeaderCell>
                <TableHeaderCell className="text-right">Review</TableHeaderCell>
                <TableHeaderCell className="hidden lg:table-cell text-right">
                  Deadline
                </TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {page.items.length === 0 ? (
                <TableEmptyRow
                  colSpan={STAFF_COLUMNS}
                  title="NO MATCHES"
                  description="No mission of this type in this list."
                  action={
                    <Link
                      href={`/missions${toQueryString(query.status ? { status: query.status } : {})}`}
                      className={buttonStyles({ size: 'sm' })}
                    >
                      Clear filter
                    </Link>
                  }
                />
              ) : (
                page.items.map((mission) => (
                  <TableRow key={mission.id} className="relative">
                    <TableCell>
                      <Link
                        href={`/missions/${mission.id}`}
                        className="block min-w-0 after:absolute after:inset-0 focus-visible:outline-none"
                      >
                        <span className="flex items-center gap-2">
                          <Mono dim className="text-[12px]">
                            {mission.number}
                          </Mono>
                          <span className="truncate text-body font-medium text-fg">
                            {mission.title}
                          </span>
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-2">
                          <span className="type-eyebrow text-[10px] text-fg-subtle">
                            {MISSION_TYPE_LABELS[mission.type]}
                          </span>
                          <span className="sm:hidden">
                            <StatusBadge
                              quiet
                              tone={MISSION_STATUS_TONE[mission.status]}
                              label={MISSION_STATUS_LABELS[mission.status].toUpperCase()}
                            />
                          </span>
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <StatusBadge
                        quiet={mission.status === 'open'}
                        tone={MISSION_STATUS_TONE[mission.status]}
                        label={MISSION_STATUS_LABELS[mission.status].toUpperCase()}
                      />
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <Mono className={mission.assigneeCount === 0 ? 'text-fg-subtle' : 'text-fg'}>
                        {holdingLabel(mission.assigneeCount, mission.maxAssignees)}
                      </Mono>
                    </TableCell>
                    <TableCell className="text-right">
                      {mission.awaitingReview > 0 ? (
                        <Badge tone="warning">{mission.awaitingReview}</Badge>
                      ) : (
                        <Mono dim aria-label="none">
                          —
                        </Mono>
                      )}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-right">
                      <Mono dim>
                        {mission.deadlineAt ? formatDate(mission.deadlineAt, viewer.timeZone) : '—'}
                      </Mono>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
        {page.total > PAGE_SIZE ? (
          <div className="border-t border-line-subtle px-5 py-3">
            <Pagination
              offset={page.offset}
              limit={page.limit}
              total={page.total}
              linkComponent={NextLink}
              hrefForOffset={(next) =>
                `/missions${toQueryString({ ...query, offset: next || undefined })}`
              }
            />
          </div>
        ) : null}
      </Card>
    </div>
  );
}

async function MemberMissions({
  ctx,
  type,
  offset,
}: {
  ctx: UserContext;
  type: MissionTypeKey | undefined;
  offset: number;
}) {
  const header = (
    <PageHeader
      eyebrow="OPERATIONS"
      title="Missions"
      description="Concrete, verifiable work. Verified missions become evidence on your record — never activity."
    />
  );
  // Missions are member work: without a JVLN profile there is nothing to take yet.
  if (!ctx.actor.memberId) {
    return (
      <div className="space-y-8">
        {header}
        <Card padding="none">
          <EmptyState
            icon={Target}
            title="NO JVLN PROFILE"
            description="Run /start in the JAVELIN Discord to create your profile, then take missions here."
          />
        </Card>
      </div>
    );
  }
  const [open, mine, viewer] = await Promise.all([
    missions.listOpenMissions(ctx, { type, limit: PAGE_SIZE, offset }),
    missions.listMyMissions(ctx, { scope: 'active' }),
    loadViewer(ctx),
  ]);
  return (
    <div className="space-y-8">
      {header}
      {mine.length > 0 ? (
        <section aria-labelledby="my-missions" className="space-y-3">
          <h2 id="my-missions" className="type-eyebrow text-fg-subtle">
            YOUR ACTIVE MISSIONS
          </h2>
          <ul className="grid gap-3 md:grid-cols-2">
            {mine.map(({ mission, assignment }) => (
              <li key={assignment.id}>
                <Link
                  href={`/missions/${mission.id}`}
                  className="machined block rounded-lg border border-line bg-surface p-4 transition-colors hover:border-line-strong hover:bg-surface-raised"
                >
                  <span className="flex items-center justify-between gap-3">
                    <Mono dim className="text-[12px]">
                      {mission.number}
                    </Mono>
                    <StatusBadge
                      tone={ASSIGNMENT_STATUS_TONE[assignment.status]}
                      label={ASSIGNMENT_STATUS_LABELS[assignment.status].toUpperCase()}
                    />
                  </span>
                  <span className="mt-2 block truncate text-body font-medium text-fg">
                    {mission.title}
                  </span>
                  <span className="mt-1 block text-small text-fg-subtle">
                    {assignment.dueAt
                      ? `Due ${formatDate(assignment.dueAt, viewer.timeZone)}`
                      : 'No due date'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <MissionList page={open} type={type} timeZone={viewer.timeZone} />
    </div>
  );
}
