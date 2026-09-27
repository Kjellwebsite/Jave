import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, GitBranch } from 'lucide-react';
import { isUuid, loadCatalog, projects } from '@jave/core';
import { Badge, Callout, Icon, LinkTabs, Mono } from '@jave/ui';
import { RecordContributionDialog } from '@/components/contributions/record-contribution-dialog';
import { NextLink } from '@/components/next-link';
import { StatusControl } from '@/components/projects/status-control';
import {
  ProjectStatusBadge,
  StatusPipeline,
  VisibilityBadge,
} from '@/components/projects/status-pipeline';
import { milestoneProgress, PROJECT_ROLE_LABELS, projectPath } from '@/lib/project-view';
import { firstParam, type SearchParams } from '@/lib/search-params';
import { formatDate } from '@/lib/time';
import { requireConsoleContext } from '@/server/context';
import { loadViewer } from '@/server/data/viewer';
import { guarded } from '@/server/guard';
import { recordContributionAction } from '../../contributions/actions';
import { changeStatusAction } from '../actions';
import { ProjectTabPanel, type ProjectTab, PROJECT_TABS } from './tab-panels';

export const metadata: Metadata = { title: 'Project' };

const MAX_SLUG_LENGTH = 64;

const TAB_LABELS: Record<ProjectTab, string> = {
  overview: 'Overview',
  team: 'Team',
  milestones: 'Milestones',
  links: 'Links',
  contributions: 'Contributions',
  activity: 'Activity',
  settings: 'Settings',
};

/** A uuid or a slug from the URL; anything else (including malformed escapes) is not found. */
function projectRef(id: string): { projectId: string } | { slug: string } | null {
  let value: string;
  try {
    value = decodeURIComponent(id).toLowerCase();
  } catch {
    return null;
  }
  if (isUuid(value)) return { projectId: value };
  if (value.length <= MAX_SLUG_LENGTH && projects.SLUG_PATTERN.test(value)) return { slug: value };
  return null;
}

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { ctx } = await requireConsoleContext();
  const ref = projectRef((await params).id);
  if (!ref) notFound();
  const loaded = await guarded(() => projects.getProject(ctx, ref));
  // Invisible projects are "not found" in core; a refusal is never distinguishable.
  if (!loaded.ok) notFound();
  const detail = loaded.value;
  const [viewer, catalog] = await Promise.all([loadViewer(ctx), loadCatalog(ctx)]);
  const query = await searchParams;
  const tz = viewer.timeZone;

  const archived = detail.status === 'archived';
  const showSettings =
    detail.viewer.canEdit ||
    (!archived && detail.viewer.canAdmin) ||
    (archived && detail.viewer.isStaff);
  const tabs = PROJECT_TABS.filter((tab) => tab !== 'settings' || showSettings);
  const requested = firstParam(query.tab) as ProjectTab | undefined;
  const tab: ProjectTab = requested && tabs.includes(requested) ? requested : 'overview';
  const basePath = projectPath(detail.slug);
  const statusTargets = projects.PROJECT_TRANSITIONS[detail.status].filter(
    (target) => target !== 'archived',
  );
  const progress = milestoneProgress(detail.milestones);
  const domain = catalog.domains.find((candidate) => candidate.key === detail.domainKey);
  const canRecord = detail.viewer.role !== null && !archived;

  return (
    <div className="space-y-8">
      <header className="space-y-6 border-b border-line-subtle pb-8">
        <Link
          href="/projects"
          className="type-eyebrow inline-flex items-center gap-1.5 text-fg-subtle hover:text-fg-muted"
        >
          <Icon icon={ArrowLeft} size="sm" />
          OPERATIONS / PROJECTS
        </Link>
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <ProjectStatusBadge status={detail.status} />
              <VisibilityBadge visibility={detail.visibility} />
              {domain ? <Badge>{domain.label}</Badge> : null}
              {detail.viewer.role ? (
                <Badge tone="info">
                  YOU · {PROJECT_ROLE_LABELS[detail.viewer.role].toUpperCase()}
                </Badge>
              ) : null}
            </div>
            <h1 className="break-words text-[26px] font-semibold leading-tight tracking-tight text-fg">
              {detail.title}
            </h1>
            {detail.summary ? (
              <p className="max-w-2xl text-body text-fg-muted">{detail.summary}</p>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {canRecord ? (
              <RecordContributionDialog
                action={recordContributionAction}
                projects={[]}
                fixedProject={{ id: detail.id, title: detail.title }}
              />
            ) : null}
            {detail.viewer.canEdit ? (
              <StatusControl
                projectId={detail.id}
                projectTitle={detail.title}
                current={detail.status}
                targets={statusTargets}
                shippedBefore={detail.shippedAt !== null}
                action={changeStatusAction}
              />
            ) : null}
          </div>
        </div>
      </header>

      {firstParam(query.created) === '1' && detail.viewer.role === 'owner' ? (
        <Callout tone="success" role="status" title="PROJECT STARTED">
          {detail.title} is at IDEA. Add your team and milestones, then move it forward.
        </Callout>
      ) : null}
      {archived ? (
        <Callout tone="neutral" title="ARCHIVED">
          This project is frozen. Members can still leave; only staff can restore it.
        </Callout>
      ) : null}

      <StatusPipeline status={detail.status} />

      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-6">
        <Fact label="OWNER">{detail.owner?.displayName ?? '—'}</Fact>
        <Fact label="TEAM">
          <Mono>{detail.memberCount}</Mono>
        </Fact>
        <Fact label="MILESTONES">
          <Mono>
            {progress.done}/{progress.total}
          </Mono>
        </Fact>
        <Fact label="STARTED">
          <Mono>{formatDate(detail.createdAt, tz)}</Mono>
        </Fact>
        <Fact label="SHIPPED">
          <Mono>{detail.shippedAt ? formatDate(detail.shippedAt, tz) : '—'}</Mono>
        </Fact>
        <Fact label="REPOSITORY">
          {detail.githubRepo ? (
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <Icon icon={GitBranch} size="sm" className="text-fg-subtle" />
              <Mono className="truncate">{detail.githubRepo}</Mono>
            </span>
          ) : (
            <Mono dim>—</Mono>
          )}
        </Fact>
      </dl>

      <div className="space-y-6">
        <LinkTabs
          label="Project sections"
          linkComponent={NextLink}
          tabs={tabs.map((key) => ({
            href: key === 'overview' ? basePath : `${basePath}?tab=${key}`,
            label: TAB_LABELS[key],
            active: key === tab,
          }))}
        />
        <ProjectTabPanel
          tab={tab}
          ctx={ctx}
          detail={detail}
          viewer={viewer}
          domains={catalog.domains}
          query={query}
        />
      </div>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="type-eyebrow text-fg-subtle">{label}</dt>
      <dd className="mt-1.5 truncate text-small text-fg-muted">{children}</dd>
    </div>
  );
}
