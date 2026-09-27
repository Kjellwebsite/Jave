import type { Metadata } from 'next';
import Link from 'next/link';
import { Inbox, Search } from 'lucide-react';
import { z } from 'zod';
import { applications, loadCatalog } from '@jave/core';
import {
  Badge,
  Button,
  buttonStyles,
  Card,
  cx,
  EmptyState,
  Icon,
  Input,
  Mono,
  NativeSelect,
  PageHeader,
  Pagination,
  Stat,
  Table,
  TableBody,
  TableCell,
  TableEmptyRow,
  TableHead,
  TableHeaderCell,
  TableRow,
  Toolbar,
} from '@jave/ui';
import { ApplicationStatusBadge } from '@/components/applications/application-parts';
import { NextLink } from '@/components/next-link';
import { RestrictedPage } from '@/components/restricted-page';
import {
  parseApplicationNumber,
  QUEUE_SORT_LABELS,
  QUEUE_SORTS,
  QUEUE_STATUS_FILTER_LABELS,
  QUEUE_STATUS_FILTERS,
  statusesFor,
} from '@/lib/applications';
import { optionsFrom } from '@/lib/member-labels';
import { firstParam, offsetParam, type SearchParams, toQueryString } from '@/lib/search-params';
import { formatDate, formatRelative } from '@/lib/time';
import { requireConsoleContext } from '@/server/context';
import { loadApplicationQueueCounts } from '@/server/data/queue-counts';
import { loadViewer } from '@/server/data/viewer';
import { guarded } from '@/server/guard';

export const metadata: Metadata = { title: 'Applications' };

const PAGE_SIZE = 25;
const COLUMNS = 6;
const NUMBER_INPUT_CHARS = 12;
const DOMAIN_KEY = /^[a-z0-9_-]{1,32}$/;

const filterSchema = z.object({
  status: z.enum(QUEUE_STATUS_FILTERS).catch('in_flight'),
  domain: z.string().regex(DOMAIN_KEY).optional().catch(undefined),
  mine: z.literal('1').optional().catch(undefined),
  number: z.string().max(NUMBER_INPUT_CHARS).optional().catch(undefined),
  sort: z.enum(QUEUE_SORTS).catch('oldest'),
});

export default async function ApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { ctx } = await requireConsoleContext();
  const params = await searchParams;
  const filters = filterSchema.parse({
    status: firstParam(params.status) || undefined,
    domain: firstParam(params.domain) || undefined,
    mine: firstParam(params.mine) || undefined,
    number: firstParam(params.number)?.trim() || undefined,
    sort: firstParam(params.sort) || undefined,
  });
  const number = parseApplicationNumber(filters.number);
  const offset = offsetParam(params.offset);

  const result = await guarded(() =>
    Promise.all([
      applications.listApplications(ctx, {
        status: statusesFor(filters.status),
        domainKey: filters.domain,
        assignedToMe: filters.mine === '1' || undefined,
        number,
        sort: filters.sort,
        limit: PAGE_SIZE,
        offset,
      }),
      loadApplicationQueueCounts(ctx),
    ]),
  );
  if (!result.ok)
    return (
      <RestrictedPage eyebrow="PEOPLE" title="Applications" capability="canViewApplications" />
    );
  const [page, counts] = result.value;
  const [viewer, catalog] = await Promise.all([loadViewer(ctx), loadCatalog(ctx)]);
  const domainLabel = new Map(catalog.domains.map((domain) => [domain.key, domain.label]));
  const now = ctx.clock.now();
  const badNumber = filters.number !== undefined && number === undefined;
  const filtered = Boolean(
    filters.status !== 'in_flight' || filters.domain || filters.mine || filters.number,
  );
  const query = {
    status: filters.status === 'in_flight' ? undefined : filters.status,
    domain: filters.domain,
    mine: filters.mine,
    number: filters.number,
    sort: filters.sort === 'oldest' ? undefined : filters.sort,
  };
  const tiles: { label: string; value: number; hint: string; href: string }[] = [
    {
      label: 'UNCLAIMED',
      value: counts.unclaimed,
      hint: 'Submitted, no reviewer',
      href: '/applications?status=submitted',
    },
    {
      label: 'IN REVIEW',
      value: counts.inReview,
      hint: 'A reviewer is on it',
      href: '/applications?status=review',
    },
    {
      label: 'INTERVIEW',
      value: counts.interview,
      hint: 'Waiting on a conversation',
      href: '/applications?status=interview',
    },
    {
      label: 'ASSIGNED TO YOU',
      value: counts.assignedToMe,
      hint: 'Undecided, yours',
      href: '/applications?mine=1',
    },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="PEOPLE"
        title="Applications"
        description="Who wants in, and what they have shown. Staff never see drafts, and never their own application."
        meta={
          <Mono dim>
            {page.total.toLocaleString('en-US')} {filtered ? 'matching' : 'undecided'}
          </Mono>
        }
      />

      <section aria-label="Queue readouts" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((tile) => (
          <Stat
            key={tile.label}
            label={tile.label}
            value={tile.value}
            hint={tile.hint}
            href={tile.href}
            linkComponent={NextLink}
            className={cx(tile.value === 0 && '[&_.type-numeral]:text-fg-subtle')}
          />
        ))}
      </section>

      <Card padding="none">
        <form
          method="get"
          action="/applications"
          role="search"
          aria-label="Filter applications"
          className="border-b border-line-subtle p-4"
        >
          <Toolbar className="grid grid-cols-2 gap-2.5 md:grid-cols-4 xl:grid-cols-[minmax(0,1.2fr)_repeat(4,minmax(0,1fr))_auto]">
            <label className="relative col-span-2 min-w-0 md:col-span-4 xl:col-span-1">
              <span className="sr-only">Application number</span>
              <Icon
                icon={Search}
                size="sm"
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle"
              />
              <Input
                name="number"
                type="search"
                defaultValue={filters.number ?? ''}
                placeholder="APP-0042"
                maxLength={NUMBER_INPUT_CHARS}
                mono
                invalid={badNumber}
                className="pl-8"
              />
            </label>
            <NativeSelect
              name="status"
              aria-label="Status"
              defaultValue={filters.status}
              options={optionsFrom(QUEUE_STATUS_FILTER_LABELS)}
            />
            <NativeSelect
              name="domain"
              aria-label="Domain"
              defaultValue={filters.domain ?? ''}
              placeholder="Any domain"
              options={catalog.domains.map((domain) => ({
                value: domain.key,
                label: domain.label,
              }))}
            />
            <NativeSelect
              name="sort"
              aria-label="Sort"
              defaultValue={filters.sort}
              options={optionsFrom(QUEUE_SORT_LABELS)}
            />
            <NativeSelect
              name="mine"
              aria-label="Reviewer"
              defaultValue={filters.mine ?? ''}
              placeholder="Any reviewer"
              options={[{ value: '1', label: 'Assigned to me' }]}
            />
            <div className="col-span-2 flex gap-2 md:col-span-4 xl:col-span-1">
              <Button type="submit" variant="primary" className="flex-1 xl:flex-none">
                Apply
              </Button>
              {filtered ? (
                <Link href="/applications" className={buttonStyles({ variant: 'ghost' })}>
                  Reset
                </Link>
              ) : null}
            </div>
          </Toolbar>
          {badNumber ? (
            <p role="alert" className="mt-2 text-small text-danger">
              Application numbers look like APP-0042.
            </p>
          ) : null}
        </form>

        {page.total === 0 && !filtered ? (
          <EmptyState
            icon={Inbox}
            title="QUEUE CLEAR"
            description="No application is waiting for a decision. New submissions appear here and in the review channel."
          />
        ) : (
          <Table caption="Applications">
            <TableHead>
              <tr>
                <TableHeaderCell>Application</TableHeaderCell>
                <TableHeaderCell className="hidden sm:table-cell">Status</TableHeaderCell>
                <TableHeaderCell className="hidden md:table-cell">Domain</TableHeaderCell>
                <TableHeaderCell className="hidden lg:table-cell">Reviewer</TableHeaderCell>
                <TableHeaderCell className="hidden sm:table-cell text-right">
                  Reviews
                </TableHeaderCell>
                <TableHeaderCell className="hidden sm:table-cell text-right">
                  Submitted
                </TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {page.items.length === 0 ? (
                <TableEmptyRow
                  colSpan={COLUMNS}
                  title="NO MATCHES"
                  description="No application matches these filters."
                  action={
                    <Link href="/applications" className={buttonStyles({ size: 'sm' })}>
                      Clear filters
                    </Link>
                  }
                />
              ) : (
                page.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <Link href={`/applications/${item.id}`} className="row-link block min-w-0">
                        <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                          <span className="type-data text-body text-fg">{item.number}</span>
                          <span className="sm:hidden">
                            <ApplicationStatusBadge status={item.status} />
                          </span>
                        </span>
                        <span className="block truncate text-small text-fg-muted">
                          {item.applicant?.displayName ?? '—'}
                          {item.applicant?.handle ? (
                            <Mono dim className="ml-2 text-[12px]">
                              @{item.applicant.handle}
                            </Mono>
                          ) : null}
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <ApplicationStatusBadge status={item.status} />
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {item.domainKey ? (
                        <Badge>{domainLabel.get(item.domainKey) ?? item.domainKey}</Badge>
                      ) : (
                        <span className="text-fg-faint">—</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {item.assignedReviewer ? (
                        <span className="text-small text-fg-muted">
                          {item.assignedReviewer.displayName}
                        </span>
                      ) : (
                        <span className="type-eyebrow text-fg-subtle">UNCLAIMED</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-right">
                      {item.reviewCount > 0 ? (
                        <Mono className="text-fg">{item.reviewCount}</Mono>
                      ) : (
                        <Mono dim aria-label="none">
                          —
                        </Mono>
                      )}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-right">
                      {item.submittedAt ? (
                        <Mono dim title={formatDate(item.submittedAt, viewer.timeZone)}>
                          {formatRelative(item.submittedAt, now, viewer.timeZone)}
                        </Mono>
                      ) : (
                        <Mono dim>—</Mono>
                      )}
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
                `/applications${toQueryString({ ...query, offset: next || undefined })}`
              }
            />
          </div>
        ) : null}
      </Card>
    </div>
  );
}
