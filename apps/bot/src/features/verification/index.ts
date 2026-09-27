import { SlashCommandBuilder } from 'discord.js';
import { ValidationError, verification } from '@jave/core';
import type {
  CommandDefinition,
  ComponentHandler,
  HandlerContext,
  ModalHandler,
} from '../../interactions/types';
import { failure } from '../../ui/components';
import type { BotFeature } from '../types';
import { ACTIONS, parseType, VERIFICATION_NS, VERIFICATION_TYPES } from './ids';
import { memberVerificationsMenu } from './member-menu';
import { queueCardJobHandler } from './queue-card';
import {
  continueRequest,
  handleRequestComponent,
  requestAutocomplete,
  submitRequest,
} from './request-flow';
import {
  handleStaffComponent,
  handleStaffModal,
  parseScope,
  queuePayload,
  showDetail,
} from './staff';
import { QUEUE_SCOPES, QUEUE_TITLES, renderMine } from './views';

/** Newest verifications listed in /verify status (the select holds 25). */
const MINE_LIMIT = 10;

async function expired(h: HandlerContext): Promise<void> {
  await h.respond({
    embeds: [failure('EXPIRED', 'This control is no longer active.')],
    ephemeral: true,
  });
}

async function showMine(h: HandlerContext): Promise<void> {
  const page = await verification.listVerifications(h.ctx, { limit: MINE_LIMIT, sort: 'newest' });
  const payload = renderMine(page.items, page.total, h.ctx.config.publicUrl);
  if (h.interaction.kind === 'button' || h.interaction.kind === 'select') {
    await h.interaction.update(payload);
    return;
  }
  await h.respond(payload);
}

const verifyCommand: CommandDefinition = {
  kind: 'slash',
  data: new SlashCommandBuilder()
    .setName('verify')
    .setDescription('Verification: move a claim from CLAIMED to VERIFIED.')
    .addSubcommand((s) =>
      s
        .setName('request')
        .setDescription(
          'Put something forward for verification. Choose from lists; no typing needed.',
        )
        .addStringOption((o) =>
          o
            .setName('type')
            .setDescription('What kind of claim')
            .addChoices(
              ...VERIFICATION_TYPES.map((type) => ({
                name: verification.TYPE_LABELS[type],
                value: type,
              })),
            ),
        )
        .addStringOption((o) =>
          o
            .setName('target')
            .setDescription('Your project, contribution, achievement, trial result or capability')
            .setAutocomplete(true)
            .setMaxLength(64),
        )
        .addStringOption((o) =>
          o
            .setName('rank')
            .setDescription('Skill only: the rank to verify')
            .setAutocomplete(true)
            .setMaxLength(4),
        ),
    )
    .addSubcommand((s) =>
      s.setName('status').setDescription('Your verifications and their decisions.'),
    )
    .addSubcommand((s) =>
      s
        .setName('queue')
        .setDescription('Verifiers: the verification queue.')
        .addStringOption((o) =>
          o
            .setName('view')
            .setDescription('Which part of the queue')
            .addChoices(
              ...QUEUE_SCOPES.map((scope) => ({ name: QUEUE_TITLES[scope], value: scope })),
            ),
        ),
    )
    .toJSON(),
  help: {
    category: 'progression',
    summary: 'Request verification of a claim; verifiers work the queue.',
    usage: '/verify request | status | queue',
  },
  async autocomplete(h) {
    await h.interaction.autocomplete(await requestAutocomplete(h));
  },
  async execute(h) {
    const o = h.interaction.options;
    switch (o.subcommand()) {
      case 'request': {
        const rawType = o.string('type');
        const type = parseType(rawType);
        if (rawType && !type) throw new ValidationError('Unknown verification type.');
        await continueRequest(h, type, o.string('target'), o.string('rank'));
        return;
      }
      case 'status':
        await showMine(h);
        return;
      case 'queue':
        await h.respond(await queuePayload(h, parseScope(o.string('view')), 0));
        return;
      default:
        throw new ValidationError('Unknown subcommand.');
    }
  },
};

const components: ComponentHandler = {
  namespace: VERIFICATION_NS,
  async handle(h, action, args) {
    if (await handleRequestComponent(h, action, args)) return;
    if (await handleStaffComponent(h, action, args)) return;
    if (action === ACTIONS.status) return showMine(h);
    if (action === ACTIONS.mine) return showDetail(h, h.interaction.values[0]);
    await expired(h);
  },
};

const modals: ModalHandler = {
  namespace: VERIFICATION_NS,
  async handle(h, action, args) {
    if (action === ACTIONS.submit) return submitRequest(h, args);
    if (await handleStaffModal(h, action, args)) return;
    await expired(h);
  },
};

/** Discord surface for the verification domain: /verify, the queue and queue cards. */
export const feature: BotFeature = {
  name: 'verification',
  commands: [verifyCommand, memberVerificationsMenu],
  components: [components],
  modals: [modals],
  jobHandlers: (services) => ({
    [verification.VERIFICATION_QUEUE_CARD_JOB]: queueCardJobHandler(services),
  }),
};
