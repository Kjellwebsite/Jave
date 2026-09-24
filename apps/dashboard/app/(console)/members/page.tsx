import type { Metadata } from 'next';
import Link from 'next/link';
import { Search, Users } from 'lucide-react';
import { z } from 'zod';
import { listMembers, listMembersSchema, ROLE_KEYS } from '@jave/core';
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  Icon,
  Input,
  Mono,
  NativeSelect,
  PageHeader,
  Pagination,
  RoleBadge,
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
import { RestrictedPage } from '@/components/restricted-page';
import {
  GUILD_STATUS_LABELS,
  GUILD_STATUS_TONE,
  MEMBER_SORT_LABELS,
  optionsFrom,
  STANDING_LABELS,
  STANDING_TONE,
} from '@/lib/member-labels';
import { firstParam, offsetParam, type SearchParams, toQueryString } from '@/lib/search-params';
import { ROLE_OPTIONS } from '@/lib/settings-form';
import { formatDate } from '@/lib/time';
import { requireConsoleContext } from '@/server/context';
import { loadViewer } from '@/server/data/viewer';
import { guarded } from '@/server/guard';

export const metadata: Metadata = { title: 'Members' };

const PAGE_SIZE = 25;
const COLUMNS = 5;

const filterSchema = z.object({
  q: listMembersSchema.shape.search.catch(undefined),
  role: z
    .enum(ROLE_KEYS as [string, ...string[]])
    .optional()
    .catch(undefined),
  status: listMembersSchema.shape.guildStatus.catch(undefined),
  standing: listMembersSchema.shape.standing.catch(undefined),
  sort: listMembersSchema.shape.sort.catch('joined_desc'),
});

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { ctx } = await requireConsoleContext();
  const params = await searchParams;
  const filters = filterSchema.parse({
    q: firstParam(params.q) || undefined,
    role: firstParam(params.role) || undefined,
    status: firstParam(params.status) || undefined,
    standing: firstParam(params.standing) || undefined,
    sort: firstParam(params.sort) || undefined,
  });
  const offset = offsetParam(params.offset);

  const result = await guarded(() =>
    listMembers(ctx, {
      search: filters.q,
      role: filters.role as (typeof ROLE_KEYS)[number] | undefined,
      guildStatus: filters.status,
      standing: filters.standing,
      sort: filters.sort,
      limit: PAGE_SIZE,
      offset,
    }),
  );
  if (!result.ok)
    return <RestrictedPage eyebrow="PEOPLE" title="Members" capability="canViewMembers" />;
  const page = result.value;
  const viewer = await loadViewer(ctx);
  const filtered = Boolean(filters.q || filters.role || filters.status || filters.standing);
  const query = {
    q: filters.q,
    role: filters.role,
    status: filters.status,
    standing: filters.standing,
    sort: filters.sort === 'joined_desc' ? undefined : filters.sort,
  };

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="PEOPLE"
        title="Members"
        description="Everyone JAVE knows: guild members and people who signed in to the dashboard."
        meta={
          <Mono dim>
            {page.total.toLocaleString('en-US')} {filtered ? 'matching' : 'total'}
          </Mono>
        }
      />

      <Card padding="none">
        <form
          method="get"
          action="/members"
          role="search"
          aria-label="Filter members"
          className="border-b border-line-subtle p-4"
        >
          <Toolbar className="grid grid-cols-2 gap-2.5 md:grid-cols-4 xl:grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,1fr))_auto]">
            <label className="relative col-span-2 min-w-0 md:col-span-4 xl:col-span-1">
              <span className="sr-only">Search members</span>
              <Icon
                icon={Search}
                size="sm"
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle"
              />
              <Input
                name="q"
                type="search"
                defaultValue={filters.q ?? ''}
                placeholder="Name, handle or username"
                maxLength={64}
                className="pl-8"
              />
            </label>
            <NativeSelect
              name="role"
              aria-label="Role"
              defaultValue={filters.role ?? ''}
              placeholder="Any role"
              options={ROLE_OPTIONS}
            />
            <NativeSelect
              name="status"
              aria-label="Guild status"
              defaultValue={filters.status ?? ''}
              placeholder="Any status"
              options={optionsFrom(GUILD_STATUS_LABELS)}
            />
            <NativeSelect
              name="standing"
              aria-label="Standing"
              defaultValue={filters.standing ?? ''}
              placeholder="Any standing"
              options={optionsFrom(STANDING_LABELS)}
            />
            <NativeSelect
              name="sort"
              aria-label="Sort"
              defaultValue={filters.sort}
              options={optionsFrom(MEMBER_SORT_LABELS)}
            />
            <div className="col-span-2 flex gap-2 md:col-span-4 xl:col-span-1">
              <Button type="submit" variant="primary" className="flex-1 xl:flex-none">
                Apply
              </Button>
              {filtered ? (
                <Link href="/members" className={buttonStyles({ variant: 'ghost' })}>
                  Reset
                </Link>
              ) : null}
            </div>
          </Toolbar>
        </form>

        {page.total === 0 && !filtered ? (
          <EmptyState
            icon={Users}
            title="NO MEMBERS YET"
            description="Members appear when they join the Discord guild or sign in here."
          />
        ) : (
          <Table caption="Members">
            <TableHead>
              <tr>
                <TableHeaderCell>Member</TableHeaderCell>
                <TableHeaderCell className="hidden sm:table-cell">Role</TableHeaderCell>
                <TableHeaderCell className="hidden md:table-cell">Status</TableHeaderCell>
                <TableHeaderCell className="text-right">Verified</TableHeaderCell>
                <TableHeaderCell className="hidden sm:table-cell text-right">
                  Joined
                </TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {page.items.length === 0 ? (
                <TableEmptyRow
                  colSpan={COLUMNS}
                  title="NO MATCHES"
                  description="No member matches these filters."
                  action={
                    <Link href="/members" className={buttonStyles({ size: 'sm' })}>
                      Clear filters
                    </Link>
                  }
                />
              ) : (
                page.items.map((member) => (
                  <TableRow key={member.id} className="relative">
                    <TableCell>
                      <Link
                        href={`/members/${member.id}`}
                        className="flex min-w-0 items-center gap-3 after:absolute after:inset-0 focus-visible:outline-none"
                      >
                        <Avatar name={member.displayName} src={member.avatarUrl} size="md" />
                        <span className="min-w-0">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-body font-medium text-fg">
                              {member.displayName}
                            </span>
                            {member.standing !== 'good' ? (
                              <Badge tone={STANDING_TONE[member.standing]}>
                                {STANDING_LABELS[member.standing]}
                              </Badge>
                            ) : null}
                          </span>
                          <span className="type-data block truncate text-[12px] text-fg-subtle">
                            @{member.handle}
                          </span>
                          {member.primaryRole ? (
                            <span className="mt-1.5 block sm:hidden">
                              <RoleBadge role={member.primaryRole} size="sm" />
                            </span>
                          ) : null}
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <span className="flex items-center gap-1.5">
                        {member.primaryRole ? (
                          <RoleBadge role={member.primaryRole} size="sm" />
                        ) : (
                          <span className="text-fg-faint">—</span>
                        )}
                        {member.roles.length > 1 ? (
                          <Mono dim className="text-[11px]">
                            +{member.roles.length - 1}
                          </Mono>
                        ) : null}
                      </span>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <StatusBadge
                        quiet={member.guildStatus === 'present'}
                        tone={GUILD_STATUS_TONE[member.guildStatus]}
                        label={GUILD_STATUS_LABELS[member.guildStatus].toUpperCase()}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      {member.verifiedCapabilities > 0 ? (
                        <Mono className="text-fg">{member.verifiedCapabilities}</Mono>
                      ) : (
                        <Mono dim aria-label="none">
                          —
                        </Mono>
                      )}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-right">
                      <Mono dim>
                        {member.joinedGuildAt
                          ? formatDate(member.joinedGuildAt, viewer.timeZone)
                          : '—'}
                      </Mono>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}

        {page.total > 0 ? (
          <div className="border-t border-line-subtle px-5 py-3">
            <Pagination
              offset={page.offset}
              limit={page.limit}
              total={page.total}
              linkComponent={NextLink}
              hrefForOffset={(next) =>
                `/members${toQueryString({ ...query, offset: next || undefined })}`
              }
            />
          </div>
        ) : null}
      </Card>
    </div>
  );
}
