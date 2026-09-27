import { SlashCommandBuilder, type SlashCommandStringOption } from 'discord.js';
import { can, missions, ValidationError } from '@jave/core';
import type {
  AutocompleteChoice,
  CommandDefinition,
  HandlerContext,
} from '../../interactions/types';
import { plainText } from '../../ui/format';
import { GLYPH, LIMITS } from '../../ui/theme';
import { openAssign } from './assign';
import { missionFromOption, typeFromValue } from './data';
import { acceptMission, chooseSubmission, confirmAbandon, openSubmission } from './member';
import { ASSIGNMENT_LABEL, STATUS_LABEL, TYPE_LABEL } from './render';
import { reviewFromCommand } from './review';
import { confirmPublish, openCreate } from './staff';
import { detailPayload, minePayload, openListPayload } from './views';

/** Missions fetched to build autocomplete choices before filtering by the typed text. */
const AUTOCOMPLETE_SCAN = 100;
const CHOICE_NAME_MAX = 100;
const MISSION_OPTION = 'mission';

interface Candidate {
  id: string;
  number: string;
  title: string;
  tag: string;
}

function toChoices(candidates: readonly Candidate[], query: string): AutocompleteChoice[] {
  const q = query.trim().toLowerCase();
  return candidates
    .filter((c) => !q || c.number.toLowerCase().includes(q) || c.title.toLowerCase().includes(q))
    .slice(0, LIMITS.autocompleteChoices)
    .map((c) => ({
      name: plainText(`${c.number} ${GLYPH.dot} ${c.title} ${GLYPH.dot} ${c.tag}`, CHOICE_NAME_MAX),
      value: c.id,
    }));
}

async function staffMissions(h: HandlerContext, status?: missions.MissionStatus) {
  const page = await missions.listMissions(h.ctx, { status, limit: AUTOCOMPLETE_SCAN });
  return page.items.filter((item) => item.status !== 'archived' || status === 'archived');
}

async function ownActive(h: HandlerContext) {
  return missions.listMyMissions(h.ctx, { scope: 'active' });
}

/** Candidates per subcommand: only missions the user can act on there. */
async function candidatesFor(h: HandlerContext, subcommand: string | null): Promise<Candidate[]> {
  const staff = can(h.ctx, 'canManageMissions') || can(h.ctx, 'canVerifyMissions');
  switch (subcommand) {
    case 'view': {
      if (staff)
        return (await staffMissions(h)).map((m) => ({ ...m, tag: STATUS_LABEL[m.status] }));
      const [open, mine] = await Promise.all([
        missions.listOpenMissions(h.ctx, { limit: AUTOCOMPLETE_SCAN }),
        ownActive(h),
      ]);
      const own = mine.map(({ mission, assignment }) => ({
        ...mission,
        tag: ASSIGNMENT_LABEL[assignment.status],
      }));
      const ownIds = new Set(own.map((m) => m.id));
      const others = open.items
        .filter((m) => !ownIds.has(m.id))
        .map((m) => ({ ...m, tag: TYPE_LABEL[m.type] }));
      return [...own, ...others];
    }
    case 'accept': {
      const open = await missions.listOpenMissions(h.ctx, { limit: AUTOCOMPLETE_SCAN });
      return open.items
        .filter((m) =>
          m.myAssignment
            ? m.myAssignment.status === 'assigned'
            : m.selfAssignable && m.type !== 'team' && m.slotsLeft !== 0,
        )
        .map((m) => ({ ...m, tag: m.myAssignment ? 'ASSIGNED TO YOU' : TYPE_LABEL[m.type] }));
    }
    case 'submit':
    case 'abandon': {
      const target = subcommand === 'submit' ? 'submitted' : 'abandoned';
      return (await ownActive(h))
        .filter(
          ({ assignment }) =>
            missions.canTransitionAssignment(assignment.status, target) &&
            (target === 'abandoned' || assignment.status !== 'assigned'),
        )
        .map(({ mission, assignment }) => ({
          ...mission,
          tag: ASSIGNMENT_LABEL[assignment.status],
        }));
    }
    case 'publish':
      if (!can(h.ctx, 'canManageMissions')) return [];
      return (await staffMissions(h, 'draft')).map((m) => ({ ...m, tag: 'DRAFT' }));
    case 'assign':
      if (!can(h.ctx, 'canManageMissions')) return [];
      return (await staffMissions(h, 'open')).map((m) => ({ ...m, tag: TYPE_LABEL[m.type] }));
    default:
      return [];
  }
}

function missionOption(required: boolean, description: string) {
  return (o: SlashCommandStringOption) =>
    o
      .setName(MISSION_OPTION)
      .setDescription(description)
      .setRequired(required)
      .setAutocomplete(true);
}

export const missionCommand: CommandDefinition = {
  kind: 'slash',
  data: new SlashCommandBuilder()
    .setName('mission')
    .setDescription('Missions: verifiable work that becomes evidence on your record.')
    .addSubcommand((s) =>
      s
        .setName('list')
        .setDescription('Open missions, with ACCEPT.')
        .addStringOption((o) =>
          o
            .setName('type')
            .setDescription('Only this type')
            .addChoices(
              ...missions.MISSION_TYPES.map((type) => ({ name: TYPE_LABEL[type], value: type })),
            ),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('view')
        .setDescription('A mission and your assignment.')
        .addStringOption(missionOption(true, 'Mission')),
    )
    .addSubcommand((s) =>
      s
        .setName('accept')
        .setDescription('Take a mission, or accept one assigned to you.')
        .addStringOption(missionOption(true, 'Mission')),
    )
    .addSubcommand((s) =>
      s
        .setName('submit')
        .setDescription('Submit your work with evidence.')
        .addStringOption(missionOption(false, 'Mission (default: choose)')),
    )
    .addSubcommand((s) => s.setName('mine').setDescription('Your missions and where they stand.'))
    .addSubcommand((s) =>
      s
        .setName('abandon')
        .setDescription('Walk away from a mission you hold.')
        .addStringOption(missionOption(true, 'Mission')),
    )
    .addSubcommand((s) => s.setName('create').setDescription('Staff: draft a new mission.'))
    .addSubcommand((s) =>
      s
        .setName('publish')
        .setDescription('Staff: open a draft and announce it.')
        .addStringOption(missionOption(true, 'Draft')),
    )
    .addSubcommand((s) =>
      s
        .setName('assign')
        .setDescription('Staff: assign an open mission to members.')
        .addStringOption(missionOption(true, 'Open mission')),
    )
    .addSubcommand((s) =>
      s.setName('review').setDescription('Staff: submissions awaiting review, oldest first.'),
    )
    .toJSON(),
  help: {
    category: 'progression',
    summary: 'Open missions, your work, submissions. Staff create, assign and review.',
    usage:
      '/mission list | view | accept | submit | mine | abandon | create | publish | assign | review',
  },

  async autocomplete(h) {
    const focused = h.interaction.options.focused();
    if (!focused || focused.name !== MISSION_OPTION) return h.interaction.autocomplete([]);
    const candidates = await candidatesFor(h, h.interaction.options.subcommand());
    await h.interaction.autocomplete(toChoices(candidates, focused.value));
  },

  async execute(h) {
    const o = h.interaction.options;
    switch (o.subcommand()) {
      case 'list':
        return h.respond(await openListPayload(h, typeFromValue(o.string('type')), 0));
      case 'view':
        return h.respond(await detailPayload(h, missionFromOption(h)));
      case 'accept':
        return acceptMission(h, missionFromOption(h));
      case 'submit':
        return o.string(MISSION_OPTION)
          ? openSubmission(h, missionFromOption(h))
          : chooseSubmission(h);
      case 'mine':
        return h.respond(await minePayload(h, 'active'));
      case 'abandon':
        return confirmAbandon(h, missionFromOption(h));
      case 'create':
        return openCreate(h);
      case 'publish':
        return confirmPublish(h, missionFromOption(h));
      case 'assign':
        return openAssign(h, missionFromOption(h));
      case 'review':
        return reviewFromCommand(h);
      default:
        throw new ValidationError('Unknown subcommand.');
    }
  },
};
