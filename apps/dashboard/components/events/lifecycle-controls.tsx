'use client';

import { Ban, CircleCheck, Radio } from 'lucide-react';
import { Button, Input } from '@jave/ui';
import type { FormAction } from '../forms/action-form';
import { ConfirmActionDialog } from '../forms/confirm-action-dialog';
import { FormField } from '../forms/form-field';

export interface LifecycleControlsProps {
  eventId: string;
  eventTitle: string;
  /** Which transitions are available now (core re-checks every one). */
  canGoLive: boolean;
  canComplete: boolean;
  canCancel: boolean;
  cancelReasonMax: number;
  goLiveAction: FormAction;
  completeAction: FormAction;
  cancelAction: FormAction;
}

/**
 * Staff controls for an event's state: go live, complete, cancel. Every
 * dialog stays mounted and only its trigger hides when the transition is no
 * longer available: a transition removes its own button, and an unmounted
 * dialog could not announce the result.
 */
export function LifecycleControls({
  eventId,
  eventTitle,
  canGoLive,
  canComplete,
  canCancel,
  cancelReasonMax,
  goLiveAction,
  completeAction,
  cancelAction,
}: LifecycleControlsProps) {
  const hiddenUnless = (available: boolean) => (available ? undefined : 'hidden');
  return (
    <div className="flex flex-wrap gap-2">
      <ConfirmActionDialog
        eyebrow="EVENT"
        title="Go live"
        description={`Marks ${eventTitle} live. The Discord event starts and check-in stays open until the end.`}
        confirmLabel="Go live"
        action={goLiveAction}
        hidden={{ eventId }}
        trigger={
          <Button variant="primary" iconLeft={Radio} className={hiddenUnless(canGoLive)}>
            Go live
          </Button>
        }
      />
      <ConfirmActionDialog
        eyebrow="EVENT"
        title="Complete event"
        description={`Closes ${eventTitle}. Attendance is final; RSVPs and check-in close.`}
        confirmLabel="Complete event"
        action={completeAction}
        hidden={{ eventId }}
        trigger={
          <Button
            variant={canGoLive ? 'secondary' : 'primary'}
            iconLeft={CircleCheck}
            className={hiddenUnless(canComplete)}
          >
            Complete
          </Button>
        }
      />
      <ConfirmActionDialog
        eyebrow="EVENT"
        title="Cancel event"
        description={`Cancels ${eventTitle}. Everyone who responded is notified with your reason, and the Discord event is withdrawn.`}
        confirmLabel="Cancel event"
        tone="danger"
        action={cancelAction}
        hidden={{ eventId }}
        trigger={
          <Button variant="ghost" iconLeft={Ban} className={hiddenUnless(canCancel)}>
            Cancel event
          </Button>
        }
      >
        <FormField
          name="reason"
          label="Reason"
          description="Sent to attendees and shown on the announcement."
          required
        >
          <Input name="reason" required minLength={3} maxLength={cancelReasonMax} />
        </FormField>
      </ConfirmActionDialog>
    </div>
  );
}
