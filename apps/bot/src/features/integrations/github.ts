import {
  LabelBuilder,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import {
  can,
  findMemberByDiscordId,
  integrations,
  isUuid,
  NotFoundError,
  requireMember,
  ValidationError,
} from '@jave/core';
import { customId } from '../../interactions/custom-id';
import type { ActionMap } from '../projects/actions';
import type {
  CommandDefinition,
  HandlerContext,
  ModalPayload,
  ReplyPayload,
} from '../../interactions/types';
import {
  button,
  field,
  failure,
  linkButton,
  notice,
  panel,
  row,
  success,
} from '../../ui/components';
import { userText } from '../../ui/format';
import { COLORS, GLYPH } from '../../ui/theme';

export const INTEGRATIONS_NS = 'integrations';

const USERNAME_FIELD = 'username';
const EXTERNAL_ID_FIELD = 'externalId';
/** GitHub logins are at most 39 characters (a leading @ is tolerated). */
const GITHUB_LOGIN_INPUT_MAX = 40;
/** GitHub numeric user ids fit in 20 digits. */
const GITHUB_ID_INPUT_MAX = 20;
const NAME_MAX = 64;

function memberArg(args: readonly string[]): string {
  const value = args[0];
  if (!value || !isUuid(value)) throw new NotFoundError('Member');
  return value;
}

function linkModal(current: string | null): ModalPayload {
  const input = new TextInputBuilder()
    .setCustomId(USERNAME_FIELD)
    .setStyle(TextInputStyle.Short)
    .setMinLength(1)
    .setMaxLength(GITHUB_LOGIN_INPUT_MAX)
    .setRequired(true);
  if (current) input.setValue(current);
  return new ModalBuilder()
    .setCustomId(customId(INTEGRATIONS_NS, 'ghlink'))
    .setTitle('LINK GITHUB ACCOUNT')
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('GitHub username')
        .setDescription('Self-declared until staff verify it. Changing it resets verification.')
        .setTextInputComponent(input),
    )
    .toJSON();
}

function verifyModal(memberId: string, login: string, currentId: string | null): ModalPayload {
  const input = new TextInputBuilder()
    .setCustomId(EXTERNAL_ID_FIELD)
    .setStyle(TextInputStyle.Short)
    .setMinLength(1)
    .setMaxLength(GITHUB_ID_INPUT_MAX)
    .setRequired(true);
  if (currentId) input.setValue(currentId);
  return new ModalBuilder()
    .setCustomId(customId(INTEGRATIONS_NS, 'ghverify', memberId))
    .setTitle('VERIFY GITHUB ACCOUNT')
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Numeric GitHub user id')
        .setDescription(
          `From api.github.com/users/${login} — binds the account to ${login}.`.slice(0, 100),
        )
        .setTextInputComponent(input),
    )
    .toJSON();
}

interface CardSubject {
  memberId: string;
  name: string;
  self: boolean;
}

/** The linked-account card, with self-service or staff controls. */
function accountCard(
  h: HandlerContext,
  subject: CardSubject,
  account: integrations.ExternalAccountView | null,
): ReplyPayload {
  const staff = !subject.self && can(h.ctx, 'canVerifyMembers');
  const title = subject.self ? 'Your GitHub account' : subject.name;
  if (!account) {
    return {
      embeds: [
        panel({
          kicker: 'GITHUB ACCOUNT',
          title,
          description: subject.self
            ? 'No GitHub account linked. Link one so merged pull requests on linked project repositories can count as contributions.'
            : 'No GitHub account linked.',
        }),
      ],
      components: subject.self
        ? [row(button('Link account', customId(INTEGRATIONS_NS, 'ghlinkopen'), 'primary'))]
        : [],
      ephemeral: true,
    };
  }
  const state = account.verified
    ? `**VERIFIED** ${GLYPH.verified}`
    : `**SELF-DECLARED** ${GLYPH.claimed} — unverified`;
  const fields = [
    field('Username', `\`${account.username}\``, true),
    field('Status', state, true),
    field('GitHub id', account.externalId ? `\`${account.externalId}\`` : GLYPH.unknown, true),
  ];
  const explainer = account.verified
    ? 'Pull requests by this account that someone else merges count as verified contributions.'
    : 'Merged pull requests stay pending until a reviewer verifies them. Staff verify accounts out of band.';
  const controls = subject.self
    ? [
        button('Change username', customId(INTEGRATIONS_NS, 'ghlinkopen')),
        button('Unlink', customId(INTEGRATIONS_NS, 'ghunlink', subject.memberId), 'danger'),
      ]
    : staff
      ? [
          button(
            account.verified ? 'Re-bind id' : 'Verify',
            customId(INTEGRATIONS_NS, 'ghverifyopen', subject.memberId),
            'success',
          ),
          ...(account.verified
            ? [button('Revoke', customId(INTEGRATIONS_NS, 'ghrevoke', subject.memberId))]
            : []),
          button('Unlink', customId(INTEGRATIONS_NS, 'ghunlink', subject.memberId), 'danger'),
        ]
      : [];
  return {
    embeds: [
      panel({
        kicker: 'GITHUB ACCOUNT',
        title,
        description: explainer,
        fields,
        color: account.verified ? COLORS.success : COLORS.base,
      }),
    ],
    components: [
      ...(controls.length > 0 ? [row(...controls)] : []),
      row(linkButton('GitHub profile', account.profileUrl)),
    ],
    ephemeral: true,
  };
}

async function accountOf(
  h: HandlerContext,
  memberId: string,
): Promise<integrations.ExternalAccountView | null> {
  const [account] = await integrations.getExternalAccounts(h.ctx, { memberId });
  return account ?? null;
}

async function selfCard(h: HandlerContext): Promise<ReplyPayload> {
  const { memberId } = requireMember(h.ctx);
  return accountCard(h, { memberId, name: '', self: true }, await accountOf(h, memberId));
}

async function memberCard(h: HandlerContext, memberId: string, name: string) {
  const self = h.ctx.actor.kind === 'user' && h.ctx.actor.memberId === memberId;
  return accountCard(h, { memberId, name, self }, await accountOf(h, memberId));
}

async function openLinkModal(h: HandlerContext): Promise<void> {
  const { memberId } = requireMember(h.ctx);
  const current = await accountOf(h, memberId);
  await h.interaction.showModal(linkModal(current?.username ?? null));
}

export const githubCommand: CommandDefinition = {
  kind: 'slash',
  data: new SlashCommandBuilder()
    .setName('github')
    .setDescription('Your linked GitHub account.')
    .addSubcommand((s) =>
      s.setName('link').setDescription('Link (or change) your GitHub username. Self-declared.'),
    )
    .addSubcommand((s) => s.setName('status').setDescription('Your linked account and its status.'))
    .addSubcommand((s) =>
      s
        .setName('verify')
        .setDescription('Staff: review and verify a member’s linked GitHub account.')
        .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true)),
    )
    .toJSON(),
  help: {
    category: 'identity',
    summary: 'Link your GitHub account; staff verify it.',
    usage: '/github link | status | verify',
  },
  async execute(h) {
    const o = h.interaction.options;
    switch (o.subcommand()) {
      case 'link':
        return openLinkModal(h);
      case 'status':
        return h.respond(await selfCard(h));
      case 'verify': {
        if (!can(h.ctx, 'canVerifyMembers')) {
          return h.respond({
            embeds: [
              failure('ACCESS RESTRICTED', 'Only staff with canVerifyMembers verify accounts.'),
            ],
            ephemeral: true,
          });
        }
        const target = o.user('member');
        if (!target) throw new ValidationError('Choose a member.');
        const member = await findMemberByDiscordId(h.ctx, target.id);
        if (!member) throw new NotFoundError('JVLN profile');
        return h.respond(
          await memberCard(h, member.id, userText(target.globalName ?? target.username, NAME_MAX)),
        );
      }
      default:
        throw new ValidationError('Unknown subcommand.');
    }
  },
};

export const githubComponentActions: ActionMap = {
  ghlinkopen: (h) => openLinkModal(h),

  async ghunlink(h, args) {
    const memberId = memberArg(args);
    await h.respond({
      embeds: [
        notice(
          'UNLINK GITHUB ACCOUNT',
          'Merged pull requests stop matching this member. Recorded contributions stay.',
        ),
      ],
      components: [
        row(button('Unlink', customId(INTEGRATIONS_NS, 'ghunlinkok', memberId), 'danger')),
      ],
      ephemeral: true,
    });
  },

  async ghunlinkok(h, args) {
    const memberId = memberArg(args);
    await integrations.unlinkGithubAccount(h.ctx, { memberId });
    await h.interaction.update({
      embeds: [success('GitHub account unlinked')],
      components: [],
    });
  },

  async ghverifyopen(h, args) {
    const memberId = memberArg(args);
    if (!can(h.ctx, 'canVerifyMembers')) {
      return h.respond({
        embeds: [failure('ACCESS RESTRICTED', 'Only staff with canVerifyMembers verify accounts.')],
        ephemeral: true,
      });
    }
    const account = await accountOf(h, memberId);
    if (!account) throw new NotFoundError('Linked GitHub account');
    await h.interaction.showModal(verifyModal(memberId, account.username, account.externalId));
  },

  async ghrevoke(h, args) {
    const memberId = memberArg(args);
    const account = await integrations.setExternalAccountVerification(h.ctx, {
      memberId,
      verified: false,
    });
    await h.interaction.update({
      embeds: [success('Verification revoked', `\`${account.username}\` is self-declared again.`)],
      components: [],
    });
  },
};

export const githubModalActions: ActionMap = {
  async ghlink(h) {
    const account = await integrations.linkGithubAccount(h.ctx, {
      username: h.interaction.modal.text(USERNAME_FIELD),
    });
    await h.respond({
      embeds: [
        success(
          'GitHub account linked',
          `\`${account.username}\` ${GLYPH.dot} ${account.verified ? 'VERIFIED' : 'SELF-DECLARED — staff verify it before merged pull requests count on their own.'}`,
        ),
      ],
      ephemeral: true,
    });
  },

  async ghverify(h, args) {
    const memberId = memberArg(args);
    const account = await integrations.setExternalAccountVerification(h.ctx, {
      memberId,
      verified: true,
      externalId: h.interaction.modal.text(EXTERNAL_ID_FIELD).trim(),
    });
    await h.respond({
      embeds: [
        success(
          'GitHub account verified',
          `\`${account.username}\` ${GLYPH.dot} id \`${account.externalId ?? GLYPH.unknown}\`. The member was notified.`,
        ),
      ],
      ephemeral: true,
    });
  },
};
