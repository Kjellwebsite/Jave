import type { Metadata } from 'next';
import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { z } from 'zod';
import { can, loadCatalog, verification } from '@jave/core';
import {
  Button,
  buttonStyles,
  Card,
  cx,
  EmptyState,
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
import { NextLink } from '@/components/next-link';
import { RestrictedPage } from '@/components/restricted-page';
import {
  VerificationStatusBadge,
  VerificationTypeBadge,
} from '@/components/verification/verification-parts';
import { QUEUE_SORT_LABELS, QUEUE_SORTS } from '@/lib/applications';
import { optionsFrom } from '@/lib/member-labels';
import { firstParam, offsetParam, type SearchParams, toQueryString } from '@/lib/search-params';
import { formatDate, formatRelative } from '@/lib/time';
import {
  capabilityLabelFor,
  VERIFICATION_SCOPE_LABELS,
  VERIFICATION_SCOPES,
  VERIFICATION_STATUS_FILTER_LABELS,
  VERIFICATION_STATUS_FILTERS,
  VERIFICATION_TYPE_LABELS,
  VERIFICATION_TYPES,
  verificationStatusesFor,
  verificationTargetLine,
} from '@/lib/verification';
import { requireConsoleContext } from '@/server/context';
import { loadVerificationQueueCounts } from '@/server/data/queue-counts';
import { loadViewer } from '@/server/data/viewer';
import { guarded } from '@/server/guard';

export const metadata: Metadata = { title: 'Verification' };

const PAGE_SIZE = 25;
const STAFF_COLUMNS = 6;
const MEMBER_COLUMNS = 4;

const filterSchema = z.object({
  status: z.enum(VERIFICATION_STATUS_FILTERS).catch('open'),
  type: z
    .enum(VERIFICATION_TYPES as [string, ...string[]])
    .optional()
    .catch(undefined),
  scope: z.enum(VERIFICATION_SCOPES).catch('all'),
  sort: z.enum(QUEUE_SORTS).catch('oldest'),
});

export default async function VerificationPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { ctx, actor } = await requireConsoleContext();
  const staff = can(ctx, 'canVerifyMembers');
  if (!staff && !actor.memberId)
    return <RestrictedPage eyebrow="PEOPLE" title="Verification" capability="canVerifyMembers" />;
  const params = await searchParams;
  const filters = filterSchema.parse({
    status: firstParam(params.status) || undefined,
    type: firstParam(params.type) || undefined,
    scope: firstParam(params.scope) || undefined,
    sort: firstParam(params.sort) || (staff ? undefined : 'newest'),
  });
  const offset = offsetParam(params.offset);
  const type = VERIFICATION_TYPES.find((candidate) => candidate === filters.type);

  const result = await guarded(() =>
    Promise.all([
      verification.listVerifications(ctx, {
        status: verificationStatusesFor(filters.status),
        type,
        assignedToMe: staff && filters.scope === 'mine' ? true : undefined,
        unassigned: staff && filters.scope === 'unassigned' ? true : undefined,
        sort: filters.sort,
        limit: PAGE_SIZE,
        offset,
      }),
      staff ? loadVerificationQueueCounts(ctx) : null,
    ]),
  );
  if (!result.ok)
    return <RestrictedPage eyebrow="PEOPLE" title="Verification" capability="canVerifyMembers" />;
  const [page, counts] = result.value;
  const [viewer, catalog] = await Promise.all([loadViewer(ctx), loadCatalog(ctx)]);
  const targetLine = (item: verification.VerificationSummary) =>
    verificationTargetLine(item, capabilityLabelFor(catalog, item.facetKey));
  const now = ctx.clock.now();
  const defaultSort = staff ? 'oldest' : 'newest';
  const filtered = Boolean(filters.status !== 'open' || filters.type || filters.scope !== 'all');
  const query = {
    status: filters.status === 'open' ? undefined : filters.status,
    type: filters.type,
    scope: filters.scope === 'all' ? undefined : filters.scope,
    sort: filters.sort === defaultSort ? undefined : filters.sort,
  };
  const columns = staff ? STAFF_COLUMNS : MEMBER_COLUMNS;
  const tiles = counts
    ? [
        {
          label: 'PENDING',
          value: counts.pending,
          hint: 'Waiting for a verifier',
          href: '/verification?status=pending',
        },
        {
          label: 'IN REVIEW',
          value: counts.inReview,
          hint: 'A verifier is on it',
          href: '/verification?status=in_review',
        },
        {
          label: 'UNASSIGNED',
          value: counts.unassigned,
          hint: 'Open, nobody assigned',
          href: '/verification?scope=unassigned',
        },
        {
          label: 'ASSIGNED TO YOU',
          value: counts.assignedToMe,
          hint: 'Open, yours to decide',
          href: '/verification?scope=mine',
        },
      ]
    : [];

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="PEOPLE"
        title="Verification"
        description={
          staff
            ? 'Claims moving from CLAIMED to VERIFIED. Nobody verifies themselves; a request opened by staff needs a second verifier.'
            : 'Your requests to move a claim from CLAIMED to VERIFIED. Open one in Discord with /verify request.'
        }
        meta={
          <Mono dim>
            {page.total.toLocaleString('en-US')} {filtered ? 'matching' : 'open'}
          </Mono>
        }
      />

      {tiles.length > 0 ? (
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
      ) : null}

      <Card padding="none">
        <form
          method="get"
          action="/verification"
          role="search"
          aria-label="Filter verifications"
          className="border-b border-line-subtle p-4"
        >
          <Toolbar
            className={cx(
              'grid grid-cols-2 gap-2.5',
              staff
                ? 'md:grid-cols-4 xl:grid-cols-[repeat(4,minmax(0,1fr))_auto]'
                : 'md:grid-cols-[repeat(3,minmax(0,1fr))_auto]',
            )}
          >
            <NativeSelect
              name="status"
              aria-label="Status"
              defaultValue={filters.status}
              options={optionsFrom(VERIFICATION_STATUS_FILTER_LABELS)}
            />
            <NativeSelect
              name="type"
              aria-label="Type"
              defaultValue={filters.type ?? ''}
              placeholder="Any type"
              options={optionsFrom(VERIFICATION_TYPE_LABELS)}
            />
            {staff ? (
              <NativeSelect
                name="scope"
                aria-label="Verifier"
                defaultValue={filters.scope}
                options={optionsFrom(VERIFICATION_SCOPE_LABELS)}
              />
            ) : null}
            <NativeSelect
              name="sort"
              aria-label="Sort"
              defaultValue={filters.sort}
              options={optionsFrom(QUEUE_SORT_LABELS)}
            />
            <div
              className={cx(
                'col-span-2 flex gap-2',
                staff ? 'md:col-span-4 xl:col-span-1' : 'md:col-span-1',
              )}
            >
              <Button type="submit" variant="primary" className="flex-1 md:flex-none">
                Apply
              </Button>
              {filtered ? (
                <Link href="/verification" className={buttonStyles({ variant: 'ghost' })}>
                  Reset
                </Link>
              ) : null}
            </div>
          </Toolbar>
        </form>

        {page.total === 0 && !filtered ? (
          <EmptyState
            icon={ShieldCheck}
            title={staff ? 'QUEUE CLEAR' : 'NO OPEN REQUESTS'}
            description={
              staff
                ? 'No verification is waiting. New requests appear here and in the queue channel.'
                : 'Put a claim forward in Discord with /verify request. A verifier who is not you decides.'
            }
            action={
              staff ? undefined : (
                <Link
                  href="/verification?status=all"
                  className={buttonStyles({ variant: 'secondary', size: 'sm' })}
                >
                  Show closed requests
                </Link>
              )
            }
          />
        ) : (
          <Table caption="Verifications">
            <TableHead>
              <tr>
                <TableHeaderCell>Verification</TableHeaderCell>
                {staff ? (
                  <TableHeaderCell className="hidden md:table-cell">Subject</TableHeaderCell>
                ) : null}
                <TableHeaderCell className="hidden sm:table-cell">Target</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                {staff ? (
                  <TableHeaderCell className="hidden lg:table-cell">Verifier</TableHeaderCell>
                ) : null}
                <TableHeaderCell className="hidden sm:table-cell text-right">
                  Requested
                </TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {page.items.length === 0 ? (
                <TableEmptyRow
                  colSpan={columns}
                  title="NO MATCHES"
                  description="No verification matches these filters."
                  action={
                    <Link href="/verification" className={buttonStyles({ size: 'sm' })}>
                      Clear filters
                    </Link>
                  }
                />
              ) : (
                page.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <Link href={`/verification/${item.id}`} className="row-link block min-w-0">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="type-data text-body text-fg">{item.reference}</span>
                          <VerificationTypeBadge type={item.type} />
                        </span>
                        <span className="mt-1 block truncate text-small text-fg-muted sm:hidden">
                          {targetLine(item)}
                        </span>
                        {staff ? (
                          <span className="mt-0.5 block truncate text-small text-fg-subtle md:hidden">
                            {item.subject.displayName}{' '}
                            <Mono dim className="text-[12px]">
                              @{item.subject.handle}
                            </Mono>
                          </span>
                        ) : null}
                      </Link>
                    </TableCell>
                    {staff ? (
                      <TableCell className="hidden md:table-cell">
                        <span className="block truncate text-small text-fg">
                          {item.subject.displayName}
                        </span>
                        <Mono dim className="text-[12px]">
                          @{item.subject.handle}
                        </Mono>
                      </TableCell>
                    ) : null}
                    <TableCell className="hidden max-w-72 sm:table-cell">
                      <span className="block truncate text-small text-fg-muted">
                        {targetLine(item)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <VerificationStatusBadge status={item.status} />
                    </TableCell>
                    {staff ? (
                      <TableCell className="hidden lg:table-cell">
                        {item.assignedVerifier ? (
                          <span className="text-small text-fg-muted">
                            {item.assignedVerifier.name}
                          </span>
                        ) : (
                          <span className="type-eyebrow text-fg-subtle">UNASSIGNED</span>
                        )}
                      </TableCell>
                    ) : null}
                    <TableCell className="hidden sm:table-cell text-right">
                      <Mono dim title={formatDate(item.requestedAt, viewer.timeZone)}>
                        {formatRelative(item.requestedAt, now, viewer.timeZone)}
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
                `/verification${toQueryString({ ...query, offset: next || undefined })}`
              }
            />
          </div>
        ) : null}
      </Card>
    </div>
  );
}
