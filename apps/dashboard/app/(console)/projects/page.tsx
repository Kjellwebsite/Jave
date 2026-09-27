import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { FolderKanban, LayoutGrid, List, Plus, Search } from 'lucide-react';
import { z } from 'zod';
import { loadCatalog, projects } from '@jave/core';
import {
  Button,
  buttonStyles,
  Card,
  cx,
  EmptyState,
  Icon,
  Input,
  LinkTabs,
  Mono,
  NativeSelect,
  PageHeader,
  Pagination,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  Toolbar,
} from '@jave/ui';
import { NextLink } from '@/components/next-link';
import { ProjectCard, type ProjectCardData } from '@/components/projects/project-card';
import { ProjectStatusBadge, VisibilityBadge } from '@/components/projects/status-pipeline';
import { optionsFrom } from '@/lib/member-labels';
import {
  PROJECT_SORT_LABELS,
  PROJECT_STATUS_LABELS,
  projectPath,
  type ProjectSortKey,
  type ProjectStatusKey,
} from '@/lib/project-view';
import { firstParam, offsetParam, type SearchParams, toQueryString } from '@/lib/search-params';
import { formatDate } from '@/lib/time';
import { requireConsoleContext } from '@/server/context';
import { loadViewer } from '@/server/data/viewer';

export const metadata: Metadata = { title: 'Projects' };

const PAGE_SIZE = 24;
const DEFAULT_SORT: ProjectSortKey = 'updated_desc';
const SCOPE_OPTIONS = [
  { value: 'all', label: 'All projects' },
  { value: 'mine', label: 'My projects' },
];

const filterSchema = z.object({
  q: projects.listProjectsSchema.shape.search.catch(undefined),
  status: projects.listProjectsSchema.shape.status.catch(undefined),
  scope: z.enum(['all', 'mine']).catch('all'),
  sort: z.enum(['updated_desc', 'created_desc', 'title']).catch(DEFAULT_SORT),
  view: z.enum(['grid', 'list']).catch('grid'),
});

type Filters = z.infer<typeof filterSchema>;

function hrefFor(filters: Filters, patch: Partial<Filters> & { offset?: number }): string {
  const next = { ...filters, ...patch };
  return `/projects${toQueryString({
    q: next.q,
    status: next.status,
    scope: next.scope === 'all' ? undefined : next.scope,
    sort: next.sort === DEFAULT_SORT ? undefined : next.sort,
    view: next.view === 'grid' ? undefined : next.view,
    offset: patch.offset || undefined,
  })}`;
}

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { ctx } = await requireConsoleContext();
  const params = await searchParams;
  const filters = filterSchema.parse({
    q: firstParam(params.q)?.trim() || undefined,
    status: firstParam(params.status) || undefined,
    scope: firstParam(params.scope) || undefined,
    sort: firstParam(params.sort) || undefined,
    view: firstParam(params.view) || undefined,
  });
  const offset = offsetParam(params.offset);
  const memberId = ctx.actor.memberId ?? undefined;
  const mine = filters.scope === 'mine';

  const [page, catalog, viewer] = await Promise.all([
    mine && !memberId
      ? Promise.resolve({ items: [], total: 0, limit: PAGE_SIZE, offset })
      : projects.listProjects(ctx, {
          search: filters.q,
          status: filters.status,
          memberId: mine ? memberId : undefined,
          sort: filters.sort,
          limit: PAGE_SIZE,
          offset,
        }),
    loadCatalog(ctx),
    loadViewer(ctx),
  ]);
  const domainLabels = new Map(catalog.domains.map((domain) => [domain.key, domain.label]));
  const filtered = Boolean(filters.q || mine);
  const cards: ProjectCardData[] = page.items.map((project) => ({
    slug: project.slug,
    title: project.title,
    summary: project.summary,
    status: project.status,
    visibility: project.visibility,
    domainLabel: project.domainKey ? (domainLabels.get(project.domainKey) ?? null) : null,
    githubRepo: project.githubRepo,
    ownerName: project.owner?.displayName ?? null,
    memberCount: project.memberCount,
    updatedLabel: formatDate(project.updatedAt, viewer.timeZone),
  }));

  const statusTabs: { key: ProjectStatusKey | undefined; label: string }[] = [
    { key: undefined, label: 'Active' },
    ...projects.PROJECT_STATUSES.map((status) => ({
      key: status,
      label: PROJECT_STATUS_LABELS[status],
    })),
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="OPERATIONS"
        title="Projects"
        description="Shipped work, from idea to release. Status is declared by the team; contributions count once someone else verifies them."
        meta={
          <Mono dim>
            {page.total.toLocaleString('en-US')}{' '}
            {filtered || filters.status ? 'matching' : 'active'}
          </Mono>
        }
        actions={
          memberId ? (
            <Link href="/projects/new" className={buttonStyles({ variant: 'primary' })}>
              <Icon icon={Plus} size="md" />
              Start project
            </Link>
          ) : null
        }
      />

      <LinkTabs
        label="Project status"
        linkComponent={NextLink}
        tabs={statusTabs.map((tab) => ({
          href: hrefFor(filters, { status: tab.key }),
          label: tab.label,
          active: filters.status === tab.key,
        }))}
      />

      <form
        method="get"
        action="/projects"
        role="search"
        aria-label="Filter projects"
        className="rounded-lg border border-line bg-surface p-4"
      >
        {filters.status ? <input type="hidden" name="status" value={filters.status} /> : null}
        {filters.view === 'list' ? <input type="hidden" name="view" value="list" /> : null}
        <Toolbar className="grid grid-cols-2 gap-2.5 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_auto_auto]">
          <label className="relative col-span-2 min-w-0 md:col-span-1">
            <span className="sr-only">Search projects</span>
            <Icon
              icon={Search}
              size="sm"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle"
            />
            <Input
              name="q"
              type="search"
              defaultValue={filters.q ?? ''}
              placeholder="Title, summary or slug"
              maxLength={64}
              className="pl-8"
            />
          </label>
          <NativeSelect
            name="scope"
            aria-label="Scope"
            defaultValue={filters.scope}
            options={SCOPE_OPTIONS}
          />
          <NativeSelect
            name="sort"
            aria-label="Sort"
            defaultValue={filters.sort}
            options={optionsFrom(PROJECT_SORT_LABELS)}
          />
          <div className="col-span-2 flex gap-2 md:col-span-1">
            <Button type="submit" variant="secondary" className="flex-1 md:flex-none">
              Apply
            </Button>
            {filtered ? (
              <Link
                href={hrefFor(filters, { q: undefined, scope: 'all' })}
                className={buttonStyles({ variant: 'ghost' })}
              >
                Reset
              </Link>
            ) : null}
          </div>
          <div
            role="group"
            aria-label="Layout"
            className="col-span-2 flex justify-end gap-1 md:col-span-1"
          >
            <ViewLink href={hrefFor(filters, { view: 'grid' })} active={filters.view === 'grid'}>
              <Icon icon={LayoutGrid} size="sm" label="Grid" />
            </ViewLink>
            <ViewLink href={hrefFor(filters, { view: 'list' })} active={filters.view === 'list'}>
              <Icon icon={List} size="sm" label="List" />
            </ViewLink>
          </div>
        </Toolbar>
      </form>

      {page.total === 0 ? (
        <Card padding="none">
          <EmptyState
            icon={FolderKanban}
            title={filtered || filters.status ? 'NO MATCHES' : 'NO PROJECTS YET'}
            description={
              filtered || filters.status
                ? 'No project you can see matches these filters.'
                : 'Projects appear here when members start them. Private projects stay with their teams.'
            }
            action={
              filtered || filters.status ? (
                <Link href="/projects" className={buttonStyles({ size: 'sm' })}>
                  Clear filters
                </Link>
              ) : memberId ? (
                <Link href="/projects/new" className={buttonStyles({ size: 'sm' })}>
                  Start project
                </Link>
              ) : null
            }
          />
        </Card>
      ) : filters.view === 'grid' ? (
        <ul aria-label="Projects" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {cards.map((card) => (
            <li key={card.slug} className="flex">
              <ProjectCard project={card} />
            </li>
          ))}
        </ul>
      ) : (
        <Card padding="none">
          <ProjectTable cards={cards} />
        </Card>
      )}

      {page.total > PAGE_SIZE ? (
        <Pagination
          offset={page.offset}
          limit={page.limit}
          total={page.total}
          linkComponent={NextLink}
          hrefForOffset={(next) => hrefFor(filters, { offset: next })}
        />
      ) : null}
    </div>
  );
}

function ViewLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'true' : undefined}
      className={cx(
        buttonStyles({ variant: 'ghost', size: 'md' }),
        'w-9 px-0',
        active && 'bg-surface-raised text-fg',
      )}
    >
      {children}
    </Link>
  );
}

function ProjectTable({ cards }: { cards: readonly ProjectCardData[] }) {
  return (
    <Table caption="Projects">
      <TableHead>
        <tr>
          <TableHeaderCell>Project</TableHeaderCell>
          <TableHeaderCell>Status</TableHeaderCell>
          <TableHeaderCell className="hidden md:table-cell">Owner</TableHeaderCell>
          <TableHeaderCell className="hidden sm:table-cell text-right">Team</TableHeaderCell>
          <TableHeaderCell className="hidden md:table-cell text-right">Updated</TableHeaderCell>
        </tr>
      </TableHead>
      <TableBody>
        {cards.map((card) => (
          <TableRow key={card.slug} className="relative" data-project={card.slug}>
            <TableCell>
              <Link
                href={projectPath(card.slug)}
                className="block min-w-0 after:absolute after:inset-0 focus-visible:outline-none"
              >
                <span className="block truncate text-body font-medium text-fg">{card.title}</span>
                <span className="mt-1 flex items-center gap-2">
                  <VisibilityBadge visibility={card.visibility} />
                  <Mono dim className="truncate text-[12px]">
                    {card.slug}
                  </Mono>
                </span>
              </Link>
            </TableCell>
            <TableCell>
              <ProjectStatusBadge status={card.status} />
            </TableCell>
            <TableCell className="hidden text-fg-muted md:table-cell">
              {card.ownerName ?? '—'}
            </TableCell>
            <TableCell className="hidden text-right sm:table-cell">
              <Mono>{card.memberCount}</Mono>
            </TableCell>
            <TableCell className="hidden text-right md:table-cell">
              <Mono dim>{card.updatedLabel}</Mono>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
