import {
  LabelBuilder,
  ModalBuilder,
  SlashCommandBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { getSettings, moderation, ValidationError } from '@jave/core';
import type { CommandDefinition, HandlerContext } from '../../interactions/types';
import { field, panel, success } from '../../ui/components';
import { COLORS, GLYPH } from '../../ui/theme';
import { FIELD } from './actions';
import { MOD_ACTIONS, modId } from './ids';

type RaidState = 'on' | 'off';

export function raidModal(state: RaidState) {
  return new ModalBuilder()
    .setCustomId(modId(MOD_ACTIONS.raidModeSubmit, state))
    .setTitle(state === 'on' ? 'RAID MODE — ON' : 'RAID MODE — OFF')
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        state === 'on'
          ? 'Every new join is quarantined until raid mode is switched off. Staff are alerted.'
          : 'New joins are no longer held. Members already quarantined stay quarantined until released.',
      ),
    )
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Reason')
        .setDescription('Recorded in the audit log.')
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(FIELD.reason)
            .setStyle(TextInputStyle.Paragraph)
            .setMinLength(moderation.MIN_REASON_LENGTH)
            .setMaxLength(moderation.MAX_REASON_LENGTH)
            .setRequired(true),
        ),
    )
    .toJSON();
}

export function parseRaidState(value: string | undefined): RaidState | null {
  return value === 'on' || value === 'off' ? value : null;
}

/** Switch raid mode as the acting user (setRaidMode checks canManageSecurity). */
export async function applyRaidMode(
  h: HandlerContext,
  state: RaidState,
  reason: string,
): Promise<void> {
  const result = await moderation.setRaidMode(h.ctx, { enabled: state === 'on', reason });
  const headline = `RAID MODE — ${state.toUpperCase()}`;
  const body = !result.changed
    ? `Raid mode was already ${state}. Nothing changed.`
    : state === 'on'
      ? 'New joins are quarantined for review. Staff have been alerted.'
      : 'New joins are no longer held. Release held members from their history.';
  await h.respond({ embeds: [success(headline, body)], ephemeral: true });
}

async function statusReply(h: HandlerContext) {
  const [security, automod] = await Promise.all([
    getSettings(h.ctx, 'security'),
    getSettings(h.ctx, 'moderation'),
  ]);
  const onOff = (value: boolean) => (value ? 'ON' : 'OFF');
  await h.respond({
    embeds: [
      panel({
        kicker: 'JAVE SECURITY',
        title: `Raid mode ${onOff(security.raidMode)}`,
        color: security.raidMode ? COLORS.danger : COLORS.base,
        fields: [
          field(
            'Join burst',
            `${security.joinBurstCount} joins in ${security.joinBurstWindowSeconds}s`,
            true,
          ),
          field('Auto raid mode', onOff(security.autoRaidMode), true),
          field('New account', `< ${security.suspiciousAccountAgeDays} days`, true),
          field('Hold suspicious joins', onOff(security.quarantineSuspiciousJoins), true),
          field('Automod', onOff(automod.automodEnabled), true),
          field('Quarantine at risk', `${GLYPH.arrow} ${automod.quarantineRiskScore}/100`, true),
        ],
        footer: 'Change thresholds in the dashboard: Settings → Security.',
      }),
    ],
    ephemeral: true,
  });
}

export const raidModeCommand: CommandDefinition = {
  kind: 'slash',
  data: new SlashCommandBuilder()
    .setName('raidmode')
    .setDescription('Raid mode: hold every new join in quarantine.')
    .addSubcommand((s) =>
      s
        .setName('on')
        .setDescription('Quarantine every new join until switched off.')
        .addStringOption((o) =>
          o
            .setName('reason')
            .setDescription('Reason (omit to open a form)')
            .setMinLength(moderation.MIN_REASON_LENGTH)
            .setMaxLength(moderation.MAX_REASON_LENGTH),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('off')
        .setDescription('Stop holding new joins.')
        .addStringOption((o) =>
          o
            .setName('reason')
            .setDescription('Reason (omit to open a form)')
            .setMinLength(moderation.MIN_REASON_LENGTH)
            .setMaxLength(moderation.MAX_REASON_LENGTH),
        ),
    )
    .addSubcommand((s) => s.setName('status').setDescription('Raid mode and join screening state.'))
    .toJSON(),
  requires: 'canManageSecurity',
  help: {
    category: 'staff',
    summary: 'Raid mode on / off, and join screening status.',
    usage: '/raidmode on | off | status',
  },
  async execute(h) {
    const sub = h.interaction.options.subcommand();
    if (sub === 'status') {
      await h.interaction.defer({ ephemeral: true });
      return statusReply(h);
    }
    const state = parseRaidState(sub ?? undefined);
    if (!state) throw new ValidationError('Unknown subcommand.');
    const reason = h.interaction.options.string('reason')?.trim();
    if (!reason) return h.interaction.showModal(raidModal(state));
    await h.interaction.defer({ ephemeral: true });
    return applyRaidMode(h, state, reason);
  },
};
