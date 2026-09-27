import type { calendar } from '@jave/core';
import { EVENT_KINDS } from './event-labels';
import { formEnum, formOptional, formString } from './form-data';
import { fromDatetimeLocal } from './datetime-local';

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

/**
 * Input for `calendar.updateEvent`: a blank optional field clears it (null),
 * except the end, which keeps the event's duration when left blank. Core
 * diffs against the stored event, so unchanged fields change nothing.
 */
export function updateInput(eventId: string, values: EventFormValues) {
  return {
    eventId,
    title: values.title,
    kind: values.kind,
    description: values.description ?? null,
    startsAt: values.startsAt,
    endsAt: values.endsAt,
    location: values.location ?? null,
    capacity: values.capacity ?? null,
    rsvpClosesAt: values.rsvpClosesAt ?? null,
  };
}
