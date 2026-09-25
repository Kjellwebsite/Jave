import type { APISelectMenuOption } from 'discord.js';
import type { calendar, Page } from '@jave/core';
import { customId } from '../../interactions/custom-id';
import type { ReplyPayload } from '../../interactions/types';
import { button, field, linkButton, panel, row, stringSelect } from '../../ui/components';
import { discordTime, userText } from '../../ui/format';
import { COLORS, GLYPH, LIMITS } from '../../ui/theme';
import {
  EVENT_ACTION,
  EVENTS_NS,
  MAX_DRAW_TEAM_SIZE,
  PICKER_LIMIT,
  TEAM_FIELD_LIMIT,
} from './constants';
import { kindLabel, plainLabel } from './render-event';

/** Monospace layout of the bracket block. */
const NAME_WIDTH = 18;
const SEED_WIDTH = 3;
const SCORE_WIDTH = 4;
const MATCH_LABEL_WIDTH = 5;
const CODE_FENCE = '```';
/** Room left for the note that the bracket continues on the dashboard. */
const TRUNCATION_RESERVE = 80;
const WINNER_MARK = '◀';
const FORFEIT_WIN = 'W';
const FORFEIT_LOSS = 'FF';
const CHECK_IN_CODE_NOTE =
  'Shown once. JAVE keeps only a hash. Share it on site or on stream; issuing a new code invalidates this one.';

/** Text that can sit inside a code block: no backticks, no control characters. */
export function codeSafe(text: string): string {
  return text.replace(/`/g, "'").replace(/\p{Cc}/gu, ' ');
}

function fit(text: string, width: number): string {
  const safe = codeSafe(text);
  return safe.length > width ? `${safe.slice(0, width - 1)}…` : safe.padEnd(width);
}

function teamCell(
  team: calendar.BracketTeamView | null,
  match: calendar.MatchView,
  slot: 'a' | 'b',
): string {
  if (!team) {
    const label = match.status === 'bye' ? '(bye)' : 'TBD';
    return `${' '.repeat(SEED_WIDTH + 1)}${fit(label, NAME_WIDTH)}`;
  }
  const seed = team.seed === null ? '' : String(team.seed);
  const score = slot === 'a' ? match.scoreA : match.scoreB;
  const won = match.winnerTeamId === team.id;
  // A result without scores is a forfeit: W for the winner, FF for the other side.
  const unscored = won ? FORFEIT_WIN : FORFEIT_LOSS;
  const scoreText =
    match.status === 'completed' ? (score === null ? unscored : String(score)) : GLYPH.unknown;
  const mark = won ? ` ${WINNER_MARK}` : '';
  return `${seed.padStart(SEED_WIDTH)} ${fit(team.name, NAME_WIDTH)}${scoreText.padStart(SCORE_WIDTH)}${mark}`;
}

function matchLines(match: calendar.MatchView): string[] {
  const label = `M${match.position + 1}`.padEnd(MATCH_LABEL_WIDTH);
  return [
    `${label}${teamCell(match.teamA, match, 'a')}`,
    `${' '.repeat(MATCH_LABEL_WIDTH)}${teamCell(match.teamB, match, 'b')}`,
  ];
}

/** The bracket as a monospace block; rounds that do not fit are left to the dashboard. */
export function bracketBlock(bracket: calendar.BracketView): { text: string; truncated: boolean } {
  const budget = LIMITS.embedDescription - CODE_FENCE.length * 2 - TRUNCATION_RESERVE;
  const lines: string[] = [];
  let length = 0;
  let truncated = false;
  const push = (line: string) => {
    if (truncated) return;
    if (length + line.length + 1 > budget) {
      truncated = true;
      return;
    }
    lines.push(line);
    length += line.length + 1;
  };
  for (const round of bracket.rounds) {
    push(round.name.toUpperCase());
    for (const match of round.matches) for (const line of matchLines(match)) push(line);
    push('');
  }
  if (bracket.champion) push(`CHAMPION  ${codeSafe(bracket.champion.name)}`);
  return { text: `${CODE_FENCE}\n${lines.join('\n').trimEnd()}\n${CODE_FENCE}`, truncated };
}

function reportOption(match: calendar.MatchView, roundName: string): APISelectMenuOption | null {
  if (match.status !== 'ready' || !match.teamA || !match.teamB) return null;
  return {
    label: plainLabel(`${match.teamA.name} vs ${match.teamB.name}`),
    value: match.id,
    description: plainLabel(`${roundName} ${GLYPH.dot} match ${match.position + 1}`),
  };
}

export function readyMatchOptions(bracket: calendar.BracketView): APISelectMenuOption[] {
  return bracket.rounds
    .flatMap((round) => round.matches.map((match) => reportOption(match, round.name)))
    .filter((option): option is APISelectMenuOption => option !== null)
    .slice(0, PICKER_LIMIT);
}

export function reportPicker(eventId: string, bracket: calendar.BracketView) {
  const options = readyMatchOptions(bracket);
  if (options.length === 0) return null;
  return row(
    stringSelect(
      customId(EVENTS_NS, EVENT_ACTION.reportPick, eventId),
      'Report a match result',
      options,
    ),
  );
}

export interface BracketPanelOptions {
  eventTitle: string;
  staff: boolean;
  /** The event accepts a new bracket (tournament, scheduled or live). */
  canGenerate: boolean;
  dashboardUrl: string | null;
  notice?: string;
}

/** Bracket panel: the monospace block, plus staff controls (generate, report). */
export function bracketPanel(
  eventId: string,
  bracket: calendar.BracketView,
  options: BracketPanelOptions,
): ReplyPayload {
  const components = [];
  let description: string;
  let footer: string | undefined;
  if (bracket.state === 'none') {
    description = options.canGenerate
      ? 'No bracket yet. It is generated from the event teams: seeded (by team seed) or random.'
      : 'No bracket for this event.';
    if (options.staff && options.canGenerate) {
      components.push(
        row(
          button(
            'Generate · seeded',
            customId(EVENTS_NS, EVENT_ACTION.generate, eventId, 'seeded'),
            'primary',
          ),
          button(
            'Generate · random',
            customId(EVENTS_NS, EVENT_ACTION.generate, eventId, 'random'),
          ),
        ),
      );
    }
  } else {
    const block = bracketBlock(bracket);
    description = block.text;
    if (block.truncated) footer = 'The full bracket is on the dashboard.';
    if (options.staff) {
      const picker = reportPicker(eventId, bracket);
      if (picker) components.push(picker);
    }
  }
  if (options.notice) description = `${options.notice}\n\n${description}`;
  if (options.dashboardUrl)
    components.push(row(linkButton('Open on dashboard', options.dashboardUrl)));
  const champion = bracket.champion
    ? `${GLYPH.dot} CHAMPION ${userText(bracket.champion.name, 64)}`
    : '';
  return {
    embeds: [
      panel({
        kicker: `BRACKET ${champion}`.trim(),
        title: userText(options.eventTitle),
        description,
        color: bracket.state === 'completed' ? COLORS.chrome : COLORS.base,
        footer,
      }),
    ],
    components,
    ephemeral: true,
  };
}

export interface TeamsPanelOptions {
  eventTitle: string;
  staff: boolean;
  /** Teams can still change (event open, no bracket yet). */
  editable: boolean;
  notice?: string;
}

export function teamsPanel(
  eventId: string,
  teams: readonly calendar.TeamView[],
  options: TeamsPanelOptions,
): ReplyPayload {
  const fields = teams
    .slice(0, TEAM_FIELD_LIMIT)
    .map((team) =>
      field(
        `${team.name}${team.seed === null ? '' : ` ${GLYPH.dot} seed ${team.seed}`}`,
        team.members.map((member) => userText(member.displayName, 64)).join(', ') || GLYPH.unknown,
        true,
      ),
    );
  const hidden = teams.length - fields.length;
  const lines = [];
  if (options.notice) lines.push(options.notice);
  if (teams.length === 0) {
    lines.push(
      'No teams yet. Drawing teams uses everyone who is GOING and not yet on a team, in a fair random order.',
    );
  }
  const components = [];
  if (options.staff && options.editable) {
    components.push(
      row(
        stringSelect(
          customId(EVENTS_NS, EVENT_ACTION.draw, eventId),
          'Draw random teams from GOING members',
          Array.from({ length: MAX_DRAW_TEAM_SIZE }, (_, index) => {
            const size = index + 1;
            return {
              label: size === 1 ? 'Solo (teams of 1)' : `Teams of ${size}`,
              value: String(size),
            };
          }),
        ),
      ),
    );
  }
  return {
    embeds: [
      panel({
        kicker: `TEAMS ${GLYPH.dot} ${teams.length}`,
        title: userText(options.eventTitle),
        description: lines.join('\n\n') || undefined,
        fields,
        footer: hidden > 0 ? `${hidden} more teams on the dashboard.` : undefined,
      }),
    ],
    components,
    ephemeral: true,
  };
}

/** The one-time display of a freshly issued check-in code. */
export function checkInCodePanel(
  issued: calendar.IssuedCheckInCode,
  eventTitle: string,
): ReplyPayload {
  return {
    embeds: [
      panel({
        kicker: 'CHECK-IN CODE',
        title: userText(eventTitle),
        description: `${CODE_FENCE}\n${codeSafe(issued.code)}\n${CODE_FENCE}\n${CHECK_IN_CODE_NOTE}`,
        color: COLORS.chrome,
        fields: [
          field(
            'Window',
            `${discordTime(issued.window.opensAt, 'f')} ${GLYPH.arrow} ${discordTime(issued.window.closesAt, 'f')}`,
          ),
        ],
      }),
    ],
    ephemeral: true,
  };
}

const HISTORY_STATUS: Record<calendar.RsvpStatus, string> = {
  going: 'GOING',
  maybe: 'MAYBE',
  declined: 'DECLINED',
  waitlist: 'WAITLIST',
};

/** A member's event record (self or event staff). */
export function historyPanel(
  displayName: string,
  page: Page<calendar.EventHistoryItem>,
): ReplyPayload {
  const lines = page.items.map((item) => {
    const attended = item.checkedInAt ? ` ${GLYPH.dot} ATTENDED ${GLYPH.verified}` : '';
    const state = item.eventStatus === 'cancelled' ? ` ${GLYPH.dot} CANCELLED` : '';
    return `${discordTime(item.startsAt, 'd')} ${GLYPH.bar} **${userText(item.title, 80)}** ${GLYPH.dot} ${kindLabel(item.kind)} ${GLYPH.dot} ${HISTORY_STATUS[item.rsvpStatus]}${attended}${state}`;
  });
  const attended = page.items.filter((item) => item.checkedInAt).length;
  return {
    embeds: [
      panel({
        kicker: 'EVENT HISTORY',
        title: userText(displayName, 64),
        description: lines.length > 0 ? lines.join('\n') : 'No event responses recorded yet.',
        footer:
          page.total > page.items.length
            ? `Showing ${page.items.length} of ${page.total}. ${attended} attended in this view.`
            : `${attended} attended.`,
      }),
    ],
    ephemeral: true,
  };
}
