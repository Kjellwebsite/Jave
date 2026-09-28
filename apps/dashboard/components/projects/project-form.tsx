'use client';

import { Input, NativeSelect, Textarea } from '@jave/ui';
import {
  PROJECT_VISIBILITY_HINTS,
  PROJECT_VISIBILITY_LABELS,
  type ProjectVisibilityKey,
} from '@/lib/project-view';
import { ActionForm, type FormAction } from '../forms/action-form';
import { FormField } from '../forms/form-field';

/** Input caps mirror the core schemas (core validates again). */
export const PROJECT_FIELD_LIMITS = {
  title: 120,
  summary: 280,
  description: 10_000,
  goals: 4000,
  url: 2048,
} as const;

const TITLE_MIN = 2;

export interface ProjectFormValues {
  title: string;
  summary: string;
  description: string;
  goals: string;
  domainKey: string;
  visibility: ProjectVisibilityKey;
  repoUrl: string;
  websiteUrl: string;
}

export const EMPTY_PROJECT: ProjectFormValues = {
  title: '',
  summary: '',
  description: '',
  goals: '',
  domainKey: '',
  visibility: 'members',
  repoUrl: '',
  websiteUrl: '',
};

export interface ProjectFormProps {
  action: FormAction;
  submitLabel: string;
  domains: readonly { value: string; label: string }[];
  values?: ProjectFormValues;
  /** Present when editing. */
  projectId?: string;
  /** Visibility is an owner/staff decision; maintainers edit everything else. */
  canChangeVisibility: boolean;
}

const VISIBILITY_OPTIONS = (Object.keys(PROJECT_VISIBILITY_LABELS) as ProjectVisibilityKey[]).map(
  (value) => ({
    value,
    label: `${PROJECT_VISIBILITY_LABELS[value]} — ${PROJECT_VISIBILITY_HINTS[value]}`,
  }),
);

/** Create or edit a project's details. */
export function ProjectForm({
  action,
  submitLabel,
  domains,
  values = EMPTY_PROJECT,
  projectId,
  canChangeVisibility,
}: ProjectFormProps) {
  return (
    <ActionForm action={action} submitLabel={submitLabel} aria-label="Project details">
      {projectId ? <input type="hidden" name="projectId" value={projectId} /> : null}
      <FormField name="title" label="Title" required>
        <Input
          name="title"
          required
          minLength={TITLE_MIN}
          maxLength={PROJECT_FIELD_LIMITS.title}
          defaultValue={values.title}
          placeholder="Rocket Engine"
        />
      </FormField>
      <FormField
        name="summary"
        label="Summary"
        description="One line: what it is and why it matters."
      >
        <Input
          name="summary"
          maxLength={PROJECT_FIELD_LIMITS.summary}
          defaultValue={values.summary}
        />
      </FormField>
      <div className="grid gap-5 md:grid-cols-2">
        <FormField name="domainKey" label="Domain">
          <NativeSelect
            name="domainKey"
            defaultValue={values.domainKey}
            placeholder="No domain"
            options={domains}
          />
        </FormField>
        {canChangeVisibility ? (
          <FormField name="visibility" label="Visibility" description="Who can find and open it.">
            <NativeSelect
              name="visibility"
              defaultValue={values.visibility}
              options={VISIBILITY_OPTIONS}
            />
          </FormField>
        ) : null}
      </div>
      <FormField name="description" label="Description">
        <Textarea
          name="description"
          rows={6}
          maxLength={PROJECT_FIELD_LIMITS.description}
          defaultValue={values.description}
        />
      </FormField>
      <FormField
        name="goals"
        label="Goals"
        description="What done looks like. Milestones track the steps."
      >
        <Textarea
          name="goals"
          rows={3}
          maxLength={PROJECT_FIELD_LIMITS.goals}
          defaultValue={values.goals}
        />
      </FormField>
      <div className="grid gap-5 md:grid-cols-2">
        <FormField name="repoUrl" label="Repository URL" description="Absolute http(s) link.">
          <Input
            name="repoUrl"
            type="url"
            inputMode="url"
            maxLength={PROJECT_FIELD_LIMITS.url}
            defaultValue={values.repoUrl}
            placeholder="https://github.com/owner/name"
            mono
          />
        </FormField>
        <FormField name="websiteUrl" label="Website">
          <Input
            name="websiteUrl"
            type="url"
            inputMode="url"
            maxLength={PROJECT_FIELD_LIMITS.url}
            defaultValue={values.websiteUrl}
            placeholder="https://"
            mono
          />
        </FormField>
      </div>
    </ActionForm>
  );
}
