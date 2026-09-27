'use client';

import { Textarea } from '@jave/ui';
import { ActionForm, type FormAction } from '../forms/action-form';
import { FormField } from '../forms/form-field';

const NOTE_MAX = 4000;
const NOTE_ROWS = 3;

/** Staff-only note on the ticket. Never posted to the thread, never shown to the requester. */
export function TicketNoteForm({ ticketId, action }: { ticketId: string; action: FormAction }) {
  return (
    <ActionForm
      action={action}
      submitLabel="Add internal note"
      submitVariant="secondary"
      resetOnSuccess
      aria-label="Add internal note"
    >
      <input type="hidden" name="ticketId" value={ticketId} />
      <FormField
        name="body"
        label="Internal note"
        description="Staff only. Never posted to the thread or shown to the requester."
        required
      >
        <Textarea
          name="body"
          required
          maxLength={NOTE_MAX}
          rows={NOTE_ROWS}
          placeholder="What should the next handler know?"
        />
      </FormField>
    </ActionForm>
  );
}
