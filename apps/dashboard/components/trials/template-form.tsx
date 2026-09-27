'use client';

import { Checkbox, Fieldset, Input, NativeSelect, Switch, Textarea } from '@jave/ui';
import { ActionForm, type FormAction } from '../forms/action-form';
import { FormField } from '../forms/form-field';
import { RubricEditor, type RubricCriterionValue } from './rubric-editor';
import { type FacetOption } from './trial-form';
import { TRIAL_LIMITS } from '@/lib/trial-limits';

export interface TemplateFormValues {
  key: string;
  title: string;
  category: string;
  summary: string;
  brief: string;
  rubric: RubricCriterionValue[];
  facetKeys: string[];
  durationMinutes: number;
  teamSizeMin: number;
  teamSizeMax: number;
  allowsAdversarial: boolean;
}

export interface TemplateFormProps {
  mode: 'create' | 'edit';
  action: FormAction;
  initial: TemplateFormValues;
  categories: readonly { value: string; label: string }[];
  facets: readonly FacetOption[];
  templateId?: string;
  /** canManageAdversarial: the switch is shown (and submitted) only for those holders. */
  showAdversarial: boolean;
}

/** Create or edit a reusable trial template. The key is immutable once created. */
export function TemplateForm({
  mode,
  action,
  initial,
  categories,
  facets,
  templateId,
  showAdversarial,
}: TemplateFormProps) {
  return (
    <ActionForm
      action={action}
      submitLabel={mode === 'create' ? 'Create template' : 'Save template'}
      aria-label={mode === 'create' ? 'New template' : 'Edit template'}
    >
      {templateId ? <input type="hidden" name="templateId" value={templateId} /> : null}
      <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_200px]">
        <FormField name="title" label="Title" required>
          <Input
            name="title"
            defaultValue={initial.title}
            required
            minLength={TRIAL_LIMITS.titleMin}
            maxLength={TRIAL_LIMITS.title}
          />
        </FormField>
        <FormField name="category" label="Category" required>
          <NativeSelect
            name="category"
            defaultValue={initial.category || categories[0]?.value}
            options={categories}
          />
        </FormField>
      </div>
      <FormField
        name="key"
        label="Key"
        description={
          mode === 'create'
            ? 'Permanent identifier: lowercase letters, digits and dashes.'
            : 'Permanent. Keys never change.'
        }
        required
      >
        <Input
          name="key"
          defaultValue={initial.key}
          required
          maxLength={TRIAL_LIMITS.templateKey}
          mono
          spellCheck={false}
          autoCapitalize="none"
          readOnly={mode === 'edit'}
        />
      </FormField>
      <FormField
        name="summary"
        label="Public summary"
        description="Shown on recruitment cards. Never reveal the brief."
        required
      >
        <Textarea
          name="summary"
          defaultValue={initial.summary}
          maxLength={TRIAL_LIMITS.summary}
          rows={3}
          required
        />
      </FormField>
      <FormField name="brief" label="Brief (sealed)" required>
        <Textarea
          name="brief"
          defaultValue={initial.brief}
          maxLength={TRIAL_LIMITS.brief}
          rows={10}
          required
        />
      </FormField>
      <RubricEditor name="rubric" initial={initial.rubric} />
      <Fieldset
        legend="Evidence for"
        description={`Up to ${TRIAL_LIMITS.maxFacets} facets; the first is the primary facet.`}
      >
        <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          {facets.map((facet) => (
            <Checkbox
              key={facet.key}
              id={`template-facet-${facet.key}`}
              name="facetKeys"
              value={facet.key}
              defaultChecked={initial.facetKeys.includes(facet.key)}
              label={facet.label}
              description={facet.domain}
            />
          ))}
        </div>
      </Fieldset>
      <div className="grid gap-5 sm:grid-cols-3">
        <FormField name="durationMinutes" label="Duration (minutes)" required>
          <Input
            name="durationMinutes"
            type="number"
            inputMode="numeric"
            min={TRIAL_LIMITS.minDuration}
            max={TRIAL_LIMITS.maxDuration}
            defaultValue={initial.durationMinutes}
            mono
            required
          />
        </FormField>
        <FormField name="teamSizeMin" label="Team size — min" required>
          <Input
            name="teamSizeMin"
            type="number"
            inputMode="numeric"
            min={TRIAL_LIMITS.minTeamSize}
            max={TRIAL_LIMITS.maxTeamSize}
            defaultValue={initial.teamSizeMin}
            mono
            required
          />
        </FormField>
        <FormField name="teamSizeMax" label="Team size — max" required>
          <Input
            name="teamSizeMax"
            type="number"
            inputMode="numeric"
            min={TRIAL_LIMITS.minTeamSize}
            max={TRIAL_LIMITS.maxTeamSize}
            defaultValue={initial.teamSizeMax}
            mono
            required
          />
        </FormField>
      </div>
      {showAdversarial ? (
        <div className="rounded-md border border-line p-4">
          <input type="hidden" name="allowsAdversarialShown" value="1" />
          <Switch
            id="allowsAdversarial"
            name="allowsAdversarial"
            defaultChecked={initial.allowsAdversarial}
            label="Allows a hidden adversarial role"
            description="Staff-only. Trials from this template may host a two-person-authorized security-culture exercise."
          />
        </div>
      ) : null}
    </ActionForm>
  );
}
