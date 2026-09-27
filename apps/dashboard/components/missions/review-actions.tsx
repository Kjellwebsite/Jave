'use client';

import { Button, Textarea } from '@jave/ui';
import type { FormAction } from '../forms/action-form';
import { ConfirmActionDialog } from '../forms/confirm-action-dialog';
import { FormField } from '../forms/form-field';

const FEEDBACK_MAX = 2000;

/** VERIFY (optional feedback) and REJECT (required feedback) for one review unit. */
export function ReviewActions({
  assignmentId,
  unitLabel,
  verifyAction,
  rejectAction,
}: {
  assignmentId: string;
  /** "Mara Voss" or "Team alpha (3 members)". */
  unitLabel: string;
  verifyAction: FormAction;
  rejectAction: FormAction;
}) {
  const hidden = { assignmentId };
  return (
    <div className="flex flex-wrap gap-2">
      <ConfirmActionDialog
        eyebrow="REVIEW"
        title="Verify submission"
        description={`${unitLabel}: verified work becomes evidence on the record, grants any reward and counts toward achievements.`}
        confirmLabel="Verify"
        action={verifyAction}
        hidden={hidden}
        trigger={
          <Button size="sm" variant="secondary" data-testid={`verify-${assignmentId}`}>
            Verify
          </Button>
        }
      >
        <FormField name="feedback" label="Feedback" description="Optional. Shown with the result.">
          <Textarea name="feedback" maxLength={FEEDBACK_MAX} rows={3} />
        </FormField>
      </ConfirmActionDialog>
      <ConfirmActionDialog
        eyebrow="REVIEW"
        title="Return submission"
        description={`${unitLabel} can resubmit while attempts remain. Say exactly what is missing.`}
        confirmLabel="Return submission"
        tone="danger"
        action={rejectAction}
        hidden={hidden}
        trigger={
          <Button size="sm" variant="ghost" data-testid={`reject-${assignmentId}`}>
            Reject
          </Button>
        }
      >
        <FormField
          name="feedback"
          label="Feedback"
          description="Required. The member sees it."
          required
        >
          <Textarea name="feedback" required minLength={3} maxLength={FEEDBACK_MAX} rows={4} />
        </FormField>
      </ConfirmActionDialog>
    </div>
  );
}
