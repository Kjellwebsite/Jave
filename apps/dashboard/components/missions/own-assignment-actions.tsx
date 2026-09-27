'use client';

import { Button, Input, Textarea } from '@jave/ui';
import type { FormAction } from '../forms/action-form';
import { ConfirmActionDialog } from '../forms/confirm-action-dialog';
import { FormField } from '../forms/form-field';

const SUBMISSION_MAX = 4000;
const EVIDENCE_TITLE_MAX = 200;
const EVIDENCE_URL_MAX = 2048;

export interface OwnAssignmentActionsProps {
  missionId: string;
  headline: string;
  canAccept: boolean;
  canSubmit: boolean;
  canAbandon: boolean;
  evidenceRequired: boolean;
  team: boolean;
  /** Prefill after a rejection. */
  previousSubmission: string | null;
  acceptAction: FormAction;
  submitAction: FormAction;
  abandonAction: FormAction;
}

/** The member's own controls: accept, submit (with evidence), abandon. */
export function OwnAssignmentActions({
  missionId,
  headline,
  canAccept,
  canSubmit,
  canAbandon,
  evidenceRequired,
  team,
  previousSubmission,
  acceptAction,
  submitAction,
  abandonAction,
}: OwnAssignmentActionsProps) {
  const hidden = { missionId };
  return (
    <div className="flex flex-wrap gap-2">
      {canAccept ? (
        <ConfirmActionDialog
          eyebrow="MISSION"
          title="Accept mission"
          description={`${headline}. The clock starts now if the mission has a time limit.`}
          confirmLabel="Accept mission"
          action={acceptAction}
          hidden={hidden}
          trigger={
            <Button variant="primary" data-testid="accept-mission">
              Accept
            </Button>
          }
        />
      ) : null}
      {canSubmit ? (
        <ConfirmActionDialog
          eyebrow="MISSION"
          title="Submit work"
          description={
            team
              ? 'One submission counts for your whole team. A reviewer verifies it.'
              : 'A reviewer verifies it. The result arrives as a notification.'
          }
          confirmLabel="Send submission"
          action={submitAction}
          hidden={hidden}
          trigger={
            <Button variant="primary" data-testid="submit-mission">
              {previousSubmission ? 'Resubmit' : 'Submit'}
            </Button>
          }
        >
          <FormField name="submission" label="Submission" required>
            <Textarea
              name="submission"
              required
              maxLength={SUBMISSION_MAX}
              rows={6}
              defaultValue={previousSubmission ?? ''}
            />
          </FormField>
          <FormField
            name="evidence.title"
            label="Evidence title"
            description={evidenceRequired ? 'Required for this mission.' : 'Optional.'}
            required={evidenceRequired}
          >
            <Input
              name="evidenceTitle"
              required={evidenceRequired}
              maxLength={EVIDENCE_TITLE_MAX}
            />
          </FormField>
          <FormField name="evidence.url" label="Evidence link" description="http(s) only.">
            <Input
              name="evidenceUrl"
              type="url"
              inputMode="url"
              required={evidenceRequired}
              maxLength={EVIDENCE_URL_MAX}
              placeholder="https://"
            />
          </FormField>
        </ConfirmActionDialog>
      ) : null}
      {canAbandon ? (
        <ConfirmActionDialog
          eyebrow="MISSION"
          title="Abandon mission"
          description={`${headline}. You cannot take it again yourself; only staff can reassign you.`}
          confirmLabel="Abandon mission"
          tone="danger"
          action={abandonAction}
          hidden={hidden}
          trigger={<Button variant="ghost">Abandon</Button>}
        />
      ) : null}
    </div>
  );
}
