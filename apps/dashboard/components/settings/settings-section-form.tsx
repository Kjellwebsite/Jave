'use client';

import type { ReactNode } from 'react';
import {
  Callout,
  Checkbox,
  cx,
  Input,
  Mono,
  NativeSelect,
  RoleBadge,
  Switch,
  Textarea,
} from '@jave/ui';
import type { RoleKey } from '@jave/ui/roles';
import { ROLE_OPTIONS, type SettingsField, settingsSpec, valueAtPath } from '@/lib/settings-form';
import { minutesToTime } from '@/lib/time';
import { ActionForm, type FormAction, useActionFieldError } from '../forms/action-form';

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const DEFAULT_QUIET = { start: 22 * 60, end: 7 * 60 };

function FieldError({ path }: { path: string }) {
  const error = useActionFieldError(path);
  return error ? (
    <p role="alert" className="mt-1.5 text-small text-danger">
      {error}
    </p>
  ) : null;
}

function Row({
  field,
  control,
  stacked = false,
}: {
  field: SettingsField;
  control: ReactNode;
  stacked?: boolean;
}) {
  const id = `setting-${field.path}`;
  return (
    <div
      className={cx(
        'grid gap-2 border-b border-line-subtle py-4 last:border-0',
        !stacked && 'md:grid-cols-[minmax(0,1fr)_minmax(0,300px)] md:items-start md:gap-8',
      )}
    >
      <div className="min-w-0">
        {stacked ? (
          <p id={`${id}-label`} className="text-body text-fg">
            {field.label}
          </p>
        ) : (
          <label htmlFor={id} className="text-body text-fg">
            {field.label}
          </label>
        )}
        {field.description ? (
          <p className="mt-0.5 text-small text-fg-subtle">{field.description}</p>
        ) : null}
      </div>
      <div
        className="min-w-0"
        {...(stacked ? { role: 'group', 'aria-labelledby': `${id}-label` } : {})}
      >
        {control}
        <FieldError path={field.path} />
      </div>
    </div>
  );
}

function asString(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function SettingControl({ field, value }: { field: SettingsField; value: unknown }) {
  const id = `setting-${field.path}`;
  const { control } = field;
  switch (control.kind) {
    case 'text':
      return (
        <Row
          field={field}
          control={
            <Input
              id={id}
              name={field.path}
              defaultValue={asString(value)}
              maxLength={control.maxLength}
            />
          }
        />
      );
    case 'color': {
      const color = asString(value);
      return (
        <Row
          field={field}
          control={
            <span className="flex items-center gap-2">
              <span
                aria-hidden
                className="size-9 shrink-0 rounded-md border border-line-strong"
                style={HEX_COLOR.test(color) ? { backgroundColor: color } : undefined}
              />
              <Input
                id={id}
                name={field.path}
                defaultValue={color}
                maxLength={7}
                mono
                pattern="#[0-9a-fA-F]{6}"
              />
            </span>
          }
        />
      );
    }
    case 'integer':
    case 'decimal':
      return (
        <Row
          field={field}
          control={
            <span className="relative block">
              <Input
                id={id}
                name={field.path}
                type="number"
                inputMode={control.kind === 'integer' ? 'numeric' : 'decimal'}
                defaultValue={asString(value)}
                min={control.min}
                max={control.max}
                step={control.kind === 'decimal' ? control.step : 1}
                mono
                className="pr-14"
              />
              {control.kind === 'integer' && control.unit ? (
                <Mono
                  dim
                  className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px]"
                >
                  {control.unit}
                </Mono>
              ) : null}
            </span>
          }
        />
      );
    case 'boolean':
      return (
        <div className="border-b border-line-subtle py-4 last:border-0">
          <Switch
            id={id}
            name={field.path}
            defaultChecked={value === true}
            label={field.label}
            description={field.description}
          />
          <FieldError path={field.path} />
        </div>
      );
    case 'select':
      return (
        <Row
          field={field}
          control={
            <NativeSelect
              id={id}
              name={field.path}
              defaultValue={asString(value)}
              options={control.options}
            />
          }
        />
      );
    case 'role':
      return (
        <Row
          field={field}
          control={
            <NativeSelect
              id={id}
              name={field.path}
              defaultValue={asString(value)}
              options={ROLE_OPTIONS}
            />
          }
        />
      );
    case 'snowflake':
      return (
        <Row
          field={field}
          control={
            <Input
              id={id}
              name={field.path}
              defaultValue={asString(value)}
              placeholder="Not set"
              inputMode="numeric"
              maxLength={20}
              mono
            />
          }
        />
      );
    case 'roleSnowflakes': {
      const map = (value && typeof value === 'object' ? value : {}) as Record<string, string>;
      return (
        <Row
          stacked
          field={field}
          control={
            <div className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
              {ROLE_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className="grid grid-cols-[112px_minmax(0,1fr)] items-center gap-3"
                >
                  <span>
                    <RoleBadge role={option.value} size="sm" />
                  </span>
                  <Input
                    name={`${field.path}.${option.value}`}
                    defaultValue={map[option.value] ?? ''}
                    placeholder="Not mapped"
                    aria-label={`${option.label} Discord role ID`}
                    inputMode="numeric"
                    maxLength={20}
                    size="sm"
                    mono
                  />
                </label>
              ))}
            </div>
          }
        />
      );
    }
    case 'domains':
      return (
        <Row
          field={field}
          control={
            <Textarea
              id={id}
              name={field.path}
              defaultValue={Array.isArray(value) ? value.join('\n') : ''}
              rows={4}
              className="font-mono text-small"
              spellCheck={false}
            />
          }
        />
      );
    case 'minuteList':
      return (
        <Row
          field={field}
          control={
            <Input
              id={id}
              name={field.path}
              defaultValue={Array.isArray(value) ? value.join(', ') : ''}
              mono
            />
          }
        />
      );
    case 'roles': {
      const held = new Set(Array.isArray(value) ? (value as string[]) : []);
      return (
        <Row
          stacked
          field={field}
          control={
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {ROLE_OPTIONS.map((option) => (
                <Checkbox
                  key={option.value}
                  id={`${id}-${option.value}`}
                  name={field.path}
                  value={option.value}
                  defaultChecked={held.has(option.value as RoleKey)}
                  label={option.label}
                />
              ))}
            </div>
          }
        />
      );
    }
    case 'quietHours': {
      const range = (value && typeof value === 'object' ? value : null) as {
        start: number;
        end: number;
      } | null;
      return (
        <div className="space-y-3 border-b border-line-subtle py-4 last:border-0">
          <Switch
            id={id}
            name={`${field.path}.enabled`}
            defaultChecked={range !== null}
            label={field.label}
            description={field.description}
          />
          <div className="grid max-w-sm grid-cols-2 gap-3">
            <label className="space-y-1.5">
              <span className="text-small text-fg-subtle">From</span>
              <Input
                name={`${field.path}.start`}
                type="time"
                defaultValue={minutesToTime((range ?? DEFAULT_QUIET).start)}
                mono
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-small text-fg-subtle">Until</span>
              <Input
                name={`${field.path}.end`}
                type="time"
                defaultValue={minutesToTime((range ?? DEFAULT_QUIET).end)}
                mono
              />
            </label>
          </div>
          <FieldError path={field.path} />
        </div>
      );
    }
  }
}

export function SettingsSectionForm({
  section,
  values,
  readOnly,
  action,
}: {
  section: string;
  values: Record<string, unknown>;
  readOnly: boolean;
  action: FormAction;
}) {
  const spec = settingsSpec(section);
  if (!spec) return null;
  return (
    <ActionForm
      action={action}
      submitLabel={`Save ${spec.title.toLowerCase()}`}
      readOnly={readOnly}
      aria-label={`${spec.title} settings`}
    >
      {readOnly ? (
        <Callout tone="neutral" title="READ-ONLY">
          You can view these settings. Changing them requires <Mono>canManageSettings</Mono>.
        </Callout>
      ) : null}
      <div>
        {spec.fields.map((field) => (
          <SettingControl key={field.path} field={field} value={valueAtPath(values, field.path)} />
        ))}
      </div>
    </ActionForm>
  );
}
