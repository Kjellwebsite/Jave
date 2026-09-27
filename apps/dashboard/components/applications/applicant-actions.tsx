'use client';

import { useActionState } from 'react';
import { FilePlus2, Send, Undo2 } from 'lucide-react';
import { Button, Textarea } from '@jave/ui';
import { IDLE_STATE } from '@/lib/action-state';
import { ActionFeedback, type FormAction } from '../forms/action-form';
import { ConfirmActionDialog } from '../forms/confirm-action-dialog';
import { FormField } from '../forms/form-field';

/** One button that opens a private draft. Feedback (e.g. applications paused) shows below it. */
export function StartApplicationButton({ action, label }: { action: FormAction; label: string }) {
  const [state, dispatch, pending] = useActionState(action, IDLE_STATE);
  return (
    <form action={dispatch} className="space-y-3">
      <Button type="submit" variant="primary" iconLeft={FilePlus2} loading={pending}>
        {label}
      </Button>
      {state.status === 'error' ? <ActionFeedback state={state} /> : null}
    </form>
  );
}

export function SubmitApplicationDialog({
  number,
  action,
}: {
  number: string;
  action: FormAction;
}) {
  return (
    <ConfirmActionDialog
      eyebrow={number}
      title="Submit application"
      description="Staff can read it from now on, and the answers lock. You are told when a reviewer picks it up and when there is a decision. Withdrawing later starts a short cooldown."
      confirmLabel="Submit application"
      action={action}
      trigger={
        <Button variant="primary" iconLeft={Send} className="w-full">
          Submit application
        </Button>
      }
    />
  );
}

export function WithdrawApplicationDialog({
  number,
  draft,
  cost,
  reasonMaxLength,
  action,
}: {
  number: string;
  draft: boolean;
  /** What withdrawing costs, stated before the click. */
  cost: string;
  /** core's APPLICATION_FIELD_LIMITS.withdrawReason. */
  reasonMaxLength: number;
  action: FormAction;
}) {
  return (
    <ConfirmActionDialog
      eyebrow={number}
      title={draft ? 'Discard draft' : 'Withdraw application'}
      description={`${draft ? 'The draft closes. Staff never saw it.' : 'The application leaves the review queue and closes.'} ${cost}`}
      confirmLabel={draft ? 'Discard draft' : 'Withdraw application'}
      tone="danger"
      action={action}
      trigger={
        <Button variant="ghost" iconLeft={Undo2} className="w-full">
          {draft ? 'Discard draft' : 'Withdraw'}
        </Button>
      }
    >
      {draft ? null : (
        <FormField name="reason" label="Reason" description="Optional. Kept with the application.">
          <Textarea name="reason" maxLength={reasonMaxLength} rows={3} />
        </FormField>
      )}
    </ConfirmActionDialog>
  );
}
