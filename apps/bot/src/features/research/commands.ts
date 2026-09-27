import { SlashCommandBuilder } from 'discord.js';
import { research, ValidationError } from '@jave/core';
import type {
  AutocompleteChoice,
  CommandDefinition,
  HandlerContext,
} from '../../interactions/types';
import { clip } from '../../ui/format';
import { GLYPH } from '../../ui/theme';
import { itemList } from './card';
import {
  AUTOCOMPLETE_LIMIT,
  LIST_LIMIT,
  OPTION_TEXT_MAX,
  type ResearchStatus,
  SEARCH_MAX,
} from './constants';
import { openReview, requireItemId, showItem } from './items';

/**
 * /sidus — the SIDUS SCIENCE research library in Discord. Reads are for
 * members who can see the member directory; REVIEW is for research
 * reviewers. Replies are ephemeral: a lookup is personal.
 */

const STATUS_CHOICES = (Object.keys(research.STATUS_LABELS) as ResearchStatus[]).map((status) => ({
  name: research.STATUS_LABELS[status],
  value: status,
}));

function statusOption(h: HandlerContext): ResearchStatus | undefined {
  const value = h.interaction.options.string('status');
  return STATUS_CHOICES.find((choice) => choice.value === value)?.value;
}

async function itemChoices(h: HandlerContext, query: string): Promise<AutocompleteChoice[]> {
  const q = query.trim().slice(0, SEARCH_MAX);
  const page = await research.listResearchItems(h.ctx, {
    q: q || undefined,
    limit: AUTOCOMPLETE_LIMIT,
  });
  return page.items.map((item) => ({
    name: clip(
      `${item.title} ${GLYPH.dot} ${research.STATUS_LABELS[item.status]}`,
      OPTION_TEXT_MAX,
    ),
    value: item.id,
  }));
}

async function search(h: HandlerContext): Promise<void> {
  const query = h.interaction.options.string('query')?.trim() ?? '';
  if (!query) throw new ValidationError('Type something to search for.');
  const status = statusOption(h);
  const page = await research.listResearchItems(h.ctx, {
    q: query.slice(0, SEARCH_MAX),
    status,
    limit: LIST_LIMIT,
  });
  await h.respond(
    itemList(
      'Search results',
      page,
      'No item matches. Search looks at titles, summaries and DOIs.',
    ),
  );
}

async function recent(h: HandlerContext): Promise<void> {
  const status = statusOption(h);
  const page = await research.listResearchItems(h.ctx, { status, limit: LIST_LIMIT });
  await h.respond(
    itemList(
      status ? `Recent ${GLYPH.dot} ${research.STATUS_LABELS[status]}` : 'Recent research',
      page,
      'The library is empty. Right-click a message with a paper link → Apps → Save to Sidus.',
    ),
  );
}

export const sidusCommand: CommandDefinition = {
  kind: 'slash',
  data: new SlashCommandBuilder()
    .setName('sidus')
    .setDescription('SIDUS SCIENCE research library.')
    .addSubcommand((s) =>
      s
        .setName('search')
        .setDescription('Search titles, summaries and DOIs.')
        .addStringOption((o) =>
          o
            .setName('query')
            .setDescription('Words, a title fragment or a DOI')
            .setRequired(true)
            .setMaxLength(SEARCH_MAX),
        )
        .addStringOption((o) =>
          o
            .setName('status')
            .setDescription('Only this status')
            .addChoices(...STATUS_CHOICES),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('recent')
        .setDescription('Latest items in the library.')
        .addStringOption((o) =>
          o
            .setName('status')
            .setDescription('Only this status')
            .addChoices(...STATUS_CHOICES),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('view')
        .setDescription('One item: reference, review state, Sidus sync.')
        .addStringOption((o) =>
          o.setName('item').setDescription('Item').setRequired(true).setAutocomplete(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('review')
        .setDescription('Reviewers: set status, evidence level, topic and tags.')
        .addStringOption((o) =>
          o.setName('item').setDescription('Item').setRequired(true).setAutocomplete(true),
        ),
    )
    .toJSON(),
  help: {
    category: 'intelligence',
    summary: 'Search, browse and review the SIDUS SCIENCE research library.',
    usage: '/sidus search | recent | view | review',
  },
  requires: 'canViewMembers',

  async autocomplete(h) {
    const focused = h.interaction.options.focused();
    if (focused?.name !== 'item') return h.interaction.autocomplete([]);
    return h.interaction.autocomplete(await itemChoices(h, focused.value));
  },

  async execute(h) {
    switch (h.interaction.options.subcommand()) {
      case 'search':
        return search(h);
      case 'recent':
        return recent(h);
      case 'view':
        return showItem(h, requireItemId(h.interaction.options.string('item')));
      case 'review':
        return openReview(h, requireItemId(h.interaction.options.string('item')));
      default:
        throw new ValidationError('Unknown subcommand.');
    }
  },
};
