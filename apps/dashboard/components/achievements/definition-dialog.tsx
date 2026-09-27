'use client';

import { type ReactElement, useId, useRef, useState } from 'react';
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
  RULE_EVENT_LABELS,
  RULE_TYPE_LABELS,
  type RuleEventKey,
  type RuleTypeKey,
  VISIBILITY_LABELS,
  type VisibilityKey,
} from '@/lib/achievement-labels';
import { optionsFrom } from '@/lib/member-labels';
import { ActionForm, type FormAction } from '../forms/action-form';
import { FormField } from '../forms/form-field';
import { useToast } from '../toast';

/** Limits mirrored from the achievements service (it re-validates everything). */
const LIMITS = {
  keyMax: 64,
  titleMax: 64,
  summaryMax: 120,
  descriptionMax: 1000,
  categoryMax: 32,
  thresholdMax: 10_000,
  ordinalMax: 9999,
} as const;

export interface DefinitionValues {
  key: string;
  title: string;
  summary: string;
  description: string;
  category: string;
  rarity: RarityKey;
  visibility: VisibilityKey;
  ruleType: RuleTypeKey;
  event: RuleEventKey;
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

/** Events a member triggers alone count once only; the service enforces the same rule. */
const FIRST_STEP_EVENTS: ReadonlySet<RuleEventKey> = new Set(['project.created']);

function CriteriaBuilder({ values }: { values: DefinitionValues }) {
  const [ruleType, setRuleType] = useState<RuleTypeKey>(values.ruleType);
  const [event, setEvent] = useState<RuleEventKey>(values.event);
  const firstStep = FIRST_STEP_EVENTS.has(event);
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
              onChange={(change) => setEvent(change.target.value as RuleEventKey)}
              options={optionsFrom(RULE_EVENT_LABELS)}
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
  action,
}: {
  trigger: ReactElement;
  mode: 'create' | 'edit';
  values: DefinitionValues;
  facets: readonly { value: string; label: string }[];
  action: FormAction;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);
  const toast = useToast();
  const lastMessage = useRef('');
  // Dialogs need JavaScript anyway: wrapping the Server Action lets success close it with a toast.
  const tracked: FormAction = async (state, data) => {
    const result = await action(state, data);
    if (result.status === 'success') lastMessage.current = result.message;
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
          action={tracked}
          submitLabel={mode === 'create' ? 'Create achievement' : 'Save achievement'}
          onSuccess={() => {
            setOpen(false);
            toast({ text: lastMessage.current, tone: 'success' });
          }}
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
          <CriteriaBuilder values={values} />
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
