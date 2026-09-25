import type { ComponentHandler, HandlerContext, ModalHandler } from '../../interactions/types';
import {
  CARD_FLAG,
  EVENT_ACTION,
  EVENTS_NS,
  PICK_PURPOSE,
  RSVP_CHOICES,
  type RsvpChoice,
} from './constants';
import { FIELD } from './modal-forms';
import { openCheckIn, respondRsvp, showEventCard, submitCheckIn } from './member-flows';
import {
  completeEvent,
  drawTeams,
  generateBracket,
  goLive,
  issueCheckInCode,
  openCancelEvent,
  openReport,
  parseCapacity,
  parseKind,
  parseTeamSize,
  showBracket,
  showTeams,
  submitCancelEvent,
  submitCreateEvent,
  submitReport,
} from './staff-flows';
import { requireId, respondExpired } from './support';

function rsvpChoice(value: string | undefined): RsvpChoice | null {
  return RSVP_CHOICES.find((choice) => choice === value) ?? null;
}

/** Custom-id arguments are untrusted: anything but an id is an expired control. */
function idArg(value: string | undefined): string | null {
  try {
    return requireId(value);
  } catch {
    return null;
  }
}

async function handleComponent(
  h: HandlerContext,
  action: string,
  args: readonly string[],
): Promise<void> {
  const selected = h.interaction.values[0];
  if (action === EVENT_ACTION.pick) {
    const eventId = idArg(selected);
    if (!eventId) return respondExpired(h);
    if (args[0] === PICK_PURPOSE.view) return showEventCard(h, eventId, { update: true });
    if (args[0] === PICK_PURPOSE.checkIn) return openCheckIn(h, eventId);
    return respondExpired(h);
  }
  const eventId = idArg(args[0]);
  if (!eventId) return respondExpired(h);
  switch (action) {
    case EVENT_ACTION.rsvp: {
      const choice = rsvpChoice(args[1]);
      if (!choice) return respondExpired(h);
      return respondRsvp(h, eventId, choice, args[2] === CARD_FLAG);
    }
    case EVENT_ACTION.view:
      return showEventCard(h, eventId);
    case EVENT_ACTION.checkIn:
      return openCheckIn(h, eventId);
    case EVENT_ACTION.live:
      return goLive(h, eventId, true);
    case EVENT_ACTION.complete:
      return completeEvent(h, eventId, true);
    case EVENT_ACTION.cancel:
      return openCancelEvent(h, eventId);
    case EVENT_ACTION.code:
      return issueCheckInCode(h, eventId);
    case EVENT_ACTION.teams:
      return showTeams(h, eventId);
    case EVENT_ACTION.draw:
      return drawTeams(h, eventId, parseTeamSize(selected), true);
    case EVENT_ACTION.bracket:
      return showBracket(h, eventId);
    case EVENT_ACTION.generate:
      return generateBracket(h, eventId, args[1]);
    case EVENT_ACTION.reportPick: {
      const matchId = idArg(selected);
      if (!matchId) return respondExpired(h);
      return openReport(h, eventId, matchId);
    }
    default:
      return respondExpired(h);
  }
}

async function handleModal(
  h: HandlerContext,
  action: string,
  args: readonly string[],
): Promise<void> {
  if (action === EVENT_ACTION.create) {
    return submitCreateEvent(h, parseKind(args[0]), parseCapacity(args[1]));
  }
  const id = idArg(args[0]);
  if (!id) return respondExpired(h);
  switch (action) {
    case EVENT_ACTION.checkIn:
      return submitCheckIn(h, id, h.interaction.modal.text(FIELD.code));
    case EVENT_ACTION.cancel:
      return submitCancelEvent(h, id);
    case EVENT_ACTION.report:
      return submitReport(h, id);
    default:
      return respondExpired(h);
  }
}

/** Every events button and select. Custom ids route; core re-authorizes the clicking user. */
export const eventComponents: ComponentHandler = { namespace: EVENTS_NS, handle: handleComponent };

/** Every events modal submission. */
export const eventModals: ModalHandler = { namespace: EVENTS_NS, handle: handleModal };
