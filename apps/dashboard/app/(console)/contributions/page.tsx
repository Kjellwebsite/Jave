import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';
import { can, projects } from '@jave/core';
import {
  Button,
  buttonStyles,
  Card,
  LinkTabs,
  Mono,
  NativeSelect,
  PageHeader,
  Pagination,
  Toolbar,
} from '@jave/ui';
import { ContributionList } from '@/components/contributions/contribution-list';
import { RecordContributionDialog } from '@/components/contributions/record-contribution-dialog';
import { NextLink } from '@/components/next-link';
import { optionsFrom } from '@/lib/member-labels';
import { CONTRIBUTION_KIND_LABELS, CONTRIBUTION_STATUS_LABELS } from '@/lib/project-view';
import { firstParam, offsetParam, type SearchParams, toQueryString } from '@/lib/search-params';
import { requireConsoleContext } from '@/server/context';
import { loadViewer } from '@/server/data/viewer';
import { contributionRows } from '@/server/projects/rows';
import {
  recordContributionAction,
  rejectContributionAction,
  verifyContributionAction,
} from './actions';

export const metadata: Metadata = { title: 'Contributions' };

const PAGE_SIZE = 25;
/** Projects offered in the record dialog (the viewer's own). */
const MY_PROJECTS_LIMIT = 50;
const VIEWS = ['queue', 'mine', 'verified'] as const;
type View = (typeof VIEWS)[number];

const VIEW_LABELS: Record<View, string> = {
  queue: 'Review queue',
  mine: 'Mine',
  verified: 'Verified',
};

const filterSchema = z.object({
  view: z.enum(VIEWS).optional().catch(undefined),
  kind: projects.listContributionsSchema.shape.kind.catch(undefined),
  status: projects.listContributionsSchema.shape.status.catch(undefined),
});

export default async function ContributionsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { ctx } = await requireConsoleContext();
  const params = await searchParams;
  const parsed = filterSchema.parse({
    view: firstParam(params.view) || undefined,
    kind: firstParam(params.kind) || undefined,
    status: firstParam(params.status) || undefined,
  });
  const reviewer = can(ctx, 'canVerifyContributions');
  const view: View = parsed.view ?? (reviewer ? 'queue' : 'mine');
  const offset = offsetParam(params.offset);
  const memberId = ctx.actor.memberId;

  const status = view === 'queue' ? 'submitted' : view === 'verified' ? 'verified' : parsed.status;
  const [page, viewer, mine] = await Promise.all([
    view === 'mine' && !memberId
      ? Promise.resolve({ items: [], total: 0, limit: PAGE_SIZE, offset })
      : projects.listContributions(ctx, {
          status,
          kind: parsed.kind,
          memberId: view === 'mine' ? (memberId ?? undefined) : undefined,
          limit: PAGE_SIZE,
          offset,
        }),
    loadViewer(ctx),
    memberId
      ? projects.listProjects(ctx, { memberId, limit: MY_PROJECTS_LIMIT, sort: 'title' })
      : Promise.resolve({ items: [], total: 0, limit: MY_PROJECTS_LIMIT, offset: 0 }),
  ]);
  const rows = contributionRows(page.items, viewer.memberId, viewer.timeZone);
  const href = (patch: { view?: View; offset?: number }) =>
    `/contributions${toQueryString({
      view: patch.view ?? view,
      kind: parsed.kind,
      status: (patch.view ?? view) === 'mine' ? parsed.status : undefined,
      offset: patch.offset || undefined,
    })}`;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="OPERATIONS"
        title="Contributions"
        description="Recorded work becomes VERIFIED only when someone else vouches for it: staff, a project owner or maintainer, or a merged pull request by a verified GitHub account."
        meta={
          <Mono dim>
            {page.total.toLocaleString('en-US')} {view === 'queue' ? 'awaiting review' : 'shown'}
          </Mono>
        }
        actions={
          memberId ? (
            <RecordContributionDialog
              action={recordContributionAction}
              variant="primary"
              projects={mine.items
                .filter((project) => project.status !== 'archived')
                .map((project) => ({ id: project.id, title: project.title }))}
            />
          ) : null
        }
      />

      <LinkTabs
        label="Contribution views"
        linkComponent={NextLink}
        tabs={VIEWS.map((key) => ({
          href: `/contributions?view=${key}`,
          label: VIEW_LABELS[key],
          active: key === view,
        }))}
      />

      <Card padding="none">
        <form
          method="get"
          action="/contributions"
          aria-label="Filter contributions"
          className="border-b border-line-subtle p-4"
        >
          <input type="hidden" name="view" value={view} />
          <Toolbar className="grid grid-cols-2 gap-2.5 sm:flex">
            <NativeSelect
              name="kind"
              aria-label="Kind"
              defaultValue={parsed.kind ?? ''}
              placeholder="Any kind"
              options={optionsFrom(CONTRIBUTION_KIND_LABELS)}
              className="sm:w-48"
            />
            {view === 'mine' ? (
              <NativeSelect
                name="status"
                aria-label="Status"
                defaultValue={parsed.status ?? ''}
                placeholder="Any status"
                options={optionsFrom(CONTRIBUTION_STATUS_LABELS)}
                className="sm:w-48"
              />
            ) : null}
            <div className="col-span-2 flex gap-2">
              <Button type="submit" variant="secondary">
                Apply
              </Button>
              {parsed.kind || parsed.status ? (
                <Link
                  href={`/contributions?view=${view}`}
                  className={buttonStyles({ variant: 'ghost' })}
                >
                  Reset
                </Link>
              ) : null}
            </div>
          </Toolbar>
        </form>
        <ContributionList
          rows={rows}
          actions={{ verify: verifyContributionAction, reject: rejectContributionAction }}
          emptyTitle={view === 'queue' ? 'QUEUE CLEAR' : 'NO CONTRIBUTIONS'}
          emptyDescription={
            view === 'queue'
              ? 'Nothing awaits your review. Staff review every contribution; owners and maintainers review their projects.'
              : view === 'mine'
                ? 'Record what you built, researched or wrote. Someone else verifies it.'
                : 'Verified work of visible members appears here.'
          }
        />
      </Card>

      {page.total > PAGE_SIZE ? (
        <Pagination
          offset={page.offset}
          limit={page.limit}
          total={page.total}
          linkComponent={NextLink}
          hrefForOffset={(next) => href({ offset: next })}
        />
      ) : null}
    </div>
  );
}
