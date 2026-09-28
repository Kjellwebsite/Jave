import type { Metadata } from 'next';
import Link from 'next/link';
import { FlaskConical, Search } from 'lucide-react';
import { z } from 'zod';
import { research } from '@jave/core';
import {
  Badge,
  Button,
  buttonStyles,
  Card,
  EmptyState,
  Icon,
  Input,
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
} from '@jave/ui';
import { NextLink } from '@/components/next-link';
import { AddReferenceDialog } from '@/components/research/add-reference-dialog';
import { RestrictedPage } from '@/components/restricted-page';
import { optionsFrom } from '@/lib/member-labels';
import {
  EVIDENCE_LABELS,
  RESEARCH_STATUS_LABELS,
  RESEARCH_STATUS_TONE,
  SIDUS_INTEGRATION_LABELS,
  SIDUS_INTEGRATION_TONE,
  SIDUS_SYNC_LABELS,
  SIDUS_SYNC_TONE,
  sidusIntegrationState,
} from '@/lib/research-labels';
import { firstParam, offsetParam, type SearchParams, toQueryString } from '@/lib/search-params';
import { formatDate } from '@/lib/time';
import { getIntegrations } from '@/server/ai';
import { requireConsoleContext } from '@/server/context';
import { loadViewer } from '@/server/data/viewer';
import { guarded } from '@/server/guard';
import { addResearchAction } from './actions';

export const metadata: Metadata = { title: 'Research' };

const PAGE_SIZE = 25;
const COLUMNS = 5;
const SCOPE_LABELS = { all: 'Everyone', mine: 'My submissions' } as const;

const filterSchema = z.object({
  q: research.listResearchSchema.shape.q.catch(undefined),
  status: research.listResearchSchema.shape.status.catch(undefined),
  topic: research.listResearchSchema.shape.topic.catch(undefined),
  tag: research.listResearchSchema.shape.tag.catch(undefined),
  scope: z.enum(['all', 'mine']).catch('all'),
});

export default async function ResearchPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { ctx } = await requireConsoleContext();
  const params = await searchParams;
  const filters = filterSchema.parse({
    q: firstParam(params.q) || undefined,
    status: firstParam(params.status) || undefined,
    topic: firstParam(params.topic) || undefined,
    tag: firstParam(params.tag) || undefined,
    scope: firstParam(params.scope) || undefined,
  });
  const offset = offsetParam(params.offset);
  const result = await guarded(() =>
    research.listResearchItems(ctx, {
      q: filters.q,
      status: filters.status,
      topic: filters.topic,
      tag: filters.tag,
      mine: filters.scope === 'mine',
      limit: PAGE_SIZE,
      offset,
    }),
  );
  if (!result.ok)
    return <RestrictedPage eyebrow="INTELLIGENCE" title="Research" capability="canViewMembers" />;
  const page = result.value;
  const viewer = await loadViewer(ctx);
  const sidus = sidusIntegrationState(getIntegrations());
  const filtered = Boolean(
    filters.q || filters.status || filters.topic || filters.tag || filters.scope === 'mine',
  );
  const query = {
    q: filters.q,
    status: filters.status,
    topic: filters.topic,
    tag: filters.tag,
    scope: filters.scope === 'all' ? undefined : filters.scope,
  };

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="INTELLIGENCE"
        title="Research"
        description="The SIDUS SCIENCE library: references members save from Discord or add here, reviewed for status and evidence level. Verified items can be pushed to Sidus."
        meta={
          <>
            <Mono dim>
              {page.total.toLocaleString('en-US')} {filtered ? 'matching' : 'items'}
            </Mono>
            <StatusBadge
              tone={SIDUS_INTEGRATION_TONE[sidus]}
              quiet={sidus === 'configured'}
              label={SIDUS_INTEGRATION_LABELS[sidus].toUpperCase()}
            />
          </>
        }
        actions={
          ctx.actor.standing === 'good' ? <AddReferenceDialog action={addResearchAction} /> : null
        }
      />

      <Card padding="none">
        <form
          method="get"
          action="/research"
          role="search"
          aria-label="Filter research"
          className="border-b border-line-subtle p-4"
        >
          <Toolbar className="grid grid-cols-2 gap-2.5 md:grid-cols-4 xl:grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,1fr))_auto]">
            <label className="relative col-span-2 min-w-0 md:col-span-4 xl:col-span-1">
              <span className="sr-only">Search research</span>
              <Icon
                icon={Search}
                size="sm"
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle"
              />
              <Input
                name="q"
                type="search"
                defaultValue={filters.q ?? ''}
                placeholder="Title, summary or DOI"
                maxLength={100}
                className="pl-8"
              />
            </label>
            <NativeSelect
              name="status"
              aria-label="Status"
              defaultValue={filters.status ?? ''}
              placeholder="Any status"
              options={optionsFrom(RESEARCH_STATUS_LABELS)}
            />
            <Input
              name="topic"
              defaultValue={filters.topic ?? ''}
              placeholder="Topic"
              aria-label="Topic"
              maxLength={80}
            />
            <Input
              name="tag"
              defaultValue={filters.tag ?? ''}
              placeholder="Tag"
              aria-label="Tag"
              maxLength={32}
            />
            <NativeSelect
              name="scope"
              aria-label="Submitted by"
              defaultValue={filters.scope}
              options={optionsFrom(SCOPE_LABELS)}
            />
            <div className="col-span-2 flex gap-2 md:col-span-4 xl:col-span-1">
              <Button type="submit" variant="primary" className="flex-1 xl:flex-none">
                Apply
              </Button>
              {filtered ? (
                <Link href="/research" className={buttonStyles({ variant: 'ghost' })}>
                  Reset
                </Link>
              ) : null}
            </div>
          </Toolbar>
        </form>

        {page.total === 0 && !filtered ? (
          <EmptyState
            icon={FlaskConical}
            title="THE LIBRARY IS EMPTY"
            description="Right-click a message with a paper link in Discord → Apps → Save to Sidus, or add a reference here."
          />
        ) : (
          <Table caption="Research items">
            <TableHead>
              <tr>
                <TableHeaderCell>Reference</TableHeaderCell>
                <TableHeaderCell className="hidden sm:table-cell">Status</TableHeaderCell>
                <TableHeaderCell className="hidden md:table-cell">Evidence</TableHeaderCell>
                <TableHeaderCell className="hidden lg:table-cell">Sidus</TableHeaderCell>
                <TableHeaderCell className="hidden text-right sm:table-cell">Added</TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {page.items.length === 0 ? (
                <TableEmptyRow
                  colSpan={COLUMNS}
                  title="NO MATCHES"
                  description="No item matches these filters."
                  action={
                    <Link href="/research" className={buttonStyles({ size: 'sm' })}>
                      Clear filters
                    </Link>
                  }
                />
              ) : (
                page.items.map((item) => (
                  <TableRow key={item.id} className="relative" data-research-item={item.id}>
                    <TableCell>
                      <Link
                        href={`/research/${item.id}`}
                        className="row-link block min-w-0"
                      >
                        <span className="line-clamp-2 text-body font-medium text-fg">
                          {item.title}
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-small text-fg-subtle">
                          {item.authors.length > 0 ? (
                            <span className="truncate">
                              {item.authors.slice(0, 3).join(', ')}
                              {item.authors.length > 3 ? ' et al.' : ''}
                            </span>
                          ) : null}
                          {item.doi ? (
                            <Mono dim className="text-[12px]">
                              {item.doi}
                            </Mono>
                          ) : null}
                          {!item.doi && item.arxivId ? (
                            <Mono dim className="text-[12px]">
                              arXiv:{item.arxivId}
                            </Mono>
                          ) : null}
                          {item.topic ? <Badge>{item.topic}</Badge> : null}
                        </span>
                        <span className="mt-2 block sm:hidden">
                          <StatusBadge
                            tone={RESEARCH_STATUS_TONE[item.status]}
                            label={RESEARCH_STATUS_LABELS[item.status].toUpperCase()}
                          />
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <StatusBadge
                        tone={RESEARCH_STATUS_TONE[item.status]}
                        label={RESEARCH_STATUS_LABELS[item.status].toUpperCase()}
                      />
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap md:table-cell">
                      <span className="type-eyebrow text-fg-muted">
                        {EVIDENCE_LABELS[item.evidenceLevel]}
                      </span>
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap lg:table-cell">
                      <StatusBadge
                        quiet
                        tone={SIDUS_SYNC_TONE[item.sidusSyncStatus]}
                        label={SIDUS_SYNC_LABELS[item.sidusSyncStatus].toUpperCase()}
                      />
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap text-right sm:table-cell">
                      <Mono dim>{formatDate(item.createdAt, viewer.timeZone)}</Mono>
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
                `/research${toQueryString({ ...query, offset: next || undefined })}`
              }
            />
          </div>
        ) : null}
      </Card>
    </div>
  );
}
