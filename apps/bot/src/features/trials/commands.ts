import {
  ApplicationCommandType,
  ContextMenuCommandBuilder,
  SlashCommandBuilder,
  type SlashCommandStringOption,
} from 'discord.js';
import { findMemberByDiscordId, isUuid, NotFoundError, trials, ValidationError } from '@jave/core';
import type { CommandDefinition, HandlerContext } from '../../interactions/types';
import { clip } from '../../ui/format';
import { LIMITS } from '../../ui/theme';
import { showMyBriefings } from '../adversarial/operative';
import {
  confirmWithdraw,
  listOngoing,
  offerApply,
  offerSubmit,
  offerWithdraw,
  openApplyModal,
  openSubmitModal,
  pickToView,
  showStatus,
  showTeams,
  showTrial,
  showTrialRecord,
} from './member-flows';
import { STATUS_LABEL } from './render/labels';
import { openPanel, pickTrialToManage } from './staff-flows';

const TRIAL_OPTION = 'trial';
const CHOICE_NAME_MAX = 100;
/** How many visible trials a typed reference is matched against. */
const TYPED_LOOKUP_LIMIT = 100;
/** "TRIAL-0042", "#42" or "42". */
const REF_NUMBER = /^(?:trial-|#)?0*(\d{1,9})$/i;

const trialOption = (description: string) => (option: SlashCommandStringOption) =>
  option.setName(TRIAL_OPTION).setDescription(description).setAutocomplete(true);

/** Trials the caller may see (core scopes the list), matching what they typed. */
async function trialChoices(h: HandlerContext, query: string) {
  const page = await trials.listTrials(h.ctx, { limit: 50 });
  const q = query.trim().toLowerCase();
  return page.items
    .filter(
      (item) => !q || item.ref.toLowerCase().includes(q) || item.title.toLowerCase().includes(q),
    )
    .slice(0, LIMITS.autocompleteChoices)
    .map((item) => ({
      name: clip(`${item.ref} — ${item.title} · ${STATUS_LABEL[item.status]}`, CHOICE_NAME_MAX),
      value: item.id,
    }));
}

/**
 * The trial option: the id autocomplete supplies, or — when someone typed
 * instead of picking — a reference ("TRIAL-0042", "42") or an exact title
 * among the trials they may see.
 */
async function resolveTrialOption(h: HandlerContext, given: string): Promise<string> {
  const value = given.trim();
  if (isUuid(value)) return value;
  const page = await trials.listTrials(h.ctx, { limit: TYPED_LOOKUP_LIMIT });
  const wanted = value.toLowerCase();
  const number = REF_NUMBER.exec(value)?.[1];
  const match = page.items.find(
    (item) =>
      item.ref.toLowerCase() === wanted ||
      (number !== undefined && item.number === Number(number)) ||
      item.title.toLowerCase() === wanted,
  );
  if (!match) throw new NotFoundError('Trial');
  return match.id;
}

/** Everything except the modal-opening paths answers after a (private) defer. */
async function deferPrivately(h: HandlerContext): Promise<void> {
  await h.interaction.defer({ ephemeral: true });
}

export const trialCommand: CommandDefinition = {
  kind: 'slash',
  data: new SlashCommandBuilder()
    .setName('trial')
    .setDescription('Trials — real missions, published rubrics, verified outcomes.')
    .addSubcommand((s) => s.setName('list').setDescription('Open and running trials.'))
    .addSubcommand((s) =>
      s
        .setName('view')
        .setDescription('One trial: state, your team, your submission, your result.')
        .addStringOption(trialOption('Trial (default: choose from a list)')),
    )
    .addSubcommand((s) =>
      s
        .setName('apply')
        .setDescription('Apply to a recruiting trial with a short statement.')
        .addStringOption(trialOption('Trial (default: choose)')),
    )
    .addSubcommand((s) =>
      s
        .setName('withdraw')
        .setDescription('Leave a trial before it starts.')
        .addStringOption(trialOption('Trial (default: choose)')),
    )
    .addSubcommand((s) =>
      s
        .setName('submit')
        .setDescription('Submit your team’s work. Each submission is a new version.')
        .addStringOption(trialOption('Trial (default: choose)')),
    )
    .addSubcommand((s) =>
      s.setName('status').setDescription('Your trials, teams, deadlines and results.'),
    )
    .addSubcommand((s) =>
      s
        .setName('briefing')
        .setDescription('Your confidential briefing, if one is addressed to you.'),
    )
    .addSubcommand((s) =>
      s
        .setName('manage')
        .setDescription('Staff: operate a trial from its control panel.')
        .addStringOption(trialOption('Trial (default: choose from a list)')),
    )
    .toJSON(),
  help: {
    category: 'progression',
    summary: 'Trials: apply, submit, follow deadlines; staff run them from a control panel.',
    usage: '/trial list | view | apply | withdraw | submit | status | briefing | manage',
  },

  async autocomplete(h) {
    const focused = h.interaction.options.focused();
    if (!focused || focused.name !== TRIAL_OPTION) return h.interaction.autocomplete([]);
    return h.interaction.autocomplete(await trialChoices(h, focused.value));
  },

  async execute(h) {
    const o = h.interaction.options;
    const given = o.string(TRIAL_OPTION);
    const trialId = given ? await resolveTrialOption(h, given) : null;
    switch (o.subcommand()) {
      // Modal paths answer with the modal itself: no defer.
      case 'apply':
        if (trialId) return openApplyModal(h, trialId);
        await deferPrivately(h);
        return offerApply(h);
      case 'submit':
        if (trialId) return openSubmitModal(h, trialId);
        await deferPrivately(h);
        return offerSubmit(h);
      case 'list':
        await deferPrivately(h);
        return listOngoing(h);
      case 'view':
        await deferPrivately(h);
        return trialId ? showTrial(h, trialId) : pickToView(h);
      case 'withdraw':
        await deferPrivately(h);
        return trialId ? confirmWithdraw(h, trialId) : offerWithdraw(h);
      case 'status':
        await deferPrivately(h);
        return showStatus(h);
      case 'briefing':
        await deferPrivately(h);
        return showMyBriefings(h);
      case 'manage':
        await deferPrivately(h);
        return trialId ? openPanel(h, trialId) : pickTrialToManage(h);
      default:
        throw new ValidationError('Unknown subcommand.');
    }
  },
};

export const teamCommand: CommandDefinition = {
  kind: 'slash',
  data: new SlashCommandBuilder()
    .setName('team')
    .setDescription('Your trial team: teammates, private channel, deadline, brief.')
    .toJSON(),
  help: { category: 'progression', summary: 'Your active trial team(s), channel and deadline.' },
  defer: 'ephemeral',
  execute: showTeams,
};

export const trialRecordContextCommand: CommandDefinition = {
  kind: 'user_context',
  data: new ContextMenuCommandBuilder()
    .setName('Trial Record')
    .setType(ApplicationCommandType.User)
    .toJSON(),
  help: {
    category: 'progression',
    summary: 'Right-click a member → Apps → Trial Record (yourself, or staff).',
  },
  defer: 'ephemeral',
  async execute(h) {
    const target = h.interaction.targetUser;
    if (!target) throw new NotFoundError('Member');
    const member = await findMemberByDiscordId(h.ctx, target.id);
    if (!member) throw new NotFoundError('JVLN profile');
    await showTrialRecord(h, member.id, member.displayName);
  },
};
