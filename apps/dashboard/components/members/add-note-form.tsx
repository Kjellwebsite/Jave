'use client';

import { Textarea } from '@jave/ui';
import { ActionForm, type FormAction } from '../forms/action-form';
import { FormField } from '../forms/form-field';

export function AddNoteForm({ memberId, action }: { memberId: string; action: FormAction }) {
  return (
    <ActionForm action={action} submitLabel="Add note" resetOnSuccess className="mt-4">
      <input type="hidden" name="memberId" value={memberId} />
      <FormField name="body" label="Note" hideLabel required>
        <Textarea
          name="body"
          required
          maxLength={4000}
          rows={4}
          placeholder="What should other staff know?"
        />
      </FormField>
    </ActionForm>
  );
}
