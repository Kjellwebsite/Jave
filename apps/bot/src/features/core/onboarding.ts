import {
  LabelBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { completeOnboarding, getMemberById, requireMember } from '@jave/core';
import type {
  CommandDefinition,
  ComponentHandler,
  HandlerContext,
  ModalHandler,
  ModalPayload,
} from '../../interactions/types';
import { SlashCommandBuilder } from 'discord.js';
import { customId } from '../../interactions/custom-id';
import { button, field, panel, row, success } from '../../ui/components';
import { BRAND, COLORS, GLYPH } from '../../ui/theme';

export const ONBOARD_NS = 'onboard';

const DOMAINS = [
  { value: 'mind', label: 'MIND', description: 'Reasoning, knowledge, research' },
  { value: 'create', label: 'CREATE', description: 'Technical, creative, projects' },
  { value: 'body', label: 'BODY', description: 'Physical capability' },
  { value: 'life', label: 'LIFE', description: 'Business and execution' },
  { value: 'bio', label: 'BIO', description: 'Self-optimization' },
] as const;

const VISIBILITY = [
  { value: 'members', label: 'MEMBERS', description: 'Visible to JAVELIN members (recommended)' },
  { value: 'public', label: 'PUBLIC', description: 'Shareable link works for anyone' },
  { value: 'staff', label: 'STAFF ONLY', description: 'Only you and staff' },
] as const;

export function onboardingModal(defaults: {
  displayName: string;
  headline?: string | null;
  domain?: string | null;
  visibility?: string;
}): ModalPayload {
  return new ModalBuilder()
    .setCustomId(customId(ONBOARD_NS, 'submit'))
    .setTitle('INITIALIZE JVLN PROFILE')
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Display name')
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId('displayName')
            .setStyle(TextInputStyle.Short)
            .setMinLength(1)
            .setMaxLength(64)
            .setValue(defaults.displayName.slice(0, 64))
            .setRequired(true),
        ),
      new LabelBuilder()
        .setLabel('Headline')
        .setDescription('One line. What you build, study or pursue.')
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId('headline')
            .setStyle(TextInputStyle.Short)
            .setMaxLength(160)
            .setRequired(false)
            .setValue(defaults.headline ?? ''),
        ),
      new LabelBuilder().setLabel('Primary domain').setStringSelectMenuComponent(
        new StringSelectMenuBuilder()
          .setCustomId('primaryDomain')
          .setRequired(true)
          .addOptions(DOMAINS.map((d) => ({ ...d, default: d.value === defaults.domain }))),
      ),
      new LabelBuilder().setLabel('Profile visibility').setStringSelectMenuComponent(
        new StringSelectMenuBuilder()
          .setCustomId('visibility')
          .setRequired(true)
          .addOptions(
            VISIBILITY.map((v) => ({
              ...v,
              default: v.value === (defaults.visibility ?? 'members'),
            })),
          ),
      ),
    )
    .toJSON();
}

async function openModal(h: HandlerContext) {
  const actor = requireMember(h.ctx);
  const member = await getMemberById(h.ctx, actor.memberId);
  await h.interaction.showModal(
    onboardingModal({
      displayName: member.displayName,
      headline: member.headline,
      domain: member.primaryDomain,
      visibility: member.profileVisibility,
    }),
  );
}

export const startCommand: CommandDefinition = {
  kind: 'slash',
  data: new SlashCommandBuilder()
    .setName('start')
    .setDescription('Initialize or edit your JVLN profile.')
    .toJSON(),
  help: { category: 'identity', summary: 'Initialize or edit your JVLN profile.' },
  execute: openModal,
};

/** Welcome message posted when someone joins (features/core/gateway.ts). */
export function welcomeMessage(userId: string) {
  return {
    content: `<@${userId}>`,
    embeds: [
      panel({
        kicker: BRAND.organization,
        title: 'Welcome to JAVELIN',
        description: [
          `**${BRAND.motto}**`,
          '',
          'JAVELIN recognizes demonstrated capability — projects, trials, research, execution.',
          'Initialize your profile to begin.',
        ].join('\n'),
        color: COLORS.chrome,
      }),
    ],
    components: [row(button('Begin', customId(ONBOARD_NS, 'begin'), 'primary'))],
  };
}

export const onboardingComponents: ComponentHandler = {
  namespace: ONBOARD_NS,
  async handle(h, action) {
    if (action === 'begin') return openModal(h);
    await h.respond({ embeds: [panel({ title: 'Unknown action' })], ephemeral: true });
  },
};

export const onboardingModals: ModalHandler = {
  namespace: ONBOARD_NS,
  async handle(h, action) {
    if (action !== 'submit') return;
    const { modal } = h.interaction;
    const member = await completeOnboarding(h.ctx, {
      displayName: modal.text('displayName'),
      headline: modal.text('headline') || undefined,
      primaryDomain: modal.select('primaryDomain')[0] as 'mind',
      profileVisibility: (modal.select('visibility')[0] ?? 'members') as 'members',
    });
    const embed = success(
      'Profile initialized',
      `${member.displayName} ${GLYPH.dot} @${member.handle}`,
    );
    embed.fields = [
      field(
        'Next',
        [
          `${GLYPH.bullet} Claim capabilities: \`/rank claim\` — claims show as CLAIMED until verified.`,
          `${GLYPH.bullet} View your card: \`/profile\``,
        ].join('\n'),
      ),
    ];
    await h.respond({
      embeds: [embed],
      components: [row(button('View profile', customId('profile', 'self')))],
      ephemeral: true,
    });
  },
};
