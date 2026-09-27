import Link from 'next/link';
import { GitBranch, Users } from 'lucide-react';
import { Icon, Mono } from '@jave/ui';
import { projectPath, type ProjectStatusKey, type ProjectVisibilityKey } from '@/lib/project-view';
import { PipelineMeter, ProjectStatusBadge, VisibilityBadge } from './status-pipeline';

export interface ProjectCardData {
  slug: string;
  title: string;
  summary: string | null;
  status: ProjectStatusKey;
  visibility: ProjectVisibilityKey;
  domainLabel: string | null;
  githubRepo: string | null;
  ownerName: string | null;
  memberCount: number;
  /** Pre-formatted in the viewer's time zone. */
  updatedLabel: string;
}

/** One project in the directory grid. The whole card is the link. */
export function ProjectCard({ project }: { project: ProjectCardData }) {
  return (
    <article
      data-project={project.slug}
      className="machined group relative flex min-w-0 flex-col gap-4 rounded-lg border border-line bg-surface p-5 transition-colors hover:border-line-strong hover:bg-surface-raised"
    >
      <div className="flex items-start justify-between gap-3">
        <ProjectStatusBadge status={project.status} />
        <VisibilityBadge visibility={project.visibility} />
      </div>
      <div className="min-w-0 space-y-1.5">
        <h2 className="type-heading break-words text-fg">
          <Link
            href={projectPath(project.slug)}
            className="after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none"
          >
            {project.title}
          </Link>
        </h2>
        <p className="line-clamp-2 min-h-10 text-small text-fg-subtle">
          {project.summary ?? 'No summary yet.'}
        </p>
      </div>
      <PipelineMeter status={project.status} />
      <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1.5 text-small text-fg-subtle">
        <span className="min-w-0 truncate">{project.ownerName ?? 'Owner hidden'}</span>
        <span className="inline-flex items-center gap-1.5">
          <Icon icon={Users} size="sm" />
          <Mono dim>{project.memberCount}</Mono>
        </span>
        {project.domainLabel ? (
          <span className="type-eyebrow text-[10px]">{project.domainLabel}</span>
        ) : null}
        {project.githubRepo ? (
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <Icon icon={GitBranch} size="sm" />
            <Mono dim className="truncate">
              {project.githubRepo}
            </Mono>
          </span>
        ) : null}
        <Mono dim className="ml-auto text-[12px]">
          {project.updatedLabel}
        </Mono>
      </div>
    </article>
  );
}
