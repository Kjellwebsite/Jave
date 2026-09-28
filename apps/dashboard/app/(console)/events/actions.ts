'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { calendar, getMyPreferences, isUuid, ValidationError } from '@jave/core';
import type { ActionState } from '@/lib/action-state';
import type { CheckInCodeState } from '@/lib/check-in-code-state';
import {
  EVENT_FORM_FIELDS,
  EventFormError,
  readEventForm,
  scheduleInput,
  untouchedTimeFields,
  updateInput,
} from '@/lib/event-form';
import { RSVP_CHOICES, RSVP_LABELS } from '@/lib/event-labels';
import { formEnum, formString } from '@/lib/form-data';
import { formatTimestamp } from '@/lib/time';
import { runAction } from '@/server/actions';
import type { UserContext } from '@/server/context';

/** The event a form acts on. Ids route; the services authorize. */
function eventIdFrom(data: FormData): string {
  const eventId = formString(data, 'eventId');
  if (!isUuid(eventId)) throw new ValidationError('Unknown event.');
  return eventId;
}

function refresh(eventId?: string): void {
  revalidatePath('/events');
  if (eventId) revalidatePath(`/events/${eventId}`);
}

async function viewerTimeZone(ctx: UserContext): Promise<string> {
  return (await getMyPreferences(ctx)).timezone;
}

/** Form-level refusals become field errors, like core's own validation issues. */
async function readForm(ctx: UserContext, data: FormData) {
  try {
    return readEventForm(data, await viewerTimeZone(ctx));
  } catch (error) {
    if (error instanceof EventFormError) {
      throw new ValidationError(`${error.field}: ${error.issue}`, [
        { path: error.field, message: error.issue },
      ]);
    }
    throw error;
  }
}

const FORM_FIELD_NAMES: ReadonlySet<string> = new Set(EVENT_FORM_FIELDS);

/**
 * A refusal pinned to the form's own fields: the details sit on those fields,
 * so the line above the form stays calm instead of repeating a field path.
 */
function summarizeFieldErrors(state: ActionState): ActionState {
  if (state.status !== 'error' || !state.fieldErrors) return state;
  const fields = Object.keys(state.fieldErrors);
  if (fields.length === 0 || !fields.every((field) => FORM_FIELD_NAMES.has(field))) return state;
  return { ...state, message: 'NOT SAVED — check the marked fields.' };
}

export async function createEventAction(_: ActionState, data: FormData): Promise<ActionState> {
  const state = await runAction(
    'event.schedule',
    async (ctx) => {
      const event = await calendar.scheduleEvent(ctx, scheduleInput(await readForm(ctx, data)));
      refresh(event.id);
      redirect(`/events/${event.id}`);
    },
    { fieldNames: EVENT_FORM_FIELDS },
  );
  return summarizeFieldErrors(state);
}

export async function updateEventAction(_: ActionState, data: FormData): Promise<ActionState> {
  const state = await runAction(
    'event.update',
    async (ctx) => {
      const eventId = eventIdFrom(data);
      const event = await calendar.updateEvent(
        ctx,
        updateInput(eventId, await readForm(ctx, data), untouchedTimeFields(data)),
      );
      refresh(eventId);
      return `EVENT UPDATED — ${event.title}.`;
    },
    { fieldNames: EVENT_FORM_FIELDS },
  );
  return summarizeFieldErrors(state);
}

export async function cancelEventAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction(
    'event.cancel',
    async (ctx) => {
      const eventId = eventIdFrom(data);
      const event = await calendar.cancelEvent(ctx, {
        eventId,
        reason: formString(data, 'reason'),
      });
      refresh(eventId);
      return `EVENT CANCELLED — ${event.title}. Everyone who responded is notified.`;
    },
    { fieldNames: ['reason'] },
  );
}

export async function goLiveAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction('event.live', async (ctx) => {
    const eventId = eventIdFrom(data);
    const event = await calendar.markEventLive(ctx, { eventId });
    refresh(eventId);
    return `EVENT LIVE — ${event.title}. Check-in is open.`;
  });
}

export async function completeEventAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction('event.complete', async (ctx) => {
    const eventId = eventIdFrom(data);
    const event = await calendar.completeEvent(ctx, { eventId });
    refresh(eventId);
    return `EVENT COMPLETED — ${event.counts.checkedIn} checked in of ${event.counts.going} going.`;
  });
}

export async function rsvpAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction('event.rsvp', async (ctx) => {
    const eventId = eventIdFrom(data);
    const status = formEnum(data, 'status', RSVP_CHOICES);
    if (!status) throw new ValidationError('Choose going, maybe or decline.');
    const result = await calendar.rsvp(ctx, { eventId, status });
    refresh(eventId);
    if (result.status === 'waitlist') {
      const position = result.waitlistPosition === null ? '' : ` #${result.waitlistPosition}`;
      return `WAITLIST${position} — the event is full. You move up automatically when a spot opens.`;
    }
    return `RSVP RECORDED — ${RSVP_LABELS[result.status].toUpperCase()}.`;
  });
}

export async function checkInAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction(
    'event.check_in',
    async (ctx) => {
      const eventId = eventIdFrom(data);
      const result = await calendar.checkIn(ctx, { eventId, code: formString(data, 'code') });
      refresh(eventId);
      return result.alreadyCheckedIn ? 'ALREADY CHECKED IN.' : 'CHECKED IN — attendance recorded.';
    },
    { fieldNames: ['code'] },
  );
}

/**
 * Issue (or rotate) the check-in code. The plaintext travels once, in this
 * response, to the staff member who asked; core keeps only its hash.
 */
export async function issueCheckInCodeAction(
  _: CheckInCodeState,
  data: FormData,
): Promise<CheckInCodeState> {
  const issued: { code?: calendar.IssuedCheckInCode; timeZone?: string } = {};
  const state = await runAction('event.check_in_code', async (ctx) => {
    const eventId = eventIdFrom(data);
    issued.code = await calendar.generateCheckInCode(ctx, { eventId });
    issued.timeZone = await viewerTimeZone(ctx);
    refresh(eventId);
    return 'CHECK-IN CODE ISSUED — shown once. Any earlier code no longer works.';
  });
  if (state.status !== 'success' || !issued.code) return state;
  const timeZone = issued.timeZone ?? 'UTC';
  return {
    ...state,
    code: issued.code.code,
    opensAt: formatTimestamp(issued.code.window.opensAt, timeZone),
    closesAt: formatTimestamp(issued.code.window.closesAt, timeZone),
  };
}
