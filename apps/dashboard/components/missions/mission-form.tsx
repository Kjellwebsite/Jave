'use client';

import { type ReactNode, useId, useState } from 'react';
import { Checkbox, Input, Mono, NativeSelect, Switch, Textarea } from '@jave/ui';
import { MISSION_TYPE_LABELS, type MissionTypeKey, toUtcInputValue } from '@/lib/mission-labels';
import { optionsFrom } from '@/lib/member-labels';
import { ActionForm, type FormAction } from '../forms/action-form';
import { FormField } from '../forms/form-field';

/** Limits mirrored from the mission service (it re-validates everything). */
export const MISSION_LIMITS = {
  titleMax: 120,
  briefMax: 4000,
  rewardNoteMax: 200,
  maxAssignees: 1000,
  durationHoursMax: 2160,
} as const;

export interface MissionFormValues {
  missionId?: string;
  title: string;
  brief: string;
  type: MissionTypeKey;
  facetKey: string | null;
  evidenceRequired: boolean;
  rewardAchievementKey: string | null;
  rewardNote: string | null;
  maxAssignees: number | null;
  selfAssignable: boolean;
  deadlineAt: Date | null;
  durationHours: number | null;
}

export interface MissionFormProps {
  action: FormAction;
  values: MissionFormValues;
  /** The type only changes while the mission is a draft. */
  typeLocked: boolean;
  facets: readonly { value: string; label: string }[];
  rewards: readonly { value: string; label: string }[];
  submitLabel: string;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="min-w-0 space-y-5 border-t border-line-subtle pt-6 first:border-0 first:pt-0">
      <legend className="type-eyebrow float-left mb-5 w-full text-fg-subtle">{title}</legend>
      <div className="clear-both space-y-5">{children}</div>
    </fieldset>
  );
}

/** Create or edit a mission. Server Action form; the mission service validates and authorizes. */
export function MissionForm({
  action,
  values,
  typeLocked,
  facets,
  rewards,
  submitLabel,
}: MissionFormProps) {
  const id = useId();
  const [type, setType] = useState<MissionTypeKey>(values.type);
  const team = type === 'team';
  return (
    <ActionForm action={action} submitLabel={submitLabel} aria-label={submitLabel}>
      {values.missionId ? <input type="hidden" name="missionId" value={values.missionId} /> : null}
      <Section title="BRIEF">
        <FormField name="title" label="Title" required>
          <Input
            name="title"
            required
            minLength={3}
            maxLength={MISSION_LIMITS.titleMax}
            defaultValue={values.title}
          />
        </FormField>
        {typeLocked ? (
          <div>
            <p className="text-body text-fg">Type</p>
            <p className="mt-1 text-small text-fg-subtle">
              <Mono>{MISSION_TYPE_LABELS[values.type].toUpperCase()}</Mono> — the type is fixed once
              a mission is published.
            </p>
            <input type="hidden" name="type" value={values.type} />
          </div>
        ) : (
          <FormField
            name="type"
            label="Type"
            description="Only team missions change mechanics: staff form teams and one submission counts for the team."
            required
          >
            <NativeSelect
              name="type"
              value={type}
              onChange={(event) => setType(event.target.value as MissionTypeKey)}
              options={optionsFrom(MISSION_TYPE_LABELS)}
            />
          </FormField>
        )}
        <FormField
          name="brief"
          label="Brief"
          description="What to do, what counts as done, and what evidence to bring."
          required
        >
          <Textarea
            name="brief"
            required
            minLength={10}
            maxLength={MISSION_LIMITS.briefMax}
            rows={8}
            defaultValue={values.brief}
          />
        </FormField>
        <FormField
          name="facetKey"
          label="Capability"
          description="A verified mission becomes evidence for this facet."
        >
          <NativeSelect
            name="facetKey"
            defaultValue={values.facetKey ?? ''}
            placeholder="No capability"
            options={facets}
          />
        </FormField>
      </Section>

      <Section title="PARTICIPATION">
        <div className="grid gap-5 sm:grid-cols-2">
          <FormField
            name="maxAssignees"
            label="Slots"
            description="Most members holding it at once. Blank for no cap."
          >
            <Input
              name="maxAssignees"
              type="number"
              inputMode="numeric"
              min={1}
              max={MISSION_LIMITS.maxAssignees}
              defaultValue={values.maxAssignees ?? ''}
            />
          </FormField>
          <FormField
            name="durationHours"
            label="Time limit (hours)"
            description="Per assignment, from when it starts. Blank for none."
          >
            <Input
              name="durationHours"
              type="number"
              inputMode="numeric"
              min={1}
              max={MISSION_LIMITS.durationHoursMax}
              defaultValue={values.durationHours ?? ''}
            />
          </FormField>
        </div>
        <FormField
          name="deadlineAt"
          label="Deadline (UTC)"
          description="The mission closes then; no work is due after it. Blank for none."
        >
          <Input
            name="deadlineAt"
            type="datetime-local"
            mono
            defaultValue={toUtcInputValue(values.deadlineAt)}
          />
        </FormField>
        <Switch
          id={`${id}-evidence`}
          name="evidenceRequired"
          defaultChecked={values.evidenceRequired}
          label="Evidence required"
          description="Submissions must carry a titled http(s) link."
        />
        <Checkbox
          id={`${id}-self`}
          name="selfAssignable"
          defaultChecked={values.selfAssignable && !team}
          disabled={team}
          label="Members can take it themselves"
          description={
            team
              ? 'Team missions are always assigned by staff.'
              : 'Shows ACCEPT on the Discord card and in lists. Otherwise staff assign it.'
          }
        />
      </Section>

      <Section title="REWARD">
        <FormField
          name="rewardAchievementKey"
          label="Reward achievement"
          description="Granted to each member when their work is verified. Never overrides a revocation."
        >
          <NativeSelect
            name="rewardAchievementKey"
            defaultValue={values.rewardAchievementKey ?? ''}
            placeholder="No reward"
            options={rewards}
          />
        </FormField>
        <FormField name="rewardNote" label="Reward note" description="Optional. One line.">
          <Input
            name="rewardNote"
            maxLength={MISSION_LIMITS.rewardNoteMax}
            defaultValue={values.rewardNote ?? ''}
          />
        </FormField>
      </Section>
    </ActionForm>
  );
}
