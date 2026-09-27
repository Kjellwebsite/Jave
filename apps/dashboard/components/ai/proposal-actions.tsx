'use client';

import { Check, X } from 'lucide-react';
import { Button, Textarea } from '@jave/ui';
import type { FormAction } from '../forms/action-form';
import { ConfirmActionDialog } from '../forms/confirm-action-dialog';
import { FormField } from '../forms/form-field';

export interface ProposalActionsProps {
  proposalId: string;
  kindLabel: string;
  preview: string;
  /** What confirming does, e.g. "Creates a mission in DRAFT." */
  consequence: string;
  /** Says exactly what happens: "Create draft mission". */
  confirmLabel: string;
  canConfirm: boolean;
  /** The viewer drafted it: rejecting withdraws it. */
  isOwn: boolean;
  confirmAction: FormAction;
  rejectAction: FormAction;
}

const MAX_REASON_LENGTH = 500;

/**
 * CONFIRM (executes exactly the preview) and REJECT for one pending proposal.
 * Both controls leave the page once the proposal is decided; the dialog
 * announces the result itself.
 */
export function ProposalActions({
  proposalId,
  kindLabel,
  preview,
  consequence,
  confirmLabel,
  canConfirm,
  isOwn,
  confirmAction,
  rejectAction,
}: ProposalActionsProps) {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <ConfirmActionDialog
        eyebrow="REJECT"
        title={isOwn ? 'Withdraw proposal' : 'Reject proposal'}
        description={
          isOwn
            ? 'Nothing executes. The proposal is closed.'
            : 'Nothing executes. The member who drafted it is notified.'
        }
        confirmLabel={isOwn ? 'Withdraw proposal' : 'Reject proposal'}
        tone="danger"
        action={rejectAction}
        hidden={{ proposalId }}
        trigger={
          <Button variant="ghost" size="sm" iconLeft={X} data-testid="reject-proposal">
            {isOwn ? 'Withdraw' : 'Reject'}
          </Button>
        }
      >
        <FormField name="reason" label="Reason" description="Optional. Shown to the requester.">
          <Textarea name="reason" maxLength={MAX_REASON_LENGTH} rows={3} />
        </FormField>
      </ConfirmActionDialog>
      {canConfirm ? (
        <ConfirmActionDialog
          eyebrow={`CONFIRM · ${kindLabel.toUpperCase()}`}
          title={confirmLabel}
          description={`${consequence} Executes exactly the preview below, as you.`}
          confirmLabel={confirmLabel}
          action={confirmAction}
          hidden={{ proposalId }}
          trigger={
            <Button variant="secondary" size="sm" iconLeft={Check} data-testid="confirm-proposal">
              Confirm
            </Button>
          }
        >
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-canvas p-3 font-mono text-[12px] leading-relaxed text-fg-muted">
            {preview}
          </pre>
        </ConfirmActionDialog>
      ) : null}
    </div>
  );
}
