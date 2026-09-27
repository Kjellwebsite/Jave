'use client';

import { useActionState } from 'react';
import { FilePlus2, Undo2 } from 'lucide-react';
import type { applications } from '@jave/core';
import { Button, Textarea } from '@jave/ui';
import { IDLE_STATE } from '@/lib/action-state';
import { WITHDRAW_EXPECTATION_FIELDS } from '@/lib/applications';
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

/**
 * Withdraw (or discard a draft) after stating what it costs. The cost
 * depends on the status, so the form carries the application and status it
 * was stated for: if either changed before the click, nothing is withdrawn
 * and the dialog says what changed while the page restates the cost.
 */
export function WithdrawApplicationDialog({
  applicationId,
  status,
  number,
  cost,
  reasonMaxLength,
  action,
}: {
  applicationId: string;
  /** The open status the cost was stated for. */
  status: applications.ApplicationStatus;
  number: string;
  /** What withdrawing costs, stated before the click. */
  cost: string;
  /** core's APPLICATION_FIELD_LIMITS.withdrawReason. */
  reasonMaxLength: number;
  action: FormAction;
}) {
  const draft = status === 'draft';
  return (
    <ConfirmActionDialog
      eyebrow={number}
      title={draft ? 'Discard draft' : 'Withdraw application'}
      description={`${draft ? 'The draft closes. Staff never saw it.' : 'The application leaves the review queue and closes.'} ${cost}`}
      confirmLabel={draft ? 'Discard draft' : 'Withdraw application'}
      tone="danger"
      action={action}
      hidden={{
        [WITHDRAW_EXPECTATION_FIELDS.applicationId]: applicationId,
        [WITHDRAW_EXPECTATION_FIELDS.status]: status,
      }}
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
