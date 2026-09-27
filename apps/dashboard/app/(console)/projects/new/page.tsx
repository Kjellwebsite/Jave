import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { loadCatalog, projects } from '@jave/core';
import { buttonStyles, Callout, Card, Icon, PageHeader } from '@jave/ui';
import { ProjectForm } from '@/components/projects/project-form';
import { requireConsoleContext } from '@/server/context';
import { createProjectAction } from '../actions';

export const metadata: Metadata = { title: 'Start project' };

export default async function NewProjectPage() {
  const { ctx, actor } = await requireConsoleContext();
  const catalog = await loadCatalog(ctx);
  const domains = catalog.domains.map((domain) => ({ value: domain.key, label: domain.label }));
  const canCreate = actor.memberId !== null && actor.standing === 'good';

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="OPERATIONS / PROJECTS"
        title="New project"
        description="Start at IDEA. You become the owner; add your team and milestones next."
        actions={
          <Link href="/projects" className={buttonStyles({ variant: 'ghost' })}>
            <Icon icon={ArrowLeft} size="md" />
            All projects
          </Link>
        }
      />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px]">
        <Card padding="lg" className="max-w-3xl">
          {canCreate ? (
            <ProjectForm
              action={createProjectAction}
              submitLabel="Start project"
              domains={domains}
              canChangeVisibility
            />
          ) : (
            <Callout tone="warning" title="NOT AVAILABLE">
              Starting projects needs a JVLN profile in good standing.
            </Callout>
          )}
        </Card>
        <aside className="space-y-4 text-small text-fg-subtle">
          <p className="type-eyebrow text-fg-muted">HOW IT WORKS</p>
          <p>
            Projects move IDEA → PLANNING → BUILDING → TESTING → SHIPPED. Shipping is declared by
            the team and credits every active member once.
          </p>
          <p>
            Contributions become verified only when someone else vouches for them: staff, a project
            owner or maintainer, or a merged pull request by a verified GitHub account.
          </p>
          <p>
            You can start {projects.MAX_PROJECTS_CREATED_PER_DAY} projects per day and own{' '}
            {projects.MAX_ACTIVE_OWNED_PROJECTS} active ones at a time.
          </p>
        </aside>
      </div>
    </div>
  );
}
