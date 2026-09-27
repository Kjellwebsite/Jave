import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { can, isUuid, trials } from '@jave/core';
import { Button, buttonStyles, Card, Icon, PageHeader, StatusBadge } from '@jave/ui';
import { ConfirmActionDialog } from '@/components/forms/confirm-action-dialog';
import { RestrictedPage } from '@/components/restricted-page';
import { TemplateForm } from '@/components/trials/template-form';
import { requireConsoleContext } from '@/server/context';
import { loadTrialFormOptions } from '@/server/data/trial-form-options';
import { guarded } from '@/server/guard';
import { setTemplateActiveAction, updateTemplateAction } from '../../actions';

export const metadata: Metadata = { title: 'Template' };

export default async function TemplatePage({ params }: { params: Promise<{ templateId: string }> }) {
  const { ctx } = await requireConsoleContext();
  const { templateId } = await params;
  if (!isUuid(templateId)) notFound();
  const loaded = await guarded(() => trials.getTemplate(ctx, { templateId }));
  if (!loaded.ok)
    return (
      <RestrictedPage eyebrow="OPERATIONS / TRIALS" title="Template" capability="canManageTrials" />
    );
  const template = loaded.value;
  const options = await loadTrialFormOptions(ctx);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="OPERATIONS / TRIALS / TEMPLATES"
        title="Template"
        description={template.title}
        meta={
          <StatusBadge
            tone={template.active ? 'success' : 'neutral'}
            quiet={template.active}
            label={template.active ? 'ACTIVE' : 'INACTIVE'}
          />
        }
        actions={
          <>
            <Link href="/trials/templates" className={buttonStyles({ variant: 'ghost' })}>
              <Icon icon={ArrowLeft} size="sm" />
              Templates
            </Link>
            <ConfirmActionDialog
              eyebrow="TEMPLATE"
              title={template.active ? 'Deactivate template' : 'Reactivate template'}
              description={
                template.active
                  ? 'It disappears from “Start from”. Trials already created from it keep their snapshot.'
                  : 'It becomes available again when creating trials.'
              }
              confirmLabel={template.active ? 'Deactivate' : 'Reactivate'}
              tone={template.active ? 'danger' : 'default'}
              action={setTemplateActiveAction}
              hidden={{ templateId: template.id, active: template.active ? 'false' : 'true' }}
              trigger={
                <Button variant={template.active ? 'ghost' : 'secondary'}>
                  {template.active ? 'Deactivate' : 'Reactivate'}
                </Button>
              }
            />
          </>
        }
      />
      <Card padding="lg" className="max-w-4xl">
        <TemplateForm
          mode="edit"
          action={updateTemplateAction}
          templateId={template.id}
          categories={options.categories}
          facets={options.facets}
          showAdversarial={can(ctx, 'canManageAdversarial')}
          initial={{
            key: template.key,
            title: template.title,
            category: template.category,
            summary: template.summary,
            brief: template.brief,
            rubric: template.rubric,
            facetKeys: template.facetKeys,
            durationMinutes: template.durationMinutes,
            teamSizeMin: template.teamSizeMin,
            teamSizeMax: template.teamSizeMax,
            allowsAdversarial: template.allowsAdversarial ?? false,
          }}
        />
      </Card>
    </div>
  );
}
