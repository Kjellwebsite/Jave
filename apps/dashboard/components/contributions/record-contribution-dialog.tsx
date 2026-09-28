'use client';

import { Plus } from 'lucide-react';
import { Button, type ButtonVariant, Input, NativeSelect, Textarea } from '@jave/ui';
import { CONTRIBUTION_KIND_LABELS, type ContributionKindKey } from '@/lib/project-view';
import type { FormAction } from '../forms/action-form';
import { ConfirmActionDialog } from '../forms/confirm-action-dialog';
import { FormField } from '../forms/form-field';

export interface RecordContributionDialogProps {
  action: FormAction;
  /** Projects the viewer is on (the only ones a contribution may attach to). */
  projects: readonly { id: string; title: string }[];
  /** Pre-select (and lock) one project, e.g. on a project page. */
  fixedProject?: { id: string; title: string };
  variant?: ButtonVariant;
}

const TITLE_MIN = 3;
const TITLE_MAX = 200;
const DESCRIPTION_MAX = 4000;
const URL_MAX = 2048;

const KIND_OPTIONS = (Object.keys(CONTRIBUTION_KIND_LABELS) as ContributionKindKey[]).map(
  (kind) => ({
    value: kind,
    label: CONTRIBUTION_KIND_LABELS[kind],
  }),
);

/** Record your own contribution. It stays unverified until someone else reviews it. */
export function RecordContributionDialog({
  action,
  projects,
  fixedProject,
  variant = 'secondary',
}: RecordContributionDialogProps) {
  return (
    <ConfirmActionDialog
      eyebrow="CONTRIBUTIONS"
      title="Record contribution"
      description="Stays AWAITING REVIEW until staff or a project owner or maintainer verifies it. Never you."
      confirmLabel="Record contribution"
      action={action}
      hidden={fixedProject ? { projectId: fixedProject.id } : {}}
      trigger={
        <Button variant={variant} iconLeft={Plus} data-testid="record-contribution">
          Record contribution
        </Button>
      }
    >
      {fixedProject ? (
        <p className="text-small text-fg-subtle">
          On <span className="text-fg">{fixedProject.title}</span>
        </p>
      ) : (
        <FormField
          name="projectId"
          label="Project"
          description="Optional. Only projects you are on."
        >
          <NativeSelect
            name="projectId"
            defaultValue=""
            placeholder="No project"
            options={projects.map((project) => ({ value: project.id, label: project.title }))}
          />
        </FormField>
      )}
      <FormField name="kind" label="Kind" required>
        <NativeSelect name="kind" defaultValue="code" options={KIND_OPTIONS} />
      </FormField>
      <FormField name="title" label="What you did" required>
        <Input
          name="title"
          required
          minLength={TITLE_MIN}
          maxLength={TITLE_MAX}
          placeholder="Faster telemetry parser"
        />
      </FormField>
      <FormField name="url" label="Link" description="Pull request, document or demo. http(s).">
        <Input
          name="url"
          type="url"
          inputMode="url"
          maxLength={URL_MAX}
          placeholder="https://"
          mono
        />
      </FormField>
      <FormField name="occurredAt" label="Date" description="Optional. Defaults to today.">
        <Input name="occurredAt" type="date" mono />
      </FormField>
      <FormField name="description" label="Details">
        <Textarea name="description" rows={3} maxLength={DESCRIPTION_MAX} />
      </FormField>
    </ConfirmActionDialog>
  );
}
