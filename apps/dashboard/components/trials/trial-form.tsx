'use client';

import { useState } from 'react';
import { Callout, Checkbox, Fieldset, Input, NativeSelect, Switch, Textarea } from '@jave/ui';
import { ActionForm, type FormAction } from '../forms/action-form';
import { FormField } from '../forms/form-field';
import { RubricEditor, type RubricCriterionValue } from './rubric-editor';

export interface TemplateOption {
  id: string;
  title: string;
  category: string;
  summary: string;
  brief: string;
  durationMinutes: number;
  teamSizeMin: number;
  teamSizeMax: number;
  rubric: RubricCriterionValue[];
  facetKeys: string[];
  /** Only known to viewers who hold canManageAdversarial. */
  allowsAdversarial?: boolean;
}

export interface TrialFormValues {
  title: string;
  category: string;
  summary: string;
  brief: string;
  rubric: RubricCriterionValue[];
  facetKeys: string[];
  durationMinutes: number;
  teamSize: number;
  maxParticipants: number | null;
  /** `datetime-local` values in the viewer's time zone ('' when unset). */
  recruitmentClosesAt: string;
  scheduledStartAt: string;
}

export interface FacetOption {
  key: string;
  label: string;
  domain: string;
}

/** Mirrors the service limits; the service validates again. */
export const TRIAL_FORM_LIMITS = {
  title: 120,
  summary: 280,
  brief: 8000,
  minDuration: 15,
  maxDuration: 14 * 24 * 60,
  minTeamSize: 1,
  maxTeamSize: 12,
  maxParticipants: 500,
  maxFacets: 3,
} as const;

export interface TrialFormProps {
  mode: 'create' | 'edit';
  action: FormAction;
  initial: TrialFormValues;
  categories: readonly { value: string; label: string }[];
  facets: readonly FacetOption[];
  timeZone: string;
  /** Create mode: templates to start from. */
  templates?: readonly TemplateOption[];
  /** Edit mode: the trial being edited. */
  trialId?: string;
  /** The recruitment window can change only in draft and recruiting. */
  recruitmentWindowEditable: boolean;
  /** Create mode: the adversarial switch (canManageAdversarial and the global switch on). */
  adversarialAvailable?: boolean;
  defaultTeamSize: number;
}

const CUSTOM = '';

function fromTemplate(template: TemplateOption, defaultTeamSize: number, base: TrialFormValues) {
  return {
    ...base,
    title: template.title,
    category: template.category,
    summary: template.summary,
    brief: template.brief,
    rubric: template.rubric,
    facetKeys: template.facetKeys,
    durationMinutes: template.durationMinutes,
    teamSize: Math.min(template.teamSizeMax, Math.max(template.teamSizeMin, defaultTeamSize)),
  };
}

/** Create (from a template or custom) and edit a trial. Every field is validated by core. */
export function TrialForm({
  mode,
  action,
  initial,
  categories,
  facets,
  timeZone,
  templates = [],
  trialId,
  recruitmentWindowEditable,
  adversarialAvailable = false,
  defaultTeamSize,
}: TrialFormProps) {
  const [templateId, setTemplateId] = useState(CUSTOM);
  const [values, setValues] = useState(initial);
  const [generation, setGeneration] = useState(0);
  const template = templates.find((candidate) => candidate.id === templateId) ?? null;
  const adversarialAllowed =
    adversarialAvailable && (template === null || template.allowsAdversarial === true);

  function pickTemplate(id: string) {
    setTemplateId(id);
    const picked = templates.find((candidate) => candidate.id === id);
    setValues(picked ? fromTemplate(picked, defaultTeamSize, initial) : initial);
    setGeneration((count) => count + 1);
  }

  return (
    <ActionForm
      action={action}
      submitLabel={mode === 'create' ? 'Create draft' : 'Save changes'}
      aria-label={mode === 'create' ? 'New trial' : 'Edit trial'}
    >
      {trialId ? <input type="hidden" name="trialId" value={trialId} /> : null}
      {mode === 'create' ? (
        <FormField
          name="templateId"
          label="Start from"
          description="A template fills in everything below; edit freely. The trial keeps a snapshot."
        >
          <NativeSelect
            name="templateId"
            value={templateId}
            onChange={(event) => pickTemplate(event.target.value)}
            placeholder="Custom trial"
            options={templates.map((option) => ({ value: option.id, label: option.title }))}
            data-testid="template-select"
          />
        </FormField>
      ) : (
        <Callout tone="warning">
          Editing the brief or rubric bars you from competing in this trial. Card changes refresh
          the recruitment post.
        </Callout>
      )}

      <div key={generation} className="space-y-5">
        <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_200px]">
          <FormField name="title" label="Title" required>
            <Input
              name="title"
              defaultValue={values.title}
              required
              minLength={3}
              maxLength={TRIAL_FORM_LIMITS.title}
            />
          </FormField>
          <FormField name="category" label="Category" required>
            <NativeSelect
              name="category"
              defaultValue={values.category || categories[0]?.value}
              options={categories}
              disabled={mode === 'edit'}
            />
          </FormField>
        </div>
        <FormField
          name="summary"
          label="Public summary"
          description="The recruitment card shows only this. 10–280 characters. Never reveal the brief."
          required
        >
          <Textarea
            name="summary"
            defaultValue={values.summary}
            maxLength={TRIAL_FORM_LIMITS.summary}
            rows={3}
            required
          />
        </FormField>
        <FormField
          name="brief"
          label="Brief (sealed)"
          description="Competitors see it only when the trial starts. Outcomes, constraints, deliverables."
          required
        >
          <Textarea
            name="brief"
            defaultValue={values.brief}
            maxLength={TRIAL_FORM_LIMITS.brief}
            rows={10}
            required
          />
        </FormField>

        <RubricEditor name="rubric" initial={values.rubric} seedKey={String(generation)} />

        <Fieldset
          legend="Evidence for"
          description={`Up to ${TRIAL_FORM_LIMITS.maxFacets} facets. The first is the primary facet: a passing result can become a VERIFIED rank there.`}
        >
          <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            {facets.map((facet) => (
              <Checkbox
                key={facet.key}
                id={`facet-${facet.key}`}
                name="facetKeys"
                value={facet.key}
                defaultChecked={values.facetKeys.includes(facet.key)}
                label={facet.label}
                description={facet.domain}
              />
            ))}
          </div>
        </Fieldset>

        <div className="grid gap-5 sm:grid-cols-3">
          <FormField name="durationMinutes" label="Duration (minutes)" description="15 min – 14 days." required>
            <Input
              name="durationMinutes"
              type="number"
              inputMode="numeric"
              min={TRIAL_FORM_LIMITS.minDuration}
              max={TRIAL_FORM_LIMITS.maxDuration}
              defaultValue={values.durationMinutes}
              mono
              required
            />
          </FormField>
          <FormField name="teamSize" label="Team size" required>
            <Input
              name="teamSize"
              type="number"
              inputMode="numeric"
              min={TRIAL_FORM_LIMITS.minTeamSize}
              max={TRIAL_FORM_LIMITS.maxTeamSize}
              defaultValue={values.teamSize}
              mono
              required
            />
          </FormField>
          <FormField name="maxParticipants" label="Max participants" description="Optional cap.">
            <Input
              name="maxParticipants"
              type="number"
              inputMode="numeric"
              min={1}
              max={TRIAL_FORM_LIMITS.maxParticipants}
              defaultValue={values.maxParticipants ?? ''}
              mono
            />
          </FormField>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          {recruitmentWindowEditable ? (
            <FormField
              name="recruitmentClosesAt"
              label="Recruitment closes"
              description={`Optional. Your time zone: ${timeZone}.`}
            >
              <Input
                name="recruitmentClosesAt"
                type="datetime-local"
                defaultValue={values.recruitmentClosesAt}
                mono
              />
            </FormField>
          ) : null}
          <FormField
            name="scheduledStartAt"
            label="Scheduled start"
            description={`Optional. Starts itself once teams are set. ${timeZone}.`}
          >
            <Input
              name="scheduledStartAt"
              type="datetime-local"
              defaultValue={values.scheduledStartAt}
              mono
            />
          </FormField>
        </div>

        {mode === 'create' && adversarialAvailable ? (
          <div className="rounded-md border border-line p-4">
            <Switch
              id="adversarialEnabled"
              name="adversarialEnabled"
              disabled={!adversarialAllowed}
              label="Allow a hidden adversarial role"
              description={
                adversarialAllowed
                  ? 'Staff-only. Never shown to participants. Roles are planned later under two-person authorization.'
                  : 'This template does not allow adversarial roles.'
              }
            />
          </div>
        ) : null}
      </div>
    </ActionForm>
  );
}
