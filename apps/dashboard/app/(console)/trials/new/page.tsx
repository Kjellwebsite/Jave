import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { can, trials } from '@jave/core';
import { buttonStyles, Card, Icon, PageHeader } from '@jave/ui';
import { RestrictedPage } from '@/components/restricted-page';
import { type TemplateOption, TrialForm } from '@/components/trials/trial-form';
import { requireConsoleContext } from '@/server/context';
import { loadTrialFormOptions } from '@/server/data/trial-form-options';
import { loadViewer } from '@/server/data/viewer';
import { guarded } from '@/server/guard';
import { createTrialAction } from '../actions';

export const metadata: Metadata = { title: 'New trial' };

const DEFAULT_DURATION_MINUTES = 6 * 60;

export default async function NewTrialPage() {
  const { ctx } = await requireConsoleContext();
  if (!can(ctx, 'canManageTrials'))
    return (
      <RestrictedPage
        eyebrow="OPERATIONS / TRIALS"
        title="New trial"
        capability="canManageTrials"
      />
    );
  const loaded = await guarded(() => trials.listTemplates(ctx));
  if (!loaded.ok)
    return (
      <RestrictedPage
        eyebrow="OPERATIONS / TRIALS"
        title="New trial"
        capability="canManageTrials"
      />
    );
  const [viewer, options] = await Promise.all([loadViewer(ctx), loadTrialFormOptions(ctx)]);
  const templates: TemplateOption[] = loaded.value.map((template) => ({
    id: template.id,
    title: template.title,
    category: template.category,
    summary: template.summary,
    brief: template.brief,
    durationMinutes: template.durationMinutes,
    teamSizeMin: template.teamSizeMin,
    teamSizeMax: template.teamSizeMax,
    rubric: template.rubric,
    facetKeys: template.facetKeys,
    allowsAdversarial: template.allowsAdversarial,
  }));

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="OPERATIONS / TRIALS"
        title="New trial"
        description="Created as a draft. Nothing is announced until you open recruitment."
        actions={
          <Link href="/trials" className={buttonStyles({ variant: 'ghost' })}>
            <Icon icon={ArrowLeft} size="sm" />
            Trials
          </Link>
        }
      />
      {templates.length === 0 ? (
        <p className="text-small text-fg-subtle">
          No templates yet.{' '}
          <Link href="/trials/templates" className="text-fg underline-offset-4 hover:underline">
            Install the starter templates
          </Link>{' '}
          or write a custom trial below.
        </p>
      ) : null}
      <Card padding="lg" className="max-w-4xl">
        <TrialForm
          mode="create"
          action={createTrialAction}
          templates={templates}
          categories={options.categories}
          facets={options.facets}
          timeZone={viewer.timeZone}
          recruitmentWindowEditable
          adversarialAvailable={options.adversarialAvailable}
          defaultTeamSize={options.defaultTeamSize}
          initial={{
            title: '',
            category: '',
            summary: '',
            brief: '',
            rubric: [{ key: 'outcome', label: 'Outcome', description: '', weight: 1 }],
            facetKeys: [],
            durationMinutes: DEFAULT_DURATION_MINUTES,
            teamSize: options.defaultTeamSize,
            maxParticipants: null,
            recruitmentClosesAt: '',
            scheduledStartAt: '',
          }}
        />
      </Card>
    </div>
  );
}
