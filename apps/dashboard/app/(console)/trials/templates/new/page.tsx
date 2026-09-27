import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { can } from '@jave/core';
import { buttonStyles, Card, Icon, PageHeader } from '@jave/ui';
import { RestrictedPage } from '@/components/restricted-page';
import { TemplateForm } from '@/components/trials/template-form';
import { requireConsoleContext } from '@/server/context';
import { loadTrialFormOptions } from '@/server/data/trial-form-options';
import { createTemplateAction } from '../../actions';

export const metadata: Metadata = { title: 'New template' };

const DEFAULT_DURATION_MINUTES = 6 * 60;
const DEFAULT_TEAM_SIZE_MIN = 2;
const DEFAULT_TEAM_SIZE_MAX = 4;

export default async function NewTemplatePage() {
  const { ctx } = await requireConsoleContext();
  if (!can(ctx, 'canManageTrials'))
    return (
      <RestrictedPage
        eyebrow="OPERATIONS / TRIALS"
        title="New template"
        capability="canManageTrials"
      />
    );
  const options = await loadTrialFormOptions(ctx);
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="OPERATIONS / TRIALS / TEMPLATES"
        title="New template"
        description="A reusable mission: public summary, sealed brief, rubric and sizing."
        actions={
          <Link href="/trials/templates" className={buttonStyles({ variant: 'ghost' })}>
            <Icon icon={ArrowLeft} size="sm" />
            Templates
          </Link>
        }
      />
      <Card padding="lg" className="max-w-4xl">
        <TemplateForm
          mode="create"
          action={createTemplateAction}
          categories={options.categories}
          facets={options.facets}
          showAdversarial={can(ctx, 'canManageAdversarial')}
          initial={{
            key: '',
            title: '',
            category: '',
            summary: '',
            brief: '',
            rubric: [{ key: 'outcome', label: 'Outcome', description: '', weight: 1 }],
            facetKeys: [],
            durationMinutes: DEFAULT_DURATION_MINUTES,
            teamSizeMin: DEFAULT_TEAM_SIZE_MIN,
            teamSizeMax: DEFAULT_TEAM_SIZE_MAX,
            allowsAdversarial: false,
          }}
        />
      </Card>
    </div>
  );
}
