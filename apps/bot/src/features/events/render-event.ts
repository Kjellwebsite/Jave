import type { APIEmbedField, APISelectMenuOption } from 'discord.js';
import { calendar, type Page } from '@jave/core';
import type { MessagePayload } from '../../discord/gateway';
import { customId } from '../../interactions/custom-id';
import type { ReplyPayload } from '../../interactions/types';
import { button, field, panel, row, stringSelect } from '../../ui/components';
import { clip, discordTime, userText } from '../../ui/format';
import { COLORS, GLYPH } from '../../ui/theme';
import {
  ANNOUNCEMENT_DESCRIPTION_MAX,
  CANCEL_REASON_DISPLAY_MAX,
  DESCRIPTION_PREVIEW_MAX,
  EVENT_ACTION,
  EVENTS_NS,
  INLINE_TITLE_MAX,
  LIST_RSVP_ROWS,
  LOCATION_TEXT_MAX,
  OPTION_DESCRIPTION_MAX,
  OPTION_LABEL_MAX,
  PICK_PURPOSE,
  type PickPurpose,
  RSVP_ORIGIN,
  type RsvpChoice,
  type RsvpOrigin,
} from './constants';

/** What the public announcement and the personal card have in common. */
export type EventSummary = Pick<
  calendar.EventView,
  | 'title'
  | 'description'
  | 'kind'
  | 'status'
  | 'startsAt'
  | 'endsAt'
  | 'location'
  | 'capacity'
  | 'counts'
  | 'rsvpOpen'
  | 'declineOpen'
  | 'cancelReason'
>;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad2 = (value: number) => String(value).padStart(2, '0');
const SAME_DAY_MS = 24 * 60 * 60 * 1000;

const STATUS_COLOR: Record<calendar.EventStatus, number> = {
  scheduled: COLORS.base,
  live: COLORS.chrome,
  completed: COLORS.steel,
  cancelled: COLORS.danger,
};

const RSVP_LABEL: Record<calendar.RsvpStatus, string> = {
  going: 'GOING',
  maybe: 'MAYBE',
  declined: 'DECLINED',
  waitlist: 'WAITLIST',
};

export function kindLabel(kind: calendar.EventKind): string {
  return kind.toUpperCase();
}

/** Plain one-line text for select labels and descriptions (Discord renders no markdown there). */
export function plainLabel(text: string, max = OPTION_LABEL_MAX): string {
  return clip(text.replace(/\s+/g, ' ').trim(), max);
}

/** "Thu 5 Mar, 18:00 UTC" — for places where Discord timestamps do not render (select menus). */
export function shortUtc(date: Date): string {
  return `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}, ${pad2(
    date.getUTCHours(),
  )}:${pad2(date.getUTCMinutes())} UTC`;
}

export function statusLine(event: EventSummary): string {
  switch (event.status) {
    case 'live':
      return 'LIVE NOW';
    case 'completed':
      return 'COMPLETED';
    case 'cancelled':
      return 'CANCELLED';
    case 'scheduled':
      return event.rsvpOpen ? 'SCHEDULED' : 'SCHEDULED · RSVP CLOSED';
  }
}

export function whenValue(event: Pick<EventSummary, 'startsAt' | 'endsAt'>): string {
  const sameDay = event.endsAt.getTime() - event.startsAt.getTime() < SAME_DAY_MS;
  return `${discordTime(event.startsAt, 'F')} ${GLYPH.dot} ${discordTime(event.startsAt, 'R')}\nEnds ${discordTime(event.endsAt, sameDay ? 't' : 'f')}`;
}

/** A link Discord renders safely: http(s) only, parentheses encoded, the escaped hostname as the label. */
function safeLink(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    const href = url.toString().replace(/\(/g, '%28').replace(/\)/g, '%29');
    return `[${userText(url.hostname, LOCATION_TEXT_MAX)}](${href})`;
  } catch {
    return null;
  }
}

export function whereValue(location: calendar.LocationView | null): string {
  if (!location) return GLYPH.unknown;
  switch (location.kind) {
    case 'channel':
      return `<#${location.value}>`;
    case 'url':
      return safeLink(location.value) ?? GLYPH.unknown;
    case 'text':
      return userText(location.value, LOCATION_TEXT_MAX);
  }
}

export function capacityValue(event: Pick<EventSummary, 'capacity' | 'counts'>): string {
  const { going, waitlist } = event.counts;
  if (event.capacity === null) return `${going} going ${GLYPH.dot} no limit`;
  const left = Math.max(0, event.capacity - going);
  const spots =
    left > 0 ? `${left} ${left === 1 ? 'spot' : 'spots'} left` : `FULL ${GLYPH.dot} waitlist open`;
  const queue = waitlist > 0 ? ` ${GLYPH.dot} ${waitlist} waitlisted` : '';
  return `${going} / ${event.capacity} going ${GLYPH.dot} ${spots}${queue}`;
}

function responsesValue(counts: calendar.RsvpCounts): string {
  const parts = [`${counts.going} going`, `${counts.maybe} maybe`];
  if (counts.waitlist > 0) parts.push(`${counts.waitlist} waitlisted`);
  if (counts.checkedIn > 0) parts.push(`${counts.checkedIn} checked in`);
  return parts.join(` ${GLYPH.dot} `);
}

function summaryFields(event: EventSummary): APIEmbedField[] {
  return [
    field('When', whenValue(event)),
    field('Where', whereValue(event.location), true),
    field('Capacity', capacityValue(event), true),
    field('Status', statusLine(event), true),
  ];
}

function rsvpButtons(
  eventId: string,
  event: Pick<EventSummary, 'rsvpOpen' | 'declineOpen'>,
  options: { origin: RsvpOrigin; current: calendar.RsvpStatus | null; prefix?: string },
) {
  const id = (choice: RsvpChoice) =>
    options.origin === 'announcement'
      ? customId(EVENTS_NS, EVENT_ACTION.rsvp, eventId, choice)
      : customId(EVENTS_NS, EVENT_ACTION.rsvp, eventId, choice, RSVP_ORIGIN[options.origin]);
  const label = (text: string) => (options.prefix ? `${options.prefix} ${text}` : text);
  const current = options.current;
  return [
    button(
      label('Going'),
      id('going'),
      'primary',
      !event.rsvpOpen || current === 'going' || current === 'waitlist',
    ),
    button(label('Maybe'), id('maybe'), 'secondary', !event.rsvpOpen || current === 'maybe'),
    button(
      label('Decline'),
      id('declined'),
      'secondary',
      !event.declineOpen || current === 'declined',
    ),
  ];
}

/** The public announcement with RSVP buttons (posted and kept in sync by the publish job). */
export function announcementMessage(publication: calendar.EventPublication): MessagePayload {
  const description = publication.description
    ? userText(publication.description, ANNOUNCEMENT_DESCRIPTION_MAX)
    : undefined;
  return {
    embeds: [
      panel({
        kicker: `JAVELIN EVENT ${GLYPH.dot} ${kindLabel(publication.kind)}`,
        title: userText(publication.title),
        description,
        color: STATUS_COLOR[publication.status],
        fields: [
          ...summaryFields(publication),
          field('Responses', responsesValue(publication.counts)),
        ],
      }),
    ],
    components: [
      row(
        ...rsvpButtons(publication.eventId, publication, { origin: 'announcement', current: null }),
        button('Details', customId(EVENTS_NS, EVENT_ACTION.view, publication.eventId)),
      ),
    ],
  };
}

/** The announcement after a cancellation: reason, no buttons. */
export function cancelledAnnouncement(publication: calendar.EventPublication): MessagePayload {
  const reason = publication.cancelReason
    ? userText(publication.cancelReason, CANCEL_REASON_DISPLAY_MAX)
    : 'No reason given.';
  return {
    embeds: [
      panel({
        kicker: `JAVELIN EVENT ${GLYPH.dot} ${kindLabel(publication.kind)}`,
        title: `${userText(publication.title)} ${GLYPH.dot} CANCELLED`,
        description: `**CANCELLED** ${GLYPH.dot} ${reason}`,
        color: STATUS_COLOR.cancelled,
        fields: [field('Was scheduled', whenValue(publication))],
      }),
    ],
    components: [],
  };
}

function myRsvpValue(mine: calendar.MyRsvpView | null): string {
  if (!mine) return `${GLYPH.unknown} No response yet`;
  const label =
    mine.status === 'waitlist' && mine.waitlistPosition !== null
      ? `WAITLIST #${mine.waitlistPosition}`
      : RSVP_LABEL[mine.status];
  const checkedIn = mine.checkedInAt
    ? ` ${GLYPH.dot} CHECKED IN ${GLYPH.verified} ${discordTime(mine.checkedInAt, 't')}`
    : '';
  return `**${label}**${checkedIn}`;
}

/** Check-in is accepted now (core decides; this only decides whether to offer the button). */
export function checkInOpen(event: calendar.EventView, now: Date): boolean {
  if (event.status !== 'scheduled' && event.status !== 'live') return false;
  const window = calendar.checkInWindow(event);
  return now >= window.opensAt && now <= window.closesAt;
}

function staffRow(event: calendar.EventView, now: Date) {
  const open = event.status === 'scheduled' || event.status === 'live';
  if (!open) return null;
  const started = now >= event.startsAt;
  const canGoLive =
    event.status === 'scheduled' &&
    now.getTime() >= event.startsAt.getTime() - calendar.GO_LIVE_EARLIEST_BEFORE_MS &&
    now <= event.endsAt;
  const buttons = [];
  if (canGoLive) buttons.push(button('Go live', customId(EVENTS_NS, EVENT_ACTION.live, event.id)));
  if (event.status === 'live' || started) {
    buttons.push(button('Complete', customId(EVENTS_NS, EVENT_ACTION.complete, event.id)));
  }
  if (now <= event.endsAt) {
    buttons.push(
      button(
        event.checkInCodeIssued ? 'New check-in code' : 'Check-in code',
        customId(EVENTS_NS, EVENT_ACTION.code, event.id),
      ),
    );
  }
  buttons.push(
    button('Cancel event', customId(EVENTS_NS, EVENT_ACTION.cancel, event.id), 'danger'),
  );
  return row(...buttons);
}

/** The personal event card: details, your RSVP, and the controls you may use. */
export function eventCard(
  event: calendar.EventView,
  options: { staff: boolean; now: Date; notice?: string },
): ReplyPayload {
  const fields = [...summaryFields(event), field('Responses', responsesValue(event.counts))];
  fields.push(field('Your RSVP', myRsvpValue(event.myRsvp)));
  if (options.staff && (event.status === 'scheduled' || event.status === 'live')) {
    const window = calendar.checkInWindow(event);
    fields.push(
      field(
        'Check-in',
        `${event.checkInCodeIssued ? 'Code issued' : 'No code issued'} ${GLYPH.dot} window ${discordTime(window.opensAt, 't')} ${GLYPH.arrow} ${discordTime(window.closesAt, 't')}`,
      ),
    );
  }
  if (event.status === 'cancelled' && event.cancelReason) {
    fields.push(field('Cancelled', userText(event.cancelReason, CANCEL_REASON_DISPLAY_MAX)));
  }
  const description = [
    options.notice,
    event.description ? userText(event.description, DESCRIPTION_PREVIEW_MAX) : null,
  ]
    .filter(Boolean)
    .join('\n\n');

  const memberButtons = rsvpButtons(event.id, event, {
    origin: 'card',
    current: event.myRsvp?.status ?? null,
  });
  if (checkInOpen(event, options.now) && event.checkInCodeIssued && !event.myRsvp?.checkedInAt) {
    memberButtons.push(
      button('Check in', customId(EVENTS_NS, EVENT_ACTION.checkIn, event.id), 'success'),
    );
  }
  const components = [row(...memberButtons)];
  if (options.staff) {
    const controls = staffRow(event, options.now);
    if (controls) components.push(controls);
  }
  const extra = [];
  if (options.staff) extra.push(button('Teams', customId(EVENTS_NS, EVENT_ACTION.teams, event.id)));
  if (event.kind === 'tournament') {
    extra.push(button('Bracket', customId(EVENTS_NS, EVENT_ACTION.bracket, event.id)));
  }
  if (extra.length > 0) components.push(row(...extra));

  return {
    embeds: [
      panel({
        kicker: `JAVELIN EVENT ${GLYPH.dot} ${kindLabel(event.kind)}`,
        title: userText(event.title),
        description: description || undefined,
        color: STATUS_COLOR[event.status],
        fields,
      }),
    ],
    components,
    ephemeral: true,
  };
}

export function eventOption(event: calendar.EventView): APISelectMenuOption {
  return {
    label: plainLabel(event.title),
    value: event.id,
    description: plainLabel(
      `${kindLabel(event.kind)} ${GLYPH.dot} ${shortUtc(event.startsAt)}${event.status === 'live' ? ' · LIVE' : ''}`,
      OPTION_DESCRIPTION_MAX,
    ),
  };
}

/** A select menu that opens one of `events` for `purpose`. */
export function eventPicker(
  events: readonly calendar.EventView[],
  purpose: PickPurpose,
  placeholder: string,
) {
  return row(
    stringSelect(
      customId(EVENTS_NS, EVENT_ACTION.pick, purpose),
      placeholder,
      events.map(eventOption),
    ),
  );
}

/** "01", "02", … — list numbers that match the RSVP button labels. */
const listNumber = (index: number) => String(index + 1).padStart(2, '0');

function listLine(event: calendar.EventView, index: number): string {
  const going =
    event.capacity === null
      ? `${event.counts.going} going`
      : `${event.counts.going}/${event.capacity} going`;
  const live = event.status === 'live' ? ` ${GLYPH.dot} **LIVE**` : '';
  const mine = event.myRsvp ? ` ${GLYPH.dot} YOU: ${RSVP_LABEL[event.myRsvp.status]}` : '';
  return `\`${listNumber(index)}\` **${userText(event.title, INLINE_TITLE_MAX)}**${live}\n${kindLabel(event.kind)} ${GLYPH.dot} ${discordTime(event.startsAt, 'f')} ${GLYPH.dot} ${going}${mine}`;
}

/**
 * /events list: upcoming events, one row of RSVP buttons for each of the
 * first few (numbered to match the list), and a picker to open any of them.
 */
export function eventListMessage(page: Page<calendar.EventView>, notice?: string): ReplyPayload {
  if (page.items.length === 0) {
    return {
      embeds: [
        panel({
          kicker: 'JAVELIN EVENTS',
          title: 'No upcoming events',
          description:
            'Nothing is scheduled right now. New events are announced here when staff publish them.',
        }),
      ],
      components: [],
      ephemeral: true,
    };
  }
  const more = page.total > page.items.length ? page.total - page.items.length : 0;
  const lines = page.items.map(listLine).join('\n\n');
  const rsvpRows = page.items.slice(0, LIST_RSVP_ROWS).map((event, index) =>
    row(
      ...rsvpButtons(event.id, event, {
        origin: 'list',
        current: event.myRsvp?.status ?? null,
        prefix: listNumber(index),
      }),
    ),
  );
  return {
    embeds: [
      panel({
        kicker: 'JAVELIN EVENTS',
        title: 'Upcoming',
        description: notice ? `${notice}\n\n${lines}` : lines,
        footer: more > 0 ? `${more} more on the dashboard.` : undefined,
      }),
    ],
    components: [...rsvpRows, eventPicker(page.items, PICK_PURPOSE.view, 'Open an event')],
    ephemeral: true,
  };
}

/** Plain confirmation for an RSVP made from the public announcement. */
export function rsvpConfirmation(result: calendar.RsvpResult, title: string): ReplyPayload {
  const label =
    result.status === 'waitlist' && result.waitlistPosition !== null
      ? `WAITLIST #${result.waitlistPosition}`
      : RSVP_LABEL[result.status];
  const detail =
    result.status === 'waitlist'
      ? 'The event is full. You move up automatically when a spot opens.'
      : result.changed
        ? 'Recorded.'
        : 'Unchanged — that was already your response.';
  return {
    embeds: [
      panel({
        title: `RSVP ${GLYPH.dot} ${label}`,
        description: `${userText(title)}\n${detail}`,
        color: result.status === 'going' ? COLORS.success : COLORS.base,
      }),
    ],
    ephemeral: true,
  };
}
