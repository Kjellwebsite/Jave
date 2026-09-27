import {
  SlashCommandBuilder,
  type SlashCommandStringOption,
  type SlashCommandSubcommandBuilder,
} from 'discord.js';
import { can, moderation, NotFoundError, ValidationError } from '@jave/core';
import type {
  AutocompleteChoice,
  CommandDefinition,
  HandlerContext,
  InteractionUser,
} from '../../interactions/types';
import { clip } from '../../ui/format';
import { GLYPH, LIMITS } from '../../ui/theme';
import { beginAction, CASE_ACTIONS, deleteDaysFor, durationFor, knownName } from './actions';
import { displayNameOf, ensureKnownUser } from './context';
import {
  BAN_DELETE_PRESETS,
  durationChoices,
  QUARANTINE_BOUNDS,
  QUARANTINE_PRESETS,
  TIMEOUT_BOUNDS,
  TIMEOUT_PRESETS,
} from './durations';
import { isSnowflake, uuidArg } from './ids';
import type { CaseActionKey } from './pending';
import { ACTION_LABEL, caseReply, historyReply } from './render';

/** Autocomplete choice names are capped at 100 characters by Discord. */
const CHOICE_NAME_MAX = 100;
/** Rows scanned when autocomplete filters by typed text (the services' page cap). */
const AUTOCOMPLETE_SCAN = 100;
const CASE_NUMBER = /^(?:case-?)?0*(\d{1,9})$/i;

const SUMMARY: Record<CaseActionKey, string> = {
  warn: 'Warn a member. They are notified by DM.',
  timeout: 'Time a member out (10m to 28d).',
  untimeout: 'Lift a running timeout.',
  kick: 'Remove a member from the server (confirmation required).',
  ban: 'Ban a user (confirmation required).',
  unban: 'Lift a ban.',
  quarantine: 'Restrict a member to the review channel.',
  release: 'Release a member from quarantine.',
  note: 'Private staff note on a member’s record.',
};

function reasonOption(o: SlashCommandStringOption, label = 'Reason (omit to open a form)') {
  return o
    .setName('reason')
    .setDescription(label)
    .setMinLength(moderation.MIN_REASON_LENGTH)
    .setMaxLength(moderation.MAX_REASON_LENGTH);
}

function memberSubcommand(s: SlashCommandSubcommandBuilder, action: CaseActionKey) {
  return s
    .setName(action)
    .setDescription(SUMMARY[action])
    .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true));
}

function buildData() {
  return new SlashCommandBuilder()
    .setName('mod')
    .setDescription('Moderation: cases, history and actions.')
    .addSubcommand((s) => memberSubcommand(s, 'warn').addStringOption((o) => reasonOption(o)))
    .addSubcommand((s) =>
      memberSubcommand(s, 'timeout')
        .addStringOption((o) =>
          o
            .setName('duration')
            .setDescription('10m, 1h, 1d, 7d, 28d — or type e.g. 2h')
            .setAutocomplete(true)
            .setMaxLength(24),
        )
        .addStringOption((o) => reasonOption(o)),
    )
    .addSubcommand((s) => memberSubcommand(s, 'untimeout').addStringOption((o) => reasonOption(o)))
    .addSubcommand((s) => memberSubcommand(s, 'kick').addStringOption((o) => reasonOption(o)))
    .addSubcommand((s) =>
      memberSubcommand(s, 'ban')
        .addIntegerOption((o) =>
          o
            .setName('delete_messages')
            .setDescription('Message history to delete')
            .addChoices(...BAN_DELETE_PRESETS.map((p) => ({ name: p.label, value: p.days }))),
        )
        .addStringOption((o) => reasonOption(o)),
    )
    .addSubcommand((s) =>
      s
        .setName('unban')
        .setDescription(SUMMARY.unban)
        .addStringOption((o) =>
          o
            .setName('user')
            .setDescription('Banned user (pick from the list or paste a Discord ID)')
            .setRequired(true)
            .setAutocomplete(true)
            .setMaxLength(20),
        )
        .addStringOption((o) => reasonOption(o)),
    )
    .addSubcommand((s) =>
      memberSubcommand(s, 'quarantine')
        .addStringOption((o) =>
          o
            .setName('duration')
            .setDescription('Until released (default), or 1h … 90d')
            .setAutocomplete(true)
            .setMaxLength(24),
        )
        .addStringOption((o) => reasonOption(o)),
    )
    .addSubcommand((s) => memberSubcommand(s, 'release').addStringOption((o) => reasonOption(o)))
    .addSubcommand((s) =>
      memberSubcommand(s, 'note').addStringOption((o) =>
        reasonOption(o, 'The note (omit to open a form)'),
      ),
    )
    .addSubcommand((s) =>
      s
        .setName('case')
        .setDescription('Open a case: details, Discord sync state, revoke.')
        .addStringOption((o) =>
          o
            .setName('case')
            .setDescription('Case number or search')
            .setRequired(true)
            .setAutocomplete(true)
            .setMaxLength(64),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('history')
        .setDescription('A member’s moderation record, with actions.')
        .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true)),
    )
    .toJSON();
}

function caseChoice(view: moderation.ModCaseView): AutocompleteChoice {
  const reason = view.reason.replace(/\s+/g, ' ');
  return {
    name: clip(
      `${view.reference} ${GLYPH.dot} ${ACTION_LABEL[view.action]} ${GLYPH.dot} ${view.target.name} ${GLYPH.dot} ${reason}`,
      CHOICE_NAME_MAX,
    ),
    value: view.id,
  };
}

async function caseChoices(h: HandlerContext, typed: string): Promise<AutocompleteChoice[]> {
  const number = CASE_NUMBER.exec(typed.trim())?.[1];
  const query = typed.trim().toLowerCase();
  const textSearch = Boolean(query) && !number;
  const page = await moderation.listCases(h.ctx, {
    limit: textSearch ? AUTOCOMPLETE_SCAN : LIMITS.autocompleteChoices,
    ...(number && { number: Number(number) }),
  });
  const items = textSearch
    ? page.items.filter((c) =>
        `${c.reference} ${c.action} ${c.target.name} ${c.reason}`.toLowerCase().includes(query),
      )
    : page.items;
  return items.slice(0, LIMITS.autocompleteChoices).map(caseChoice);
}

async function bannedChoices(h: HandlerContext, typed: string): Promise<AutocompleteChoice[]> {
  const page = await moderation.listCases(h.ctx, {
    action: 'ban',
    liveOnly: true,
    limit: AUTOCOMPLETE_SCAN,
  });
  const query = typed.trim().toLowerCase();
  return page.items
    .filter(
      (c) =>
        !query || c.target.discordId.includes(query) || c.target.name.toLowerCase().includes(query),
    )
    .slice(0, LIMITS.autocompleteChoices)
    .map((c) => ({
      name: clip(
        `${c.target.name} (${c.target.discordId}) ${GLYPH.dot} ${c.reference}`,
        CHOICE_NAME_MAX,
      ),
      value: c.target.discordId,
    }));
}

async function openCase(h: HandlerContext, value: string | null): Promise<void> {
  let caseId = uuidArg(value ?? undefined);
  if (!caseId && value) {
    const number = CASE_NUMBER.exec(value.trim())?.[1];
    if (number) {
      const page = await moderation.listCases(h.ctx, { number: Number(number), limit: 1 });
      caseId = page.items[0]?.id ?? null;
    }
  }
  if (!caseId) throw new NotFoundError('Case');
  await h.interaction.defer({ ephemeral: true });
  const view = await moderation.getCase(h.ctx, caseId);
  await h.respond(caseReply(view, h.ctx));
}

export async function showHistory(h: HandlerContext, target: InteractionUser): Promise<void> {
  await ensureKnownUser(h.services, target);
  const history = await moderation.getCaseHistory(h.ctx, { targetDiscordId: target.id });
  await h.respond(historyReply(history, h.ctx));
}

function requireMemberOption(h: HandlerContext): InteractionUser {
  const target = h.interaction.options.user('member');
  if (!target) throw new ValidationError('Choose a member.');
  return target;
}

async function startCaseSubcommand(h: HandlerContext, action: CaseActionKey): Promise<void> {
  const o = h.interaction.options;
  const reason = o.string('reason');
  if (action === 'unban') {
    const discordId = o.string('user')?.trim() ?? '';
    if (!isSnowflake(discordId))
      throw new ValidationError('Pick a banned user or paste a Discord ID.');
    await beginAction(h, action, { discordId, name: await knownName(h, discordId) }, { reason });
    return;
  }
  const target = requireMemberOption(h);
  await ensureKnownUser(h.services, target);
  const deleteDays = o.integer('delete_messages');
  await beginAction(
    h,
    action,
    { discordId: target.id, name: displayNameOf(target) },
    {
      reason,
      durationSeconds: durationFor(action, o.string('duration')),
      ...(action === 'ban' && { deleteMessageDays: deleteDaysFor(deleteDays?.toString() ?? '0') }),
    },
  );
}

/** /mod — every moderation action, capability-gated by the services (UI gate: canModerate). */
export const modCommand: CommandDefinition = {
  kind: 'slash',
  data: buildData(),
  requires: 'canModerate',
  help: {
    category: 'staff',
    summary: 'Warn, time out, kick, ban, quarantine; cases and history.',
    usage:
      '/mod warn | timeout | untimeout | kick | ban | unban | quarantine | release | note | case | history',
  },

  async autocomplete(h) {
    const focused = h.interaction.options.focused();
    // The router gates execution, not autocomplete: answer non-staff with nothing,
    // without touching the services (every refusal there is a durable audit row).
    if (!focused || !can(h.ctx, 'canModerate')) return h.interaction.autocomplete([]);
    const sub = h.interaction.options.subcommand();
    if (focused.name === 'duration') {
      const choices =
        sub === 'quarantine'
          ? durationChoices(QUARANTINE_PRESETS, focused.value, QUARANTINE_BOUNDS)
          : durationChoices(TIMEOUT_PRESETS, focused.value, TIMEOUT_BOUNDS);
      return h.interaction.autocomplete(choices.slice(0, LIMITS.autocompleteChoices));
    }
    if (focused.name === 'case')
      return h.interaction.autocomplete(await caseChoices(h, focused.value));
    if (focused.name === 'user')
      return h.interaction.autocomplete(await bannedChoices(h, focused.value));
    return h.interaction.autocomplete([]);
  },

  async execute(h) {
    const sub = h.interaction.options.subcommand();
    if (sub === 'case') return openCase(h, h.interaction.options.string('case'));
    if (sub === 'history') {
      await h.interaction.defer({ ephemeral: true });
      return showHistory(h, requireMemberOption(h));
    }
    const action = CASE_ACTIONS.find((candidate) => candidate === sub);
    if (!action) throw new ValidationError('Unknown subcommand.');
    return startCaseSubcommand(h, action);
  },
};
