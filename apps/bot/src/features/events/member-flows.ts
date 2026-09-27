import { calendar, findMemberByDiscordId, NotFoundError, requireMember } from '@jave/core';
import type { HandlerContext, InteractionUser } from '../../interactions/types';
import { panel, success } from '../../ui/components';
import { discordTime, userText } from '../../ui/format';
import { GLYPH } from '../../ui/theme';
import {
  HISTORY_LIMIT,
  INLINE_TITLE_MAX,
  LIST_LIMIT,
  PICK_PURPOSE,
  PICKER_LIMIT,
  type RsvpChoice,
  type RsvpOrigin,
} from './constants';
import { checkInModal } from './modal-forms';
import {
  checkInOpen,
  eventCard,
  eventListMessage,
  eventPicker,
  rsvpConfirmation,
} from './render-event';
import { historyPanel } from './render-tournament';
import { isEventStaff } from './support';

const RSVP_NOTICE: Record<calendar.RsvpStatus, string> = {
  going: 'RSVP RECORDED — GOING.',
  maybe: 'RSVP RECORDED — MAYBE.',
  declined: 'RSVP RECORDED — DECLINED. Your spot is released.',
  waitlist: 'THE EVENT IS FULL — you are on the waitlist and move up automatically.',
};

/** "RSVP RECORDED — GOING — Build Night." — the line above the list after an RSVP from it. */
function listNotice(result: calendar.RsvpResult, title: string): string {
  const name = userText(title, INLINE_TITLE_MAX);
  if (result.status === 'waitlist') {
    const position = result.waitlistPosition === null ? '' : ` #${result.waitlistPosition}`;
    return `WAITLIST${position} — ${name}. You move up automatically when a spot opens.`;
  }
  return `RSVP RECORDED — ${result.status.toUpperCase()} — ${name}.`;
}

export async function showEventList(
  h: HandlerContext,
  options: { update?: boolean; notice?: string } = {},
): Promise<void> {
  const page = await calendar.listEvents(h.ctx, { scope: 'upcoming', limit: LIST_LIMIT });
  const payload = eventListMessage(page, options.notice);
  if (options.update) await h.interaction.update(payload);
  else await h.respond(payload);
}

/** The personal event card. `update` replaces the message the clicked control sits on. */
export async function showEventCard(
  h: HandlerContext,
  eventId: string,
  options: { update?: boolean; notice?: string } = {},
): Promise<void> {
  const view = await calendar.getEvent(h.ctx, { eventId });
  const payload = eventCard(view, {
    staff: isEventStaff(h.ctx),
    now: h.ctx.clock.now(),
    notice: options.notice,
  });
  if (options.update) await h.interaction.update(payload);
  else await h.respond(payload);
}

/**
 * RSVP as the clicking member. From the public announcement the answer is a
 * private confirmation (the announcement itself refreshes via its job); from
 * a personal card or the /events list, that private message is updated in place.
 */
export async function respondRsvp(
  h: HandlerContext,
  eventId: string,
  choice: RsvpChoice,
  origin: RsvpOrigin,
): Promise<void> {
  const result = await calendar.rsvp(h.ctx, { eventId, status: choice });
  const notice =
    result.status === 'waitlist' && result.waitlistPosition !== null
      ? `${RSVP_NOTICE.waitlist} Position #${result.waitlistPosition}.`
      : RSVP_NOTICE[result.status];
  if (origin === 'card') return showEventCard(h, eventId, { update: true, notice });
  const view = await calendar.getEvent(h.ctx, { eventId });
  if (origin === 'list')
    return showEventList(h, { update: true, notice: listNotice(result, view.title) });
  await h.respond(rsvpConfirmation(result, view.title));
}

export async function openCheckIn(h: HandlerContext, eventId: string): Promise<void> {
  const view = await calendar.getEvent(h.ctx, { eventId });
  await h.interaction.showModal(checkInModal(view.id, view.title));
}

/** /events checkin without an event: the events whose check-in window is open now. */
export async function pickCheckInEvent(h: HandlerContext): Promise<void> {
  const page = await calendar.listEvents(h.ctx, { scope: 'upcoming', limit: PICKER_LIMIT });
  const now = h.ctx.clock.now();
  const open = page.items.filter((event) => checkInOpen(event, now) && event.checkInCodeIssued);
  if (open.length === 0) {
    await h.respond({
      embeds: [
        panel({
          title: 'No check-in open',
          description:
            'Check-in opens 30 minutes before an event starts, once the host has issued a code.',
        }),
      ],
      ephemeral: true,
    });
    return;
  }
  await h.respond({
    embeds: [panel({ title: 'Check in', description: 'Choose the event you are attending.' })],
    components: [eventPicker(open, PICK_PURPOSE.checkIn, 'Choose an event')],
    ephemeral: true,
  });
}

export async function submitCheckIn(h: HandlerContext, eventId: string, code: string) {
  const result = await calendar.checkIn(h.ctx, { eventId, code });
  const view = await calendar.getEvent(h.ctx, { eventId });
  await h.respond({
    embeds: [
      success(
        result.alreadyCheckedIn ? 'Already checked in' : 'Checked in',
        `${userText(view.title)} ${GLYPH.dot} ${discordTime(result.checkedInAt, 't')}\nAttendance is recorded on your event history.`,
      ),
    ],
    ephemeral: true,
  });
}

/** Event history for yourself, or for any member when you run events (core decides). */
export async function showHistory(h: HandlerContext, target: InteractionUser): Promise<void> {
  const self = target.id === h.interaction.user.id;
  const memberId = self
    ? requireMember(h.ctx).memberId
    : (await findMemberByDiscordId(h.ctx, target.id))?.id;
  if (!memberId) throw new NotFoundError('JVLN profile');
  const page = await calendar.listMemberEventHistory(h.ctx, { memberId, limit: HISTORY_LIMIT });
  await h.respond(historyPanel(target.globalName ?? target.username, page));
}
