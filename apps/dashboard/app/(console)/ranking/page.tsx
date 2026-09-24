import type { Metadata } from 'next';
import Link from 'next/link';
import { ChartNoAxesColumn } from 'lucide-react';
import { loadCatalog, rankingBoard } from '@jave/core';
import {
  Avatar,
  Card,
  cx,
  EmptyState,
  Mono,
  PageHeader,
  RailActiveIntoView,
  RankBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@jave/ui';
import { RestrictedPage } from '@/components/restricted-page';
import { firstParam, type SearchParams } from '@/lib/search-params';
import { formatDate } from '@/lib/time';
import { requireConsoleContext } from '@/server/context';
import { loadViewer } from '@/server/data/viewer';
import { guarded } from '@/server/guard';

export const metadata: Metadata = { title: 'Ranking' };

const BOARD_LIMIT = 50;
const POSITION_DIGITS = 2;

function Legend() {
  return (
    <dl className="grid gap-px overflow-hidden rounded-lg border border-line bg-line-subtle sm:grid-cols-3">
      <div className="bg-surface p-4">
        <dt>
          <RankBadge verifiedRank="A" size="sm" label="always" />
        </dt>
        <dd className="mt-2.5 text-small text-fg-subtle">
          Set by an evaluator after demonstrated work, with a recorded reason. Only verified ranks
          are ranked.
        </dd>
      </div>
      <div className="bg-surface p-4">
        <dt>
          <RankBadge claimedRank="A" size="sm" />
        </dt>
        <dd className="mt-2.5 text-small text-fg-subtle">
          Self-reported. Shown on profiles as a claim — never on a board, never counted.
        </dd>
      </div>
      <div className="bg-surface p-4">
        <dt>
          <RankBadge size="sm" />
        </dt>
        <dd className="mt-2.5 text-small text-fg-subtle">
          No evidence either way yet. Not the same as low.
        </dd>
      </div>
    </dl>
  );
}

export default async function RankingPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { ctx } = await requireConsoleContext();
  const catalog = await loadCatalog(ctx);
  const requested = firstParam((await searchParams).facet);
  const facet =
    catalog.facets.find((candidate) => candidate.key === requested) ?? catalog.facets[0];
  if (!facet) {
    return (
      <>
        <PageHeader eyebrow="PEOPLE" title="Ranking" />
        <EmptyState
          title="NO CAPABILITY CATALOG"
          description="Run the database migration to load rank tiers and facets."
        />
      </>
    );
  }
  const board = await guarded(() => rankingBoard(ctx, facet.key, BOARD_LIMIT));
  if (!board.ok)
    return <RestrictedPage eyebrow="PEOPLE" title="Ranking" capability="canViewMembers" />;
  const viewer = await loadViewer(ctx);
  const domain = catalog.domains.find((candidate) => candidate.key === facet.domainKey);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="PEOPLE"
        title="Ranking"
        description="One board per facet, ordered by VERIFIED rank. There is no global score and no total across domains — capability is multidimensional."
      />
      <Legend />
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="Facets" className="min-w-0 lg:sticky lg:top-20 lg:self-start">
          <ul className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 [scrollbar-width:none] max-lg:scroll-fade-x max-lg:pr-8 lg:mx-0 lg:flex-col lg:gap-0 lg:overflow-visible lg:px-0">
            {catalog.domains.map((group) => (
              <li key={group.key} className="flex shrink-0 gap-1 lg:mb-4 lg:block">
                <p className="type-eyebrow hidden px-2.5 pb-1.5 text-[10px] text-fg-subtle lg:block">
                  {group.label}
                </p>
                <ul className="flex gap-1 lg:block lg:space-y-px">
                  {catalog.facets
                    .filter((candidate) => candidate.domainKey === group.key)
                    .map((candidate) => {
                      const active = candidate.key === facet.key;
                      return (
                        <li key={candidate.key} className="shrink-0">
                          <Link
                            href={`/ranking?facet=${encodeURIComponent(candidate.key)}`}
                            aria-current={active ? 'page' : undefined}
                            className={cx(
                              'flex h-8 items-center gap-1 whitespace-nowrap rounded-md border px-2.5 text-small transition-colors lg:border-transparent',
                              active
                                ? 'border-line-strong bg-surface-raised text-fg'
                                : 'border-line text-fg-subtle hover:bg-surface-raised/60 hover:text-fg',
                            )}
                          >
                            <span className="text-fg-subtle lg:hidden">{`${group.label} ·`}</span>
                            {candidate.label}
                          </Link>
                        </li>
                      );
                    })}
                </ul>
              </li>
            ))}
          </ul>
          <RailActiveIntoView activeKey={facet.key} />
        </nav>

        <Card padding="none">
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line-subtle px-5 py-4">
            <div>
              <p className="type-eyebrow text-fg-subtle">{domain?.label ?? facet.domainKey}</p>
              <h2 className="type-heading mt-1 text-fg">{facet.label}</h2>
              <p className="mt-1 text-small text-fg-subtle">{facet.description}</p>
            </div>
            <Mono dim>{board.value.length} verified</Mono>
          </div>
          {board.value.length === 0 ? (
            <EmptyState
              icon={ChartNoAxesColumn}
              title="NO VERIFIED RANKS YET"
              description={`Nobody holds a VERIFIED ${facet.label} rank yet. Claims do not appear here.`}
            />
          ) : (
            <Table caption={`${facet.label} board`}>
              <TableHead>
                <tr>
                  <TableHeaderCell className="w-14">#</TableHeaderCell>
                  <TableHeaderCell>Member</TableHeaderCell>
                  <TableHeaderCell>Rank</TableHeaderCell>
                  <TableHeaderCell className="hidden text-right sm:table-cell">
                    Verified
                  </TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {board.value.map((row, index) => (
                  <TableRow key={row.memberId} className="relative">
                    <TableCell>
                      <Mono dim>{String(index + 1).padStart(POSITION_DIGITS, '0')}</Mono>
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/members/${row.memberId}`}
                        className="flex min-w-0 items-center gap-3 after:absolute after:inset-0"
                      >
                        <Avatar name={row.displayName} size="sm" />
                        <span className="min-w-0">
                          <span className="block truncate text-body text-fg">
                            {row.displayName}
                          </span>
                          <span className="type-data block truncate text-[12px] text-fg-subtle">
                            @{row.handle}
                          </span>
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <RankBadge verifiedRank={row.verifiedRank} size="md" />
                    </TableCell>
                    <TableCell className="hidden text-right sm:table-cell">
                      <Mono dim>
                        {row.verifiedAt ? formatDate(row.verifiedAt, viewer.timeZone) : '—'}
                      </Mono>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}
