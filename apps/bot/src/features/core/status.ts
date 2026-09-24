import { SlashCommandBuilder } from 'discord.js';
import { can, type HealthState } from '@jave/core';
import type { CommandDefinition } from '../../interactions/types';
import { panel } from '../../ui/components';
import { alignRows } from '../../ui/format';
import { COLORS } from '../../ui/theme';

const MARK: Record<HealthState, string> = { ok: '✓', degraded: '▲', down: '✕', disabled: '—' };
const LABELS: Record<string, string> = {
  discord: 'Discord',
  database: 'Database',
  queue: 'Queue',
  ai: 'AI',
  webhooks: 'Webhooks',
};

export const statusCommand: CommandDefinition = {
  kind: 'slash',
  data: new SlashCommandBuilder()
    .setName('jave')
    .setDescription('JAVE system commands.')
    .addSubcommand((s) =>
      s.setName('status').setDescription('System status: Discord, database, AI, webhooks, queue.'),
    )
    .toJSON(),
  help: { category: 'system', summary: 'System diagnostics.', usage: '/jave status' },
  defer: 'ephemeral',
  async execute(h) {
    const report = await h.services.health();
    const detailed = can(h.ctx, 'canViewSystemStatus');
    const rows: [string, string][] = report.checks.map((check) => {
      const label = LABELS[check.name] ?? check.name;
      const detail = detailed && check.detail ? `  ${check.detail}` : '';
      return [label, `${MARK[check.status]}${detail}`];
    });
    const color =
      report.status === 'ok'
        ? COLORS.success
        : report.status === 'degraded'
          ? COLORS.warning
          : COLORS.danger;
    await h.respond({
      embeds: [
        panel({
          kicker: 'JAVE',
          title: `System ${report.status === 'ok' ? 'nominal' : report.status}`,
          description: `\`\`\`\n${alignRows(rows, 4)}\n\`\`\``,
          color,
          footer: detailed
            ? `Checked ${report.checkedAt}`
            : '✓ ok · ▲ degraded · ✕ down · — disabled',
        }),
      ],
      ephemeral: true,
    });
  },
};
