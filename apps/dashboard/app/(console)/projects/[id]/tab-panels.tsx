import { ExternalLink, GitBranch } from 'lucide-react';
import { type Catalog, projects } from '@jave/core';
import { Card, EmptyState, Icon, Mono, Pagination, Panel } from '@jave/ui';
import { ContributionList } from '@/components/contributions/contribution-list';
import { NextLink } from '@/components/next-link';
import { ActivityFeed } from '@/components/projects/activity-feed';
import { LinkManager } from '@/components/projects/link-manager';
import { MilestoneManager } from '@/components/projects/milestone-manager';
import {
  ArchiveControl,
  RepoLinkForm,
  UnarchiveControl,
} from '@/components/projects/project-admin';
import { ProjectForm } from '@/components/projects/project-form';
import { TeamManager } from '@/components/projects/team-manager';
import { githubRepoUrl, milestoneProgress, projectPath } from '@/lib/project-view';
import { safeExternalUrl } from '@/lib/safe-url';
import { offsetParam, type SearchParams } from '@/lib/search-params';
import { formatDate, formatTimestamp } from '@/lib/time';
import type { UserContext } from '@/server/context';
import type { Viewer } from '@/server/data/viewer';
import { contributionRows, urlHost } from '@/server/projects/rows';
import { rejectContributionAction, verifyContributionAction } from '../../contributions/actions';
import {
  archiveProjectAction,
  linkRepoAction,
  unarchiveProjectAction,
  updateProjectAction,
} from '../actions';
import {
  addLinkAction,
  addMilestoneAction,
  completeMilestoneAction,
  removeLinkAction,
  removeMilestoneAction,
  setMilestoneStatusAction,
} from '../content-actions';
import {
  addMemberAction,
  changeMemberRoleAction,
  leaveProjectAction,
  removeMemberAction,
  transferOwnershipAction,
} from '../team-actions';

export const PROJECT_TABS = [
  'overview',
  'team',
  'milestones',
  'links',
  'contributions',
  'activity',
  'settings',
] as const;
export type ProjectTab = (typeof PROJECT_TABS)[number];

const ACTIVITY_PAGE_SIZE = 30;
const CONTRIBUTION_PAGE_SIZE = 50;
const UPCOMING_MILESTONES = 3;

interface TabPanelProps {
  tab: ProjectTab;
  ctx: UserContext;
  detail: projects.ProjectDetail;
  viewer: Viewer;
  domains: Catalog['domains'];
  query: SearchParams;
}

export async function ProjectTabPanel(props: TabPanelProps) {
  switch (props.tab) {
    case 'overview':
      return <OverviewPanel {...props} />;
    case 'team':
      return <TeamPanel {...props} />;
    case 'milestones':
      return <MilestonesPanel {...props} />;
    case 'links':
      return <LinksPanel {...props} />;
    case 'contributions':
      return <ContributionsPanel {...props} />;
    case 'activity':
      return <ActivityPanel {...props} />;
    case 'settings':
      return <SettingsPanel {...props} />;
  }
}

function linkRows(detail: projects.ProjectDetail) {
  return detail.links.map((link) => ({
    id: link.id,
    label: link.label,
    href: safeExternalUrl(link.url),
    host: urlHost(link.url),
  }));
}

function OverviewPanel({ detail, viewer }: TabPanelProps) {
  const upcoming = detail.milestones
    .filter((milestone) => milestone.status === 'planned' || milestone.status === 'active')
    .slice(0, UPCOMING_MILESTONES);
  const progress = milestoneProgress(detail.milestones);
  const website = safeExternalUrl(detail.websiteUrl);
  const repoUrl = safeExternalUrl(detail.repoUrl);
  const repoHref = githubRepoUrl(detail.githubRepo);
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-6">
        <Panel title="About">
          {detail.description ? (
            <p className="whitespace-pre-line break-words text-body leading-relaxed text-fg-muted">
              {detail.description}
            </p>
          ) : (
            <p className="text-small text-fg-subtle">No description yet.</p>
          )}
        </Panel>
        <Panel title="Goals">
          {detail.goals ? (
            <p className="whitespace-pre-line break-words text-body leading-relaxed text-fg-muted">
              {detail.goals}
            </p>
          ) : (
            <p className="text-small text-fg-subtle">No goals written down yet.</p>
          )}
        </Panel>
      </div>
      <div className="space-y-6">
        <Panel
          title="Next milestones"
          description={`${progress.done} of ${progress.total} done`}
          flush
        >
          {upcoming.length === 0 ? (
            <p className="px-5 py-4 text-small text-fg-subtle">Nothing open.</p>
          ) : (
            <ul className="divide-y divide-line-subtle">
              {upcoming.map((milestone) => (
                <li
                  key={milestone.id}
                  className="flex items-baseline justify-between gap-3 px-5 py-3"
                >
                  <span className="min-w-0 truncate text-small text-fg">{milestone.title}</span>
                  <Mono dim className="shrink-0 text-[12px]">
                    {milestone.dueAt
                      ? formatDate(milestone.dueAt, viewer.timeZone)
                      : milestone.status.toUpperCase()}
                  </Mono>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Links" flush>
          <ul className="divide-y divide-line-subtle">
            {repoHref ? (
              <li className="px-5 py-3">
                <a
                  href={repoHref}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="flex min-w-0 items-center gap-2 text-small text-fg hover:underline"
                >
                  <Icon icon={GitBranch} size="sm" className="shrink-0 text-fg-subtle" />
                  <Mono className="min-w-0 truncate">{detail.githubRepo}</Mono>
                  <Icon icon={ExternalLink} size="sm" className="shrink-0 text-fg-subtle" />
                </a>
              </li>
            ) : null}
            {[
              ...(repoUrl && !repoHref ? [{ id: 'repo', label: 'Repository', href: repoUrl }] : []),
              ...(website ? [{ id: 'website', label: 'Website', href: website }] : []),
              ...linkRows(detail).filter((link) => link.href !== null),
            ].map((link) => (
              <li key={link.id} className="px-5 py-3">
                <a
                  href={link.href ?? undefined}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="inline-flex max-w-full items-center gap-1.5 text-small text-fg hover:underline"
                >
                  <span className="truncate">{link.label}</span>
                  <Icon icon={ExternalLink} size="sm" className="shrink-0 text-fg-subtle" />
                </a>
              </li>
            ))}
            {!repoHref && !repoUrl && !website && detail.links.length === 0 ? (
              <li className="px-5 py-4 text-small text-fg-subtle">No links yet.</li>
            ) : null}
          </ul>
        </Panel>
      </div>
    </div>
  );
}

function TeamPanel({ detail, viewer }: TabPanelProps) {
  return (
    <TeamManager
      projectId={detail.id}
      projectTitle={detail.title}
      members={detail.members.map((member) => ({
        memberId: member.memberId,
        handle: member.handle,
        displayName: member.displayName,
        role: member.role,
        joinedLabel: formatDate(member.joinedAt, viewer.timeZone),
      }))}
      hiddenMemberCount={detail.hiddenMemberCount}
      viewerMemberId={viewer.memberId}
      viewerRole={detail.viewer.role}
      canManage={detail.viewer.canEdit}
      canAdmin={detail.viewer.canAdmin && detail.status !== 'archived'}
      actions={{
        add: addMemberAction,
        changeRole: changeMemberRoleAction,
        remove: removeMemberAction,
        transfer: transferOwnershipAction,
        leave: leaveProjectAction,
      }}
    />
  );
}

function MilestonesPanel({ detail, viewer }: TabPanelProps) {
  return (
    <MilestoneManager
      projectId={detail.id}
      canEdit={detail.viewer.canEdit}
      max={projects.MAX_PROJECT_MILESTONES}
      milestones={detail.milestones.map((milestone) => ({
        id: milestone.id,
        title: milestone.title,
        description: milestone.description,
        status: milestone.status,
        dueLabel: milestone.dueAt ? formatDate(milestone.dueAt, viewer.timeZone) : null,
        completedLabel: milestone.completedAt
          ? formatDate(milestone.completedAt, viewer.timeZone)
          : null,
      }))}
      actions={{
        add: addMilestoneAction,
        setStatus: setMilestoneStatusAction,
        complete: completeMilestoneAction,
        remove: removeMilestoneAction,
      }}
    />
  );
}

function LinksPanel({ detail }: TabPanelProps) {
  return (
    <LinkManager
      projectId={detail.id}
      links={linkRows(detail)}
      canEdit={detail.viewer.canEdit}
      max={projects.MAX_PROJECT_LINKS}
      actions={{ add: addLinkAction, remove: removeLinkAction }}
    />
  );
}

async function ContributionsPanel({ ctx, detail, viewer }: TabPanelProps) {
  const page = await projects.listContributions(ctx, {
    projectId: detail.id,
    limit: CONTRIBUTION_PAGE_SIZE,
  });
  const rows = contributionRows(page.items, viewer.memberId, viewer.timeZone);
  return (
    <Card padding="none">
      <ContributionList
        rows={rows}
        hideProject
        emptyTitle="NO CONTRIBUTIONS"
        emptyDescription="Recorded work on this project appears here. Others see it once it is verified."
        actions={{ verify: verifyContributionAction, reject: rejectContributionAction }}
      />
      {page.total > page.items.length ? (
        <p className="border-t border-line-subtle px-5 py-3 text-small text-fg-subtle">
          Showing the latest {page.items.length} of {page.total}.
        </p>
      ) : null}
    </Card>
  );
}

async function ActivityPanel({ ctx, detail, viewer, query }: TabPanelProps) {
  const offset = offsetParam(query.offset);
  const page = await projects.getProjectActivity(ctx, {
    projectId: detail.id,
    limit: ACTIVITY_PAGE_SIZE,
    offset,
  });
  return (
    <div className="space-y-6">
      <Card padding="lg">
        <ActivityFeed
          entries={page.items.map((item) => ({
            id: item.id,
            type: item.type,
            occurredAt: item.occurredAt,
            atLabel: formatTimestamp(item.occurredAt, viewer.timeZone),
            actor: item.actor,
            people: item.people,
            payload: item.payload,
          }))}
        />
      </Card>
      {page.total > ACTIVITY_PAGE_SIZE ? (
        <Pagination
          offset={page.offset}
          limit={page.limit}
          total={page.total}
          linkComponent={NextLink}
          hrefForOffset={(next) =>
            `${projectPath(detail.slug)}?tab=activity${next ? `&offset=${next}` : ''}`
          }
        />
      ) : null}
    </div>
  );
}

function SettingsPanel({ detail, domains }: TabPanelProps) {
  const archived = detail.status === 'archived';
  if (archived) {
    return (
      <Panel
        title="Archived"
        description="Staff restore archived projects to the status they were archived from."
      >
        {detail.viewer.isStaff ? (
          <UnarchiveControl
            projectId={detail.id}
            projectTitle={detail.title}
            action={unarchiveProjectAction}
          />
        ) : (
          <EmptyState compact title="FROZEN" description="Only staff can restore this project." />
        )}
      </Panel>
    );
  }
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <Panel title="Details">
        <ProjectForm
          action={updateProjectAction}
          submitLabel="Save details"
          projectId={detail.id}
          canChangeVisibility={detail.viewer.canAdmin}
          domains={domains.map((domain) => ({ value: domain.key, label: domain.label }))}
          values={{
            title: detail.title,
            summary: detail.summary ?? '',
            description: detail.description ?? '',
            goals: detail.goals ?? '',
            domainKey: detail.domainKey ?? '',
            visibility: detail.visibility,
            repoUrl: detail.repoUrl ?? '',
            websiteUrl: detail.websiteUrl ?? '',
          }}
        />
      </Panel>
      <div className="space-y-6">
        <Panel
          title="GitHub repository"
          description="Merged pull requests by linked accounts become contributions; pushes and releases appear in activity."
        >
          <RepoLinkForm projectId={detail.id} repo={detail.githubRepo} action={linkRepoAction} />
        </Panel>
        {detail.viewer.canAdmin ? (
          <Panel
            title="Archive"
            description="Freeze the project when work has stopped. Reversible by staff."
          >
            <ArchiveControl
              projectId={detail.id}
              projectTitle={detail.title}
              action={archiveProjectAction}
            />
          </Panel>
        ) : null}
      </div>
    </div>
  );
}
