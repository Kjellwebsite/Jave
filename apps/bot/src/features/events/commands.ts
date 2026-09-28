import {
  ApplicationCommandType,
  ContextMenuCommandBuilder,
  SlashCommandBuilder,
  type SlashCommandStringOption,
  type SlashCommandSubcommandBuilder,
} from 'discord.js';
import { calendar, NotFoundError, ValidationError } from '@jave/core';
import type {
  AutocompleteChoice,
  CommandDefinition,
  HandlerContext,
} from '../../interactions/types';
import { GLYPH } from '../../ui/theme';
import { EVENT_KINDS, MAX_DRAW_TEAM_SIZE, PICKER_LIMIT } from './constants';
import {
  openCheckIn,
  pickableEvents,
  pickCheckInEvent,
  pickEvent,
  showEventCard,
  showEventList,
  showHistory,
} from './member-flows';
import { plainLabel, shortUtc } from './render-event';
import {
  completeEvent,
  drawTeams,
  goLive,
  issueCheckInCode,
  openCancelEvent,
  openCreateEvent,
  parseCapacity,
  parseKind,
  parseTeamSize,
  pickMatch,
  showBracket,
  showTeams,
} from './staff-flows';
import { requireId } from './support';

const EVENT_OPTION = 'event';

const eventOption = (option: SlashCommandStringOption) =>
  option
    .setName(EVENT_OPTION)
    .setDescription('Event. Leave empty to choose from a list.')
    .setAutocomplete(true);

const withEvent = (name: string, description: string) => (sub: SlashCommandSubcommandBuilder) =>
  sub.setName(name).setDescription(description).addStringOption(eventOption);

async function eventChoices(h: HandlerContext, query: string): Promise<AutocompleteChoice[]> {
  const needle = query.trim().toLowerCase();
  return (await pickableEvents(h))
    .filter((event) => !needle || event.title.toLowerCase().includes(needle))
    .slice(0, PICKER_LIMIT)
    .map((event) => {
      const state =
        event.status === 'scheduled' ? '' : ` ${GLYPH.dot} ${event.status.toUpperCase()}`;
      return {
        name: plainLabel(`${event.title} ${GLYPH.dot} ${shortUtc(event.startsAt)}${state}`),
        value: event.id,
      };
    });
}

/** The event option, validated; null when it was left out. */
function chosenEvent(h: HandlerContext): string | null {
  const value = h.interaction.options.string(EVENT_OPTION);
  return value === null ? null : requireId(value);
}

export const eventsCommand: CommandDefinition = {
  kind: 'slash',
  data: new SlashCommandBuilder()
    .setName('events')
    .setDescription('JAVELIN events: RSVP, check-in, teams and brackets.')
    .addSubcommand((sub) => sub.setName('list').setDescription('Upcoming events.'))
    .addSubcommand(withEvent('view', 'Open an event: details, your RSVP, controls.'))
    .addSubcommand(withEvent('checkin', 'Check in with the code the host shares.'))
    .addSubcommand((sub) =>
      sub
        .setName('create')
        .setDescription('Staff: schedule an event.')
        .addStringOption((option) =>
          option
            .setName('kind')
            .setDescription('Kind of event (default: meetup)')
            .addChoices(...EVENT_KINDS.map((kind) => ({ name: kind, value: kind }))),
        )
        .addIntegerOption((option) =>
          option
            .setName('capacity')
            .setDescription('Maximum attendees; beyond it members join a waitlist')
            .setMinValue(1)
            .setMaxValue(calendar.MAX_EVENT_CAPACITY),
        ),
    )
    .addSubcommand(withEvent('cancel', 'Staff: cancel an event (reason required).'))
    .addSubcommand(withEvent('live', 'Staff: mark an event live.'))
    .addSubcommand(withEvent('complete', 'Staff: mark an event completed.'))
    .addSubcommand(withEvent('checkin-code', 'Staff: issue a check-in code (shown once).'))
    .addSubcommand((sub) =>
      withEvent(
        'teams',
        'Staff: view teams, or draw random teams from GOING members.',
      )(sub).addIntegerOption((option) =>
        option
          .setName('size')
          .setDescription('Draw teams of this size now')
          .setMinValue(1)
          .setMaxValue(MAX_DRAW_TEAM_SIZE),
      ),
    )
    .addSubcommand(withEvent('bracket', 'Tournament bracket.'))
    .addSubcommand(withEvent('report', 'Staff: report a match result.'))
    .toJSON(),
  help: {
    category: 'community',
    summary: 'Events: RSVP, check-in, teams and tournament brackets.',
    usage:
      '/events list | view | checkin — staff: create | live | complete | cancel | checkin-code | teams | bracket | report',
  },

  async autocomplete(h) {
    const focused = h.interaction.options.focused();
    if (focused?.name !== EVENT_OPTION) return h.interaction.autocomplete([]);
    await h.interaction.autocomplete(await eventChoices(h, focused.value));
  },

  async execute(h) {
    const options = h.interaction.options;
    const subcommand = options.subcommand();
    if (subcommand === 'list') return showEventList(h);
    if (subcommand === 'create') {
      return openCreateEvent(
        h,
        parseKind(options.string('kind')),
        parseCapacity(options.integer('capacity')),
      );
    }
    const eventId = chosenEvent(h);
    if (eventId === null) {
      // No event typed: members land on the upcoming list, check-in on the open windows,
      // everything else on a picker whose card carries the controls.
      if (subcommand === 'view') return showEventList(h);
      if (subcommand === 'checkin') return pickCheckInEvent(h);
      return pickEvent(h);
    }
    switch (subcommand) {
      case 'view':
        return showEventCard(h, eventId);
      case 'checkin':
        return openCheckIn(h, eventId);
      case 'cancel':
        return openCancelEvent(h, eventId);
      case 'live':
        return goLive(h, eventId, false);
      case 'complete':
        return completeEvent(h, eventId, false);
      case 'checkin-code':
        return issueCheckInCode(h, eventId);
      case 'teams': {
        const size = options.integer('size');
        return size === null
          ? showTeams(h, eventId)
          : drawTeams(h, eventId, parseTeamSize(size), false);
      }
      case 'bracket':
        return showBracket(h, eventId);
      case 'report':
        return pickMatch(h, eventId);
      default:
        throw new ValidationError('Unknown subcommand.');
    }
  },
};

/** Right-click a member → Apps → Event History (self, or staff for anyone; core decides). */
export const eventHistoryContextCommand: CommandDefinition = {
  kind: 'user_context',
  data: new ContextMenuCommandBuilder()
    .setName('Event History')
    .setType(ApplicationCommandType.User)
    .toJSON(),
  help: {
    category: 'community',
    summary: 'Right-click a member → Apps → Event History (yours, or anyone for event staff).',
  },
  async execute(h) {
    const target = h.interaction.targetUser;
    if (!target) throw new NotFoundError('Member');
    await showHistory(h, target);
  },
};
