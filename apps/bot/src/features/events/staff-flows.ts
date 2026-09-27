import { calendar, getMyPreferences, MINUTE, NotFoundError, ValidationError } from '@jave/core';
import type { HandlerContext } from '../../interactions/types';
import { panel } from '../../ui/components';
import { discordTime, userText } from '../../ui/format';
import { GLYPH } from '../../ui/theme';
import {
  DEFAULT_EVENT_KIND,
  DURATION_OPTIONS,
  EVENT_KINDS,
  type EventKindChoice,
  MAX_DRAW_TEAM_SIZE,
  NAME_DISPLAY_MAX,
} from './constants';
import { showEventCard } from './member-flows';
import {
  cancelEventModal,
  createEventModal,
  FIELD,
  isWinnerChoice,
  reportMatchModal,
  WINNER_BY_SCORE,
} from './modal-forms';
import {
  bracketPanel,
  checkInCodePanel,
  readyMatchOptions,
  reportPicker,
  teamsPanel,
} from './render-tournament';
import { dashboardEventUrl, isEventStaff, requireId, respondStaffOnly } from './support';
import { parseStartInput } from './time-input';

const SCORE_PATTERN = /^\d+$/;

export function parseKind(value: string | null | undefined): EventKindChoice {
  if (!value) return DEFAULT_EVENT_KIND;
  const kind = EVENT_KINDS.find((candidate) => candidate === value);
  if (!kind) throw new ValidationError('Choose an event kind from the list.');
  return kind;
}

/** Capacity from a slash option or a custom id ('0' = no limit). Core validates the range. */
export function parseCapacity(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '' || value === 0 || value === '0') {
    return null;
  }
  const capacity = Number(value);
  if (!Number.isInteger(capacity)) throw new ValidationError('Capacity must be a whole number.');
  return capacity;
}

export async function openCreateEvent(
  h: HandlerContext,
  kind: EventKindChoice,
  capacity: number | null,
): Promise<void> {
  if (!isEventStaff(h.ctx)) return respondStaffOnly(h);
  const { timezone } = await getMyPreferences(h.ctx);
  await h.interaction.showModal(createEventModal(kind, capacity, timezone));
}

function durationMinutes(value: string | undefined): number {
  const option = DURATION_OPTIONS.find((candidate) => String(candidate.minutes) === value);
  if (!option) throw new ValidationError('Choose a duration from the list.');
  return option.minutes;
}

export async function submitCreateEvent(
  h: HandlerContext,
  kind: EventKindChoice,
  capacity: number | null,
): Promise<void> {
  const { modal } = h.interaction;
  const { timezone } = await getMyPreferences(h.ctx);
  const startsAt = parseStartInput(modal.text(FIELD.start), timezone);
  if (!startsAt) {
    throw new ValidationError(
      `Start: use YYYY-MM-DD HH:mm (${timezone}), ISO 8601 with an offset, or a Discord timestamp.`,
      [{ path: 'startsAt', message: 'unrecognized time' }],
    );
  }
  const minutes = durationMinutes(modal.select(FIELD.duration)[0]);
  const description = modal.text(FIELD.description).trim();
  const location = modal.text(FIELD.location).trim();
  const event = await calendar.scheduleEvent(h.ctx, {
    title: modal.text(FIELD.title),
    description: description || undefined,
    kind,
    startsAt,
    endsAt: new Date(startsAt.getTime() + minutes * MINUTE),
    location: location || undefined,
    capacity: capacity ?? undefined,
  });
  await showEventCard(h, event.id, {
    notice: `EVENT SCHEDULED — ${discordTime(event.startsAt, 'F')}. The announcement and the Discord event follow automatically when an events channel is configured.`,
  });
}

export async function openCancelEvent(h: HandlerContext, eventId: string): Promise<void> {
  if (!isEventStaff(h.ctx)) return respondStaffOnly(h);
  const view = await calendar.getEvent(h.ctx, { eventId });
  await h.interaction.showModal(cancelEventModal(view.id, view.title));
}

export async function submitCancelEvent(h: HandlerContext, eventId: string): Promise<void> {
  const view = await calendar.cancelEvent(h.ctx, {
    eventId,
    reason: h.interaction.modal.text(FIELD.reason),
  });
  await showEventCard(h, view.id, {
    notice: 'EVENT CANCELLED — everyone who responded is notified; the announcement is updated.',
  });
}

export async function goLive(h: HandlerContext, eventId: string, update: boolean) {
  await calendar.markEventLive(h.ctx, { eventId });
  await showEventCard(h, eventId, {
    update,
    notice: 'EVENT LIVE — check-in and the Discord event are open.',
  });
}

export async function completeEvent(h: HandlerContext, eventId: string, update: boolean) {
  const view = await calendar.completeEvent(h.ctx, { eventId });
  await showEventCard(h, eventId, {
    update,
    notice: `EVENT COMPLETED — ${view.counts.checkedIn} checked in of ${view.counts.going} going.`,
  });
}

/** Issue (or rotate) the check-in code. Always a fresh private message: the code is shown once. */
export async function issueCheckInCode(h: HandlerContext, eventId: string): Promise<void> {
  const issued = await calendar.generateCheckInCode(h.ctx, { eventId });
  const view = await calendar.getEvent(h.ctx, { eventId });
  await h.respond(checkInCodePanel(issued, view.title));
}

async function teamsState(h: HandlerContext, eventId: string) {
  const [view, teams, bracket] = await Promise.all([
    calendar.getEvent(h.ctx, { eventId }),
    calendar.listTeams(h.ctx, { eventId }),
    calendar.getBracket(h.ctx, { eventId }),
  ]);
  const open = view.status === 'scheduled' || view.status === 'live';
  return { view, teams, editable: open && bracket.state === 'none' };
}

export async function showTeams(
  h: HandlerContext,
  eventId: string,
  options: { update?: boolean; notice?: string } = {},
): Promise<void> {
  const { view, teams, editable } = await teamsState(h, eventId);
  const payload = teamsPanel(view.id, teams, {
    eventTitle: view.title,
    staff: isEventStaff(h.ctx),
    editable,
    notice: options.notice,
  });
  if (options.update) await h.interaction.update(payload);
  else await h.respond(payload);
}

export function parseTeamSize(value: string | number | null | undefined): number {
  const size = Number(value);
  if (!Number.isInteger(size) || size < 1 || size > MAX_DRAW_TEAM_SIZE) {
    throw new ValidationError(`Team size must be between 1 and ${MAX_DRAW_TEAM_SIZE}.`);
  }
  return size;
}

export async function drawTeams(
  h: HandlerContext,
  eventId: string,
  teamSize: number,
  update: boolean,
): Promise<void> {
  const created = await calendar.createRandomTeams(h.ctx, { eventId, teamSize });
  const members = created.reduce((total, team) => total + team.members.length, 0);
  await showTeams(h, eventId, {
    update,
    notice: `TEAMS DRAWN — ${created.length} ${created.length === 1 ? 'team' : 'teams'}, ${members} members.`,
  });
}

export async function showBracket(
  h: HandlerContext,
  eventId: string,
  options: { update?: boolean; notice?: string } = {},
): Promise<void> {
  const [view, bracket] = await Promise.all([
    calendar.getEvent(h.ctx, { eventId }),
    calendar.getBracket(h.ctx, { eventId }),
  ]);
  const payload = bracketPanel(view.id, bracket, {
    eventTitle: view.title,
    staff: isEventStaff(h.ctx),
    canGenerate:
      view.kind === 'tournament' && (view.status === 'scheduled' || view.status === 'live'),
    dashboardUrl: dashboardEventUrl(h.ctx, view.id, 'bracket'),
    notice: options.notice,
  });
  if (options.update) await h.interaction.update(payload);
  else await h.respond(payload);
}

export async function generateBracket(
  h: HandlerContext,
  eventId: string,
  seeding: string | undefined,
): Promise<void> {
  if (seeding !== 'seeded' && seeding !== 'random') {
    throw new ValidationError('Choose seeded or random.');
  }
  const bracket = await calendar.generateBracket(h.ctx, { eventId, seeding });
  const matches = bracket.rounds.reduce((total, round) => total + round.matches.length, 0);
  await showBracket(h, eventId, {
    update: true,
    notice: `BRACKET GENERATED — ${bracket.rounds.length} rounds, ${matches} matches. Teams are now locked.`,
  });
}

/** /events report: the ready matches to choose from. */
export async function pickMatch(h: HandlerContext, eventId: string): Promise<void> {
  if (!isEventStaff(h.ctx)) return respondStaffOnly(h);
  const [view, bracket] = await Promise.all([
    calendar.getEvent(h.ctx, { eventId }),
    calendar.getBracket(h.ctx, { eventId }),
  ]);
  const picker = reportPicker(view.id, bracket);
  if (!picker) {
    await showBracket(h, eventId, { notice: 'No match is waiting for a result.' });
    return;
  }
  await h.respond({
    embeds: [
      panel({
        kicker: 'BRACKET',
        title: 'Report a result',
        description: `${userText(view.title)} ${GLYPH.dot} ${readyMatchOptions(bracket).length} ready`,
      }),
    ],
    components: [picker],
    ephemeral: true,
  });
}

export async function openReport(h: HandlerContext, eventId: string, matchId: string) {
  if (!isEventStaff(h.ctx)) return respondStaffOnly(h);
  const bracket = await calendar.getBracket(h.ctx, { eventId });
  const match = bracket.rounds.flatMap((round) => round.matches).find((m) => m.id === matchId);
  if (!match || !match.teamA || !match.teamB) throw new NotFoundError('Match');
  await h.interaction.showModal(reportMatchModal(match.id, match.teamA.name, match.teamB.name));
}

function parseScore(text: string, team: 'A' | 'B'): number | undefined {
  const value = text.trim();
  if (value === '') return undefined;
  if (!SCORE_PATTERN.test(value)) {
    throw new ValidationError(`Score for team ${team} must be a whole number.`);
  }
  return Number(value);
}

export async function submitReport(h: HandlerContext, matchId: string): Promise<void> {
  const { modal } = h.interaction;
  const winnerChoice = modal.select(FIELD.winner)[0];
  if (!isWinnerChoice(winnerChoice)) throw new ValidationError('Choose how the winner is decided.');
  const bracket = await calendar.reportMatch(h.ctx, {
    matchId: requireId(matchId, 'a match'),
    scoreA: parseScore(modal.text(FIELD.scoreA), 'A'),
    scoreB: parseScore(modal.text(FIELD.scoreB), 'B'),
    winner: winnerChoice === WINNER_BY_SCORE ? undefined : winnerChoice,
  });
  const match = bracket.rounds.flatMap((round) => round.matches).find((m) => m.id === matchId);
  const winner = match?.winnerTeamId === match?.teamA?.id ? match?.teamA : match?.teamB;
  const score =
    match && match.scoreA !== null && match.scoreB !== null
      ? ` ${match.scoreA} : ${match.scoreB}`
      : ' by forfeit';
  const champion = bracket.champion ? ` CHAMPION — ${userText(bracket.champion.name, NAME_DISPLAY_MAX)}.` : '';
  await showBracket(h, bracket.eventId, {
    notice: `RESULT RECORDED — ${userText(winner?.name ?? 'Winner', NAME_DISPLAY_MAX)} wins${score}.${champion}`,
  });
}
