import type { calendar } from '@jave/core';

/** Human labels and badge tones for event enums (lists, detail pages, forms). */
export const EVENT_KIND_LABELS: Record<calendar.EventKind, string> = {
  meetup: 'Meetup',
  workshop: 'Workshop',
  talk: 'Talk',
  tournament: 'Tournament',
  session: 'Session',
  social: 'Social',
  other: 'Other',
};

export const EVENT_KINDS = Object.keys(EVENT_KIND_LABELS) as calendar.EventKind[];

export const EVENT_STATUS_LABELS: Record<calendar.EventStatus, string> = {
  scheduled: 'Scheduled',
  live: 'Live',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const EVENT_STATUS_TONE = {
  scheduled: 'neutral',
  live: 'success',
  completed: 'neutral',
  cancelled: 'danger',
} as const satisfies Record<calendar.EventStatus, string>;

export const RSVP_LABELS: Record<calendar.RsvpStatus, string> = {
  going: 'Going',
  maybe: 'Maybe',
  declined: 'Declined',
  waitlist: 'Waitlist',
};

export const RSVP_TONE = {
  going: 'success',
  maybe: 'info',
  declined: 'neutral',
  waitlist: 'warning',
} as const satisfies Record<calendar.RsvpStatus, string>;

/** The responses a member can give; the waitlist is where a full event puts "going". */
export const RSVP_CHOICES = ['going', 'maybe', 'declined'] as const;
export type RsvpChoice = (typeof RSVP_CHOICES)[number];

/** "12 / 40 going · 28 left", "40 / 40 going · full", "12 going · no limit". */
export function capacityLabel(event: Pick<calendar.EventView, 'capacity' | 'counts'>): string {
  const { going } = event.counts;
  if (event.capacity === null) return `${going} going · no limit`;
  const left = Math.max(0, event.capacity - going);
  return `${going} / ${event.capacity} going · ${left === 0 ? 'full' : `${left} left`}`;
}

/** A location as display text plus, for web links, a safe http(s) href. */
export function locationDisplay(location: calendar.LocationView | null): {
  text: string;
  href: string | null;
  channel: boolean;
} {
  if (!location) return { text: '—', href: null, channel: false };
  if (location.kind === 'channel') {
    return { text: `Discord channel ${location.value}`, href: null, channel: true };
  }
  if (location.kind === 'url') {
    try {
      const url = new URL(location.value);
      if (url.protocol === 'https:' || url.protocol === 'http:') {
        return { text: url.host, href: url.toString(), channel: false };
      }
    } catch {
      // Not a parseable URL after all: show it as text.
    }
  }
  return { text: location.value, href: null, channel: false };
}
