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
  pickCheckInEvent,
  showEventCard,
  showEventList,
  showHistory,
  openCheckIn,
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

/** Recent past events stay pickable (a bracket can finish after its evening ends). */
const PAST_PICKER_LIMIT = 10;
const EVENT_OPTION = 'event';

const eventOption = (required: boolean) => (option: SlashCommandStringOption) =>
  option.setName(EVENT_OPTION).setDescription('Event').setRequired(required).setAutocomplete(true);

const withEvent =
  (name: string, description: string, required = true) =>
  (sub: SlashCommandSubcommandBuilder) =>
    sub.setName(name).setDescription(description).addStringOption(eventOption(required));

async function eventChoices(h: HandlerContext, query: string): Promise<AutocompleteChoice[]> {
  const [upcoming, past] = await Promise.all([
    calendar.listEvents(h.ctx, { scope: 'upcoming', limit: PICKER_LIMIT }),
    calendar.listEvents(h.ctx, { scope: 'past', limit: PAST_PICKER_LIMIT }),
  ]);
  const needle = query.trim().toLowerCase();
  return [...upcoming.items, ...past.items]
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

function chosenEvent(h: HandlerContext): string {
  return requireId(h.interaction.options.string(EVENT_OPTION));
}

export const eventsCommand: CommandDefinition = {
  kind: 'slash',
  data: new SlashCommandBuilder()
    .setName('events')
    .setDescription('JAVELIN events: RSVP, check-in, teams and brackets.')
    .addSubcommand((sub) => sub.setName('list').setDescription('Upcoming events.'))
    .addSubcommand(withEvent('view', 'Open an event: details, your RSVP, controls.'))
    .addSubcommand(withEvent('checkin', 'Check in with the code the host shares.', false))
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
    switch (options.subcommand()) {
      case 'list':
        return showEventList(h);
      case 'view':
        return showEventCard(h, chosenEvent(h));
      case 'checkin': {
        const value = options.string(EVENT_OPTION);
        return value ? openCheckIn(h, requireId(value)) : pickCheckInEvent(h);
      }
      case 'create':
        return openCreateEvent(
          h,
          parseKind(options.string('kind')),
          parseCapacity(options.integer('capacity')),
        );
      case 'cancel':
        return openCancelEvent(h, chosenEvent(h));
      case 'live':
        return goLive(h, chosenEvent(h), false);
      case 'complete':
        return completeEvent(h, chosenEvent(h), false);
      case 'checkin-code':
        return issueCheckInCode(h, chosenEvent(h));
      case 'teams': {
        const eventId = chosenEvent(h);
        const size = options.integer('size');
        return size === null
          ? showTeams(h, eventId)
          : drawTeams(h, eventId, parseTeamSize(size), false);
      }
      case 'bracket':
        return showBracket(h, chosenEvent(h));
      case 'report':
        return pickMatch(h, chosenEvent(h));
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
