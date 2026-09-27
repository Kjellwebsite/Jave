'use client';

import { Fieldset, Input, NativeSelect, Textarea } from '@jave/ui';
import { ActionForm, type FormAction } from '../forms/action-form';
import { FormField } from '../forms/form-field';

export interface DraftFormField {
  key: string;
  label: string;
  placeholder: string;
  input: 'select' | 'short' | 'paragraph';
  maxLength: number;
  required: boolean;
}

export interface DraftFormProps {
  fields: readonly DraftFormField[];
  values: Readonly<Record<string, string>>;
  domains: readonly { value: string; label: string }[];
  action: FormAction;
}

const PARAGRAPH_ROWS = 5;
const SHORT_PARAGRAPH_ROWS = 3;
const SHORT_PARAGRAPH_CHARS = 1000;

/** Fields grouped as the applicant thinks about them; keys come from APPLICATION_FORM_FIELDS. */
const GROUPS = [
  { legend: null, description: null, keys: ['domainKey', 'motivation', 'experience'] },
  {
    legend: 'Proof of work',
    description: 'Projects, a portfolio or evidence links. One is enough; more is better.',
    keys: ['projects', 'portfolioUrl', 'evidenceLinks'],
  },
  {
    legend: 'Staff only',
    description: 'Only staff with application access read these. Never posted in Discord.',
    keys: ['references', 'referralCode'],
  },
] as const;

const DESCRIPTIONS: Readonly<Record<string, string>> = {
  evidenceLinks: 'http(s) only, one per line, up to 10.',
};

/** What Field passes to its control: the label target, help text and error state. */
interface FieldWiring {
  id?: string;
  'aria-describedby'?: string;
  invalid?: boolean;
}

/**
 * One input for one form field. Forwards Field's wiring to the real control,
 * so the label, description and inline error attach to it.
 */
function Control({
  field,
  value,
  domains,
  ...wiring
}: {
  field: DraftFormField;
  value: string;
  domains: DraftFormProps['domains'];
} & FieldWiring) {
  if (field.input === 'select') {
    return (
      <NativeSelect
        {...wiring}
        name={field.key}
        defaultValue={value}
        placeholder="Choose a domain"
        options={domains}
      />
    );
  }
  if (field.input === 'paragraph') {
    return (
      <Textarea
        {...wiring}
        name={field.key}
        maxLength={field.maxLength}
        rows={field.maxLength > SHORT_PARAGRAPH_CHARS ? PARAGRAPH_ROWS : SHORT_PARAGRAPH_ROWS}
        placeholder={field.placeholder}
        defaultValue={value}
      />
    );
  }
  const url = field.key === 'portfolioUrl';
  return (
    <Input
      {...wiring}
      name={field.key}
      type={url ? 'url' : 'text'}
      inputMode={url ? 'url' : undefined}
      maxLength={field.maxLength}
      placeholder={field.placeholder}
      defaultValue={value}
      mono={field.key === 'referralCode'}
    />
  );
}

/**
 * The application form: every APPLICATION_FORM_FIELDS entry with the
 * service's own caps. Saving keeps it a private draft; nothing reaches staff
 * until the applicant submits. The service resolves the caller's own draft,
 * so the form carries no application id.
 */
export function DraftForm({ fields, values, domains, action }: DraftFormProps) {
  const byKey = new Map(fields.map((field) => [field.key, field]));
  return (
    <ActionForm action={action} submitLabel="Save draft" submitVariant="secondary">
      {GROUPS.map((group) => {
        const controls = group.keys.flatMap((key) => {
          const field = byKey.get(key);
          if (!field) return [];
          return [
            <FormField
              key={field.key}
              name={field.key}
              label={field.label.replace(' (staff only)', '')}
              description={DESCRIPTIONS[field.key]}
              required={field.required}
            >
              <Control field={field} value={values[field.key] ?? ''} domains={domains} />
            </FormField>,
          ];
        });
        if (!group.legend)
          return (
            <div key="about" className="space-y-5">
              {controls}
            </div>
          );
        // The divider sits on a wrapper: on a <fieldset> border the legend would cut into it.
        return (
          <div key={group.legend} className="border-t border-line-subtle pt-6">
            <Fieldset
              legend={<span className="type-eyebrow text-fg-subtle">{group.legend}</span>}
              description={group.description}
              className="space-y-5"
            >
              {controls}
            </Fieldset>
          </div>
        );
      })}
    </ActionForm>
  );
}
