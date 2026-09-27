'use client';

import { Textarea } from '@jave/ui';
import { ActionForm, type FormAction } from '../forms/action-form';
import { FormField } from '../forms/form-field';

/** Core's longest draft brief (ai.MAX_DRAFT_BRIEF_LENGTH). */
const MAX_BRIEF_LENGTH = 4000;
const BRIEF_ROWS = 4;

export interface DraftFormProps {
  action: FormAction;
  label: string;
  description: string;
  placeholder: string;
  submitLabel: string;
}

/** SUGGEST → PREVIEW: the model drafts, JAVE stores a pending proposal. Nothing executes. */
export function DraftForm({
  action,
  label,
  description,
  placeholder,
  submitLabel,
}: DraftFormProps) {
  return (
    <ActionForm
      action={action}
      submitLabel={submitLabel}
      submitVariant="secondary"
      resetOnSuccess
      aria-label={label}
    >
      <FormField name="brief" label={label} description={description} required>
        <Textarea
          name="brief"
          required
          maxLength={MAX_BRIEF_LENGTH}
          rows={BRIEF_ROWS}
          placeholder={placeholder}
        />
      </FormField>
    </ActionForm>
  );
}
