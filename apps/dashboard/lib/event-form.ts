import type { calendar } from '@jave/core';
import { EVENT_KINDS } from './event-labels';
import { formEnum, formOptional, formString } from './form-data';
import { fromDatetimeLocal, toDatetimeLocal } from './datetime-local';

/** Field names of the event form (also the paths core reports validation issues on). */
export const EVENT_FORM_FIELDS = [
  'title',
  'kind',
  'description',
  'startsAt',
  'endsAt',
  'location',
  'capacity',
  'rsvpClosesAt',
] as const;
export type EventFormField = (typeof EVENT_FORM_FIELDS)[number];

/** The form's time fields. In edit mode each has a hidden twin holding its pre-filled value. */
export const EVENT_TIME_FIELDS = ['startsAt', 'endsAt', 'rsvpClosesAt'] as const;
export type EventTimeField = (typeof EVENT_TIME_FIELDS)[number];

/** Name of the hidden field that carries the value `field` was pre-filled with. */
export function initialFieldName(field: EventTimeField): `${EventTimeField}Initial` {
  return `${field}Initial`;
}

const WHOLE_NUMBER = /^\d{1,9}$/;

/** A form value core would refuse, reported on its field before any service call. */
export class EventFormError extends Error {
  constructor(
    readonly field: EventFormField,
    readonly issue: string,
  ) {
    super(`${field}: ${issue}`);
    this.name = 'EventFormError';
  }
}

function instant(data: FormData, field: EventFormField, timeZone: string): Date | undefined {
  const raw = formString(data, field).trim();
  if (raw === '') return undefined;
  const parsed = fromDatetimeLocal(raw, timeZone);
  if (!parsed) throw new EventFormError(field, 'enter a date and time');
  return parsed;
}

function capacity(data: FormData): number | undefined {
  const raw = formString(data, 'capacity').trim();
  if (raw === '') return undefined;
  if (!WHOLE_NUMBER.test(raw)) throw new EventFormError('capacity', 'must be a whole number');
  return Number(raw);
}

function kind(data: FormData): calendar.EventKind {
  const value = formEnum(data, 'kind', EVENT_KINDS);
  if (!value) throw new EventFormError('kind', 'choose a kind');
  return value;
}

/** What the form holds, read in the viewer's time zone. Core validates every rule. */
export interface EventFormValues {
  title: string;
  kind: calendar.EventKind;
  description: string | undefined;
  startsAt: Date;
  endsAt: Date | undefined;
  location: string | undefined;
  capacity: number | undefined;
  rsvpClosesAt: Date | undefined;
}

export function readEventForm(data: FormData, timeZone: string): EventFormValues {
  const startsAt = instant(data, 'startsAt', timeZone);
  if (!startsAt) throw new EventFormError('startsAt', 'enter a date and time');
  return {
    title: formString(data, 'title'),
    kind: kind(data),
    description: formOptional(data, 'description'),
    startsAt,
    endsAt: instant(data, 'endsAt', timeZone),
    location: formOptional(data, 'location'),
    capacity: capacity(data),
    rsvpClosesAt: instant(data, 'rsvpClosesAt', timeZone),
  };
}

/** Input for `calendar.scheduleEvent`: blank optional fields are left to core's defaults. */
export function scheduleInput(values: EventFormValues) {
  return {
    title: values.title,
    kind: values.kind,
    description: values.description,
    startsAt: values.startsAt,
    endsAt: values.endsAt,
    location: values.location,
    capacity: values.capacity,
    rsvpClosesAt: values.rsvpClosesAt,
  };
}

/** What the Edit tab pre-fills: the stored event, times in the viewer's zone (minutes only). */
export function editFormDefaults(
  event: Pick<
    calendar.EventView,
    | 'title'
    | 'kind'
    | 'description'
    | 'startsAt'
    | 'endsAt'
    | 'location'
    | 'capacity'
    | 'rsvpClosesAt'
  >,
  timeZone: string,
): Record<EventFormField, string> {
  return {
    title: event.title,
    kind: event.kind,
    description: event.description ?? '',
    startsAt: toDatetimeLocal(event.startsAt, timeZone),
    endsAt: toDatetimeLocal(event.endsAt, timeZone),
    location: event.location?.value ?? '',
    capacity: event.capacity === null ? '' : String(event.capacity),
    rsvpClosesAt: event.rsvpClosesAt ? toDatetimeLocal(event.rsvpClosesAt, timeZone) : '',
  };
}

/**
 * Time fields the viewer left exactly as the edit form pre-filled them. The
 * inputs show minutes only, so re-sending an untouched value could move a
 * stored instant (its seconds dropped), turn an unchanged end into a new
 * duration, or re-check a past RSVP close. Untouched fields are left out and
 * core keeps what is stored. A field without its hidden twin counts as changed.
 */
export function untouchedTimeFields(data: FormData): ReadonlySet<EventTimeField> {
  const untouched = new Set<EventTimeField>();
  for (const field of EVENT_TIME_FIELDS) {
    const initial = data.get(initialFieldName(field));
    if (typeof initial === 'string' && initial.trim() === formString(data, field).trim()) {
      untouched.add(field);
    }
  }
  return untouched;
}

/**
 * Input for `calendar.updateEvent`: a blank optional field clears it (null).
 * Untouched time fields are omitted; the end also when blank, so the event
 * keeps its duration (from the new start, if the start moved). Core diffs
 * against the stored event, so unchanged fields change nothing.
 */
export function updateInput(
  eventId: string,
  values: EventFormValues,
  untouched: ReadonlySet<EventTimeField> = new Set(),
) {
  const changed = (field: EventTimeField) => !untouched.has(field);
  return {
    eventId,
    title: values.title,
    kind: values.kind,
    description: values.description ?? null,
    startsAt: changed('startsAt') ? values.startsAt : undefined,
    endsAt: changed('endsAt') ? values.endsAt : undefined,
    location: values.location ?? null,
    capacity: values.capacity ?? null,
    rsvpClosesAt: changed('rsvpClosesAt') ? (values.rsvpClosesAt ?? null) : undefined,
  };
}
