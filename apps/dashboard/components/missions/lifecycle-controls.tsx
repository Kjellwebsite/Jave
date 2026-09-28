'use client';

import { useId } from 'react';
import { Button, Checkbox } from '@jave/ui';
import type { MissionStatusKey } from '@/lib/mission-labels';
import type { FormAction } from '../forms/action-form';
import { ConfirmActionDialog } from '../forms/confirm-action-dialog';

export interface LifecycleActions {
  publish: FormAction;
  close: FormAction;
  reopen: FormAction;
  archive: FormAction;
}

function blockedArchiveCopy(awaitingReview: number): string {
  return awaitingReview === 1
    ? 'One submission still awaits review. Decide it first; archiving is refused until then.'
    : `${awaitingReview} submissions still await review. Decide them first; archiving is refused until then.`;
}

/** Publish, close, reopen and archive — each behind a confirmation that states the consequence. */
export function LifecycleControls({
  missionId,
  headline,
  status,
  awaitingReview,
  actions,
}: {
  missionId: string;
  headline: string;
  status: MissionStatusKey;
  awaitingReview: number;
  actions: LifecycleActions;
}) {
  const id = useId();
  const hidden = { missionId };
  return (
    <>
      {status === 'draft' ? (
        <ConfirmActionDialog
          eyebrow="MISSIONS"
          title="Publish mission"
          description={`${headline} opens to members immediately.`}
          confirmLabel="Publish mission"
          action={actions.publish}
          hidden={hidden}
          trigger={
            <Button variant="primary" data-testid="publish-mission">
              Publish
            </Button>
          }
        >
          <Checkbox
            id={`${id}-announce`}
            name="announce"
            defaultChecked
            label="Announce in Discord"
            description="Posts the mission card with ACCEPT in the missions channel."
          />
        </ConfirmActionDialog>
      ) : null}
      {status === 'open' ? (
        <ConfirmActionDialog
          eyebrow="MISSIONS"
          title="Close mission"
          description={`${headline} stops taking new assignments. Work in progress continues until it is due.`}
          confirmLabel="Close mission"
          action={actions.close}
          hidden={hidden}
          trigger={<Button variant="secondary">Close</Button>}
        />
      ) : null}
      {status === 'closed' ? (
        <ConfirmActionDialog
          eyebrow="MISSIONS"
          title="Reopen mission"
          description={`${headline} takes new assignments again. A deadline, if set, must still be ahead.`}
          confirmLabel="Reopen mission"
          action={actions.reopen}
          hidden={hidden}
          trigger={<Button variant="secondary">Reopen</Button>}
        />
      ) : null}
      {status === 'draft' || status === 'closed' ? (
        <ConfirmActionDialog
          eyebrow="MISSIONS"
          title="Archive mission"
          description={
            awaitingReview > 0
              ? blockedArchiveCopy(awaitingReview)
              : `${headline} is archived for good. Work in progress expires with a notice to each member.`
          }
          confirmLabel="Archive mission"
          tone="danger"
          action={actions.archive}
          hidden={hidden}
          trigger={<Button variant="ghost">Archive</Button>}
        />
      ) : null}
    </>
  );
}
