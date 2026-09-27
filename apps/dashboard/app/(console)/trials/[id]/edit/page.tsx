import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { can, isUuid, trials } from '@jave/core';
import { buttonStyles, Callout, Card, Icon, PageHeader } from '@jave/ui';
import { RestrictedPage } from '@/components/restricted-page';
import { TrialForm } from '@/components/trials/trial-form';
import { dateToZonedInput } from '@/lib/trial-time';
import { requireConsoleContext } from '@/server/context';
import { loadTrialFormOptions } from '@/server/data/trial-form-options';
import { loadViewer } from '@/server/data/viewer';
import { guarded } from '@/server/guard';
import { updateTrialAction } from '../actions';

export const metadata: Metadata = { title: 'Edit trial' };

const RECRUITMENT_WINDOW_STATES: readonly trials.TrialStatus[] = ['draft', 'recruiting'];

export default async function EditTrialPage({ params }: { params: Promise<{ id: string }> }) {
  const { ctx } = await requireConsoleContext();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  if (!can(ctx, 'canManageTrials'))
    return <RestrictedPage eyebrow="OPERATIONS / TRIALS" title="Edit trial" capability="canManageTrials" />;
  const loaded = await guarded(() => trials.getTrialForStaff(ctx, { trialId: id }));
  if (!loaded.ok)
    return <RestrictedPage eyebrow="OPERATIONS / TRIALS" title="Edit trial" capability="canManageTrials" />;
  const view = loaded.value;
  const [viewer, options] = await Promise.all([loadViewer(ctx), loadTrialFormOptions(ctx)]);
  const back = (
    <Link href={`/trials/${view.id}`} className={buttonStyles({ variant: 'ghost' })}>
      <Icon icon={ArrowLeft} size="sm" />
      {view.ref}
    </Link>
  );

  if (!trials.EDITABLE_STATUSES.includes(view.status))
    return (
      <div className="space-y-8">
        <PageHeader eyebrow={`OPERATIONS / TRIALS / ${view.ref}`} title="Edit trial" actions={back} />
        <Callout tone="neutral" title="LOCKED">
          A trial’s content is fixed once it starts. Extend the deadline or cancel from the
          overview.
        </Callout>
      </div>
    );

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={`OPERATIONS / TRIALS / ${view.ref}`}
        title="Edit trial"
        description={view.title}
        actions={back}
      />
      <Card padding="lg" className="max-w-4xl">
        <TrialForm
          mode="edit"
          action={updateTrialAction}
          trialId={view.id}
          categories={options.categories}
          facets={options.facets}
          timeZone={viewer.timeZone}
          recruitmentWindowEditable={RECRUITMENT_WINDOW_STATES.includes(view.status)}
          defaultTeamSize={view.teamSize}
          initial={{
            title: view.title,
            category: view.category,
            summary: view.summary,
            brief: view.brief,
            rubric: view.rubric.map(({ key, label, description, weight }) => ({
              key,
              label,
              description,
              weight,
            })),
            facetKeys: view.facetKeys,
            durationMinutes: view.durationMinutes,
            teamSize: view.teamSize,
            maxParticipants: view.maxParticipants,
            recruitmentClosesAt: view.recruitmentClosesAt
              ? dateToZonedInput(view.recruitmentClosesAt, viewer.timeZone)
              : '',
            scheduledStartAt: view.scheduledStartAt
              ? dateToZonedInput(view.scheduledStartAt, viewer.timeZone)
              : '',
          }}
        />
      </Card>
    </div>
  );
}
