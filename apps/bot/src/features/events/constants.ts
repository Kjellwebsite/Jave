import { eventKind } from '@jave/database';

/** Custom-id namespace for every events button, select and modal. */
export const EVENTS_NS = 'events';

/** Custom-id actions (`events:<action>:…`). They route; core authorizes every one. */
export const EVENT_ACTION = {
  rsvp: 'rsvp',
  view: 'view',
  pick: 'pick',
  checkIn: 'checkin',
  create: 'create',
  live: 'live',
  complete: 'complete',
  cancel: 'cancel',
  code: 'code',
  teams: 'teams',
  draw: 'draw',
  bracket: 'bracket',
  generate: 'generate',
  reportPick: 'report-pick',
  report: 'report',
} as const;

/** What an event picker (select menu) opens. */
export const PICK_PURPOSE = { view: 'view', checkIn: 'checkin' } as const;
export type PickPurpose = (typeof PICK_PURPOSE)[keyof typeof PICK_PURPOSE];

/**
 * Where an RSVP button sits, as the last custom-id argument. The public
 * announcement has none (the answer is a private confirmation); a personal
 * card or the /events list is private and is updated in place.
 */
export const RSVP_ORIGIN = { card: 'card', list: 'list' } as const;
export type RsvpOrigin = 'announcement' | (typeof RSVP_ORIGIN)[keyof typeof RSVP_ORIGIN];

export const RSVP_CHOICES = ['going', 'maybe', 'declined'] as const;
export type RsvpChoice = (typeof RSVP_CHOICES)[number];

export const EVENT_KINDS = eventKind.enumValues;
export type EventKindChoice = (typeof EVENT_KINDS)[number];
export const DEFAULT_EVENT_KIND: EventKindChoice = 'meetup';

/** Durations offered in the create modal (minutes). */
export const DURATION_OPTIONS = [
  { minutes: 60, label: '1 hour' },
  { minutes: 90, label: '1.5 hours' },
  { minutes: 120, label: '2 hours' },
  { minutes: 180, label: '3 hours' },
  { minutes: 240, label: '4 hours' },
  { minutes: 360, label: '6 hours' },
  { minutes: 480, label: '8 hours' },
  { minutes: 720, label: '12 hours' },
  { minutes: 1440, label: '24 hours' },
] as const;
export const DEFAULT_DURATION_MINUTES = 120;

/** Discord-facing limits of our own views. */
export const LIST_LIMIT = 10;
/** Events in /events list that get their own row of RSVP buttons (row five is the picker). */
export const LIST_RSVP_ROWS = 4;
/** Event titles quoted inline (a notice, a list line) are clipped to this length. */
export const INLINE_TITLE_MAX = 80;
/** Team and member names inside panels are clipped to this length. */
export const NAME_DISPLAY_MAX = 64;
/** A cancellation reason shown on a panel is clipped to this length. */
export const CANCEL_REASON_DISPLAY_MAX = 500;
/** Discord's limit for select option labels and label descriptions in modals. */
export const COMPONENT_TEXT_MAX = 100;
export const PICKER_LIMIT = 25;
/** Recent past events stay pickable (a bracket can finish after its evening ends). */
export const PAST_PICKER_LIMIT = 10;
export const HISTORY_LIMIT = 10;
export const DESCRIPTION_PREVIEW_MAX = 1500;
export const ANNOUNCEMENT_DESCRIPTION_MAX = 1800;
export const LOCATION_TEXT_MAX = 100;
export const OPTION_LABEL_MAX = COMPONENT_TEXT_MAX;
export const OPTION_DESCRIPTION_MAX = COMPONENT_TEXT_MAX;
export const MODAL_LABEL_MAX = 45;
export const TEAM_FIELD_LIMIT = 24;
export const MAX_DRAW_TEAM_SIZE = 12;
/** A score typed into the report modal: digits only, bounded by core's own maximum. */
export const SCORE_INPUT_MAX_LENGTH = 7;

/** Staff capability for managing events (checked by core; used here to show controls). */
export const MANAGE_EVENTS = 'canManageEvents' as const;
