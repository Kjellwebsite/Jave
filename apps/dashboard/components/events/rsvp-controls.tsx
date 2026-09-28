'use client';

import { useActionState } from 'react';
import { Button } from '@jave/ui';
import { IDLE_STATE } from '@/lib/action-state';
import { RSVP_LABELS, type RsvpChoice } from '@/lib/event-labels';
import { ActionFeedback, type FormAction } from '../forms/action-form';

export interface RsvpControlsProps {
  eventId: string;
  action: FormAction;
  /** The member's current response (waitlist counts as going). */
  current: 'going' | 'maybe' | 'declined' | 'waitlist' | null;
  rsvpOpen: boolean;
  declineOpen: boolean;
}

const BUTTON_LABEL: Record<RsvpChoice, string> = {
  going: RSVP_LABELS.going,
  maybe: RSVP_LABELS.maybe,
  declined: 'Decline',
};

/** Going / Maybe / Decline. The current answer is pressed; closed answers are hidden. */
export function RsvpControls({
  eventId,
  action,
  current,
  rsvpOpen,
  declineOpen,
}: RsvpControlsProps) {
  const [state, dispatch, pending] = useActionState(action, IDLE_STATE);
  const choices: RsvpChoice[] = [
    ...(rsvpOpen ? (['going', 'maybe'] as const) : []),
    ...(declineOpen ? (['declined'] as const) : []),
  ];
  if (choices.length === 0) return null;
  const pressed = (choice: RsvpChoice) =>
    current === choice || (choice === 'going' && current === 'waitlist');
  return (
    <div className="space-y-3">
      <form action={dispatch} className="flex flex-wrap gap-2" aria-label="Your response">
        <input type="hidden" name="eventId" value={eventId} />
        {choices.map((choice) => (
          <Button
            key={choice}
            type="submit"
            name="status"
            value={choice}
            size="sm"
            variant={pressed(choice) ? 'primary' : 'secondary'}
            aria-pressed={pressed(choice)}
            disabled={pending || pressed(choice)}
          >
            {BUTTON_LABEL[choice]}
          </Button>
        ))}
      </form>
      <ActionFeedback state={state} />
    </div>
  );
}
