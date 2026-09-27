import 'server-only';
import { calendar } from '@jave/core';
import type { EventFormLimits } from '@/components/events/event-form';

/** Core's input limits for the event form (the client bundle never imports core). */
export const EVENT_FORM_LIMITS: EventFormLimits = {
  titleMin: calendar.EVENT_TITLE_MIN,
  titleMax: calendar.EVENT_TITLE_MAX,
  descriptionMax: calendar.EVENT_DESCRIPTION_MAX,
  locationMax: calendar.EVENT_LOCATION_MAX,
  capacityMax: calendar.MAX_EVENT_CAPACITY,
};
