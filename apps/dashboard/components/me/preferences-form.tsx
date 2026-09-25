'use client';

import { useState } from 'react';
import { Checkbox, Fieldset, Input, NativeSelect, Switch } from '@jave/ui';
import { minutesToTime } from '@/lib/time';
import { ActionForm, type FormAction, useActionFieldError } from '../forms/action-form';
import { FormField } from '../forms/form-field';

export interface NotificationTypeOption {
  type: string;
  label: string;
  description: string;
  enabled: boolean;
}

export interface PreferencesValues {
  timezone: string;
  quietHours: { start: number; end: number } | null;
  dmNotifications: boolean;
}

const DEFAULT_QUIET_START = 22 * 60;
const DEFAULT_QUIET_END = 7 * 60;

function QuietHoursError() {
  const error = useActionFieldError('quietHours');
  return error ? (
    <p role="alert" className="text-small text-danger">
      {error}
    </p>
  ) : null;
}

export function PreferencesForm({
  values,
  timeZones,
  types,
  action,
}: {
  values: PreferencesValues;
  timeZones: readonly string[];
  types: readonly NotificationTypeOption[];
  action: FormAction;
}) {
  const [quiet, setQuiet] = useState(values.quietHours !== null);
  return (
    <ActionForm action={action} submitLabel="Save preferences" aria-label="Preferences">
      <FormField
        name="timezone"
        label="Time zone"
        description="Used for quiet hours and every timestamp you see."
      >
        <NativeSelect
          name="timezone"
          defaultValue={values.timezone}
          options={timeZones.map((zone) => ({ value: zone, label: zone }))}
        />
      </FormField>

      <div className="space-y-4 rounded-md border border-line-subtle bg-surface-sunken p-4">
        <Switch
          id="quietHoursEnabled"
          name="quietHours.enabled"
          checked={quiet}
          onCheckedChange={setQuiet}
          label="Quiet hours"
          description="Non-critical Discord DMs wait until quiet hours end. Security alerts always arrive."
        />
        {quiet ? (
          <div className="grid max-w-sm grid-cols-2 gap-3">
            <FormField name="quietHours.start" label="From">
              <Input
                name="quietHours.start"
                type="time"
                required
                defaultValue={minutesToTime(values.quietHours?.start ?? DEFAULT_QUIET_START)}
                mono
              />
            </FormField>
            <FormField name="quietHours.end" label="Until">
              <Input
                name="quietHours.end"
                type="time"
                required
                defaultValue={minutesToTime(values.quietHours?.end ?? DEFAULT_QUIET_END)}
                mono
              />
            </FormField>
          </div>
        ) : null}
        <QuietHoursError />
        <Switch
          id="dmNotifications"
          name="dmNotifications"
          defaultChecked={values.dmNotifications}
          label="Discord DMs"
          description="Turn off to receive notifications only in this dashboard."
        />
      </div>

      <Fieldset
        legend="Discord DM by type"
        description="Your dashboard inbox always receives everything."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {types.map((option) => (
            <div key={option.type}>
              <input type="hidden" name="notificationType" value={option.type} />
              <Checkbox
                id={`notify-${option.type}`}
                name={`notify.${option.type}`}
                defaultChecked={option.enabled}
                label={option.label}
                description={option.description}
              />
            </div>
          ))}
        </div>
      </Fieldset>
    </ActionForm>
  );
}
