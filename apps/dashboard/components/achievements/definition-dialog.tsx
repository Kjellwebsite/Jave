'use client';

import { type ReactElement, useId, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTrigger,
  Input,
  Mono,
  NativeSelect,
  Switch,
  Textarea,
} from '@jave/ui';
import {
  RARITY_LABELS,
  type RarityKey,
  type RuleEventOption,
  RULE_TYPE_LABELS,
  type RuleTypeKey,
  VISIBILITY_LABELS,
  type VisibilityKey,
} from '@/lib/achievement-labels';
import { ACHIEVEMENT_FORM_LIMITS } from '@/lib/form-limits';
import { optionsFrom } from '@/lib/member-labels';
import { ActionForm, type FormAction } from '../forms/action-form';
import { FormField } from '../forms/form-field';
import { useToast } from '../toast';

const LIMITS = ACHIEVEMENT_FORM_LIMITS;

export interface DefinitionValues {
  key: string;
  title: string;
  summary: string;
  description: string;
  category: string;
  rarity: RarityKey;
  visibility: VisibilityKey;
  ruleType: RuleTypeKey;
  /** A catalog event type; the builder offers only the core allow-list. */
  event: string;
  threshold: number;
  requiresVerification: boolean;
  facetKey: string | null;
  active: boolean;
  ordinal: number;
}

export const EMPTY_DEFINITION: DefinitionValues = {
  key: '',
  title: '',
  summary: '',
  description: '',
  category: 'record',
  rarity: 'standard',
  visibility: 'public',
  ruleType: 'manual',
  event: 'mission.completed',
  threshold: 1,
  requiresVerification: false,
  facetKey: null,
  active: true,
  ordinal: 0,
};

/**
 * The rule: manual, or "count this verified outcome N times". Outcomes are
 * the core allow-list, passed in by the server; events a member triggers
 * alone (first steps) count once only. The service enforces the same rules.
 */
function CriteriaBuilder({
  values,
  events,
}: {
  values: DefinitionValues;
  events: readonly RuleEventOption[];
}) {
  const [ruleType, setRuleType] = useState<RuleTypeKey>(values.ruleType);
  const [event, setEvent] = useState<string>(
    events.some((option) => option.value === values.event)
      ? values.event
      : (events[0]?.value ?? values.event),
  );
  const firstStep = events.some((option) => option.value === event && option.firstStep);
  return (
    <fieldset className="min-w-0 space-y-4 rounded-md border border-line-subtle p-4">
      <legend className="type-eyebrow px-1 text-fg-subtle">RULE</legend>
      <FormField
        name="criteria"
        label="How it is earned"
        description="Rules count verified outcomes decided by someone else. Discord activity never counts."
      >
        <NativeSelect
          name="ruleType"
          value={ruleType}
          onChange={(change) => setRuleType(change.target.value as RuleTypeKey)}
          options={optionsFrom(RULE_TYPE_LABELS)}
        />
      </FormField>
      {ruleType === 'event_count' ? (
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_140px]">
          <FormField name="criteria.event" label="Outcome">
            <NativeSelect
              name="event"
              value={event}
              onChange={(change) => setEvent(change.target.value)}
              options={events.map((option) => ({ value: option.value, label: option.label }))}
            />
          </FormField>
          <FormField
            name="criteria.threshold"
            label="Times"
            description={firstStep ? 'First step: counts once.' : undefined}
          >
            {firstStep ? (
              <Input name="threshold" type="number" value={1} readOnly mono />
            ) : (
              <Input
                name="threshold"
                type="number"
                inputMode="numeric"
                min={1}
                max={LIMITS.thresholdMax}
                defaultValue={values.threshold}
                mono
              />
            )}
          </FormField>
        </div>
      ) : null}
      {ruleType === 'event_count' ? (
        <p className="text-small text-fg-subtle">
          Members whose history already meets the rule are awarded in the background, without public
          announcements.
        </p>
      ) : null}
    </fieldset>
  );
}

/** Create or edit an achievement definition, including its rule. */
export function DefinitionDialog({
  trigger,
  mode,
  values,
  facets,
  events,
  action,
}: {
  trigger: ReactElement;
  mode: 'create' | 'edit';
  values: DefinitionValues;
  facets: readonly { value: string; label: string }[];
  events: readonly RuleEventOption[];
  action: FormAction;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);
  const toast = useToast();
  // The toast is raised by the call itself, not by an effect in the form: it
  // still appears if the revalidated page no longer renders this dialog.
  const announced: FormAction = async (state, data) => {
    const result = await action(state, data);
    if (result.status === 'success') toast({ text: result.message, tone: 'success' });
    return result;
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setSession((count) => count + 1);
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        size="lg"
        eyebrow="ACHIEVEMENTS"
        title={mode === 'create' ? 'New achievement' : `Edit ${values.title}`}
        description={
          mode === 'create'
            ? 'Achievements mark verified outcomes. They are descriptive records, never a score.'
            : 'Edits never touch existing awards. A changed rule is re-evaluated against history.'
        }
      >
        <ActionForm
          key={session}
          action={announced}
          submitLabel={mode === 'create' ? 'Create achievement' : 'Save achievement'}
          onSuccess={() => setOpen(false)}
          aria-label={mode === 'create' ? 'New achievement' : 'Edit achievement'}
        >
          {mode === 'create' ? (
            <FormField
              name="key"
              label="Key"
              description="Permanent id: a–z, 0–9 and _, starting with a letter."
              required
            >
              <Input
                name="key"
                required
                maxLength={LIMITS.keyMax}
                mono
                placeholder="first_launch"
              />
            </FormField>
          ) : (
            <p className="text-small text-fg-subtle">
              Key <Mono>{values.key}</Mono>
              <input type="hidden" name="key" value={values.key} />
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField name="title" label="Title" required>
              <Input
                name="title"
                required
                maxLength={LIMITS.titleMax}
                defaultValue={values.title}
              />
            </FormField>
            <FormField name="category" label="Category" description="a–z, 0–9, _">
              <Input
                name="category"
                required
                maxLength={LIMITS.categoryMax}
                defaultValue={values.category}
                mono
              />
            </FormField>
          </div>
          <FormField
            name="summary"
            label="Unlock line"
            description="ACHIEVEMENT UNLOCKED — TITLE — this line."
            required
          >
            <Input
              name="summary"
              required
              maxLength={LIMITS.summaryMax}
              defaultValue={values.summary}
              placeholder="3 projects shipped."
            />
          </FormField>
          <FormField name="description" label="Description" required>
            <Textarea
              name="description"
              required
              maxLength={LIMITS.descriptionMax}
              rows={3}
              defaultValue={values.description}
            />
          </FormField>
          <CriteriaBuilder values={values} events={events} />
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField name="rarity" label="Rarity">
              <NativeSelect
                name="rarity"
                defaultValue={values.rarity}
                options={optionsFrom(RARITY_LABELS)}
              />
            </FormField>
            <FormField name="visibility" label="Visibility">
              <NativeSelect
                name="visibility"
                defaultValue={values.visibility}
                options={optionsFrom(VISIBILITY_LABELS)}
              />
            </FormField>
            <FormField name="ordinal" label="Order" description="Lower first.">
              <Input
                name="ordinal"
                type="number"
                min={0}
                max={LIMITS.ordinalMax}
                defaultValue={values.ordinal}
                mono
              />
            </FormField>
          </div>
          <FormField
            name="facetKey"
            label="Capability"
            description="Optional facet this achievement speaks to."
          >
            <NativeSelect
              name="facetKey"
              defaultValue={values.facetKey ?? ''}
              placeholder="None"
              options={facets}
            />
          </FormField>
          <Switch
            id={`${id}-verification`}
            name="requiresVerification"
            defaultChecked={values.requiresVerification}
            label="Requires verification"
            description="Awards start unverified until a second person verifies them."
          />
          <Switch
            id={`${id}-active`}
            name="active"
            defaultChecked={values.active}
            label="Active"
            description="Inactive achievements are never awarded; existing awards stay."
          />
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}
