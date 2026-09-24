import { SlashCommandBuilder } from 'discord.js';
import { can } from '@jave/core';
import type { CommandDefinition, HelpCategory } from '../../interactions/types';
import { field, linkButton, panel, row } from '../../ui/components';
import { BRAND, COLORS, GLYPH } from '../../ui/theme';

const CATEGORY_ORDER: { key: HelpCategory; label: string }[] = [
  { key: 'identity', label: 'Identity' },
  { key: 'progression', label: 'Progression' },
  { key: 'operations', label: 'Operations' },
  { key: 'community', label: 'Community' },
  { key: 'intelligence', label: 'Intelligence' },
  { key: 'staff', label: 'Staff' },
  { key: 'system', label: 'System' },
];

function mention(command: CommandDefinition): string {
  if (command.kind === 'slash') return `\`/${command.data.name}\``;
  return `\`${command.data.name}\` (${command.kind === 'user_context' ? 'right-click member' : 'right-click message'} → Apps)`;
}

/** /help is generated from the live command catalog, so it never lists commands that do not exist. */
export function createHelpCommand(catalog: () => readonly CommandDefinition[]): CommandDefinition {
  return {
    kind: 'slash',
    data: new SlashCommandBuilder()
      .setName('help')
      .setDescription('What JAVE can do for you.')
      .toJSON(),
    help: { category: 'system', summary: 'This overview.' },
    async execute(h) {
      const visible = catalog().filter((c) => c.help && (!c.requires || can(h.ctx, c.requires)));
      const fields = CATEGORY_ORDER.map(({ key, label }) => {
        const lines = visible
          .filter((c) => c.help!.category === key)
          .map((c) => `${mention(c)} ${GLYPH.dot} ${c.help!.summary}`);
        return lines.length ? field(label, lines.join('\n')) : null;
      }).filter((f): f is NonNullable<typeof f> => f !== null);
      const publicUrl = h.ctx.config.publicUrl;
      await h.respond({
        embeds: [
          panel({
            kicker: BRAND.organization,
            title: BRAND.bot,
            description: `The operating layer of ${BRAND.organization}.\n**${BRAND.motto}**`,
            color: COLORS.chrome,
            fields,
          }),
        ],
        components: publicUrl ? [row(linkButton('Open dashboard', publicUrl))] : undefined,
        ephemeral: true,
      });
    },
  };
}
