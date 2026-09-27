import { SlashCommandBuilder } from 'discord.js';
import { projects, requireMember, ValidationError } from '@jave/core';
import { customId } from '../../interactions/custom-id';
import type { CommandDefinition, HandlerContext, ReplyPayload } from '../../interactions/types';
import { button, failure, field, panel, row, success } from '../../ui/components';
import { discordTime, userText } from '../../ui/format';
import { COLORS, GLYPH } from '../../ui/theme';
import { type ActionMap, replaceWith } from './actions';
import {
  CONTRIBUTION_PAGE_SIZE,
  DESCRIPTION_PREVIEW_MAX,
  LINE_TEXT_MAX,
  NO_PROJECT,
  PROJECTS_NS,
  REVIEW_QUEUE_WINDOW,
} from './constants';
import { loadProject, memberIdOf, projectChoices, uuidArg } from './lookup';
import { CONTRIBUTION_KIND_LABELS, contributionModal, MODAL_FIELDS, rejectModal } from './modals';
import { renderableUrl } from './render';

const PROJECT_OPTION = 'project';
const STATUS_GLYPH: Readonly<Record<projects.ContributionView['status'], string>> = {
  verified: GLYPH.verified,
  submitted: GLYPH.claimed,
  rejected: GLYPH.cross,
};
const STATUS_CHOICES = [
  { name: 'Submitted', value: 'submitted' },
  { name: 'Verified', value: 'verified' },
  { name: 'Rejected', value: 'rejected' },
] as const;
const CONTRIBUTION_KINDS = Object.keys(CONTRIBUTION_KIND_LABELS) as projects.ContributionKind[];

function kindOf(value: string | undefined): projects.ContributionKind {
  const kind = CONTRIBUTION_KINDS.find((candidate) => candidate === value);
  if (!kind) throw new ValidationError('Choose a kind of contribution.');
  return kind;
}

function statusFilter(value: string | null): projects.ContributionView['status'] | undefined {
  return STATUS_CHOICES.find((choice) => choice.value === value)?.value;
}

function contributionLine(c: projects.ContributionView): string {
  const project = c.projectTitle ? ` ${GLYPH.dot} ${userText(c.projectTitle, LINE_TEXT_MAX)}` : '';
  const note = c.reviewNote ? `\n  ${GLYPH.arrow} ${userText(c.reviewNote, LINE_TEXT_MAX)}` : '';
  return `${STATUS_GLYPH[c.status]} **${userText(c.title, LINE_TEXT_MAX)}** ${GLYPH.dot} ${c.kind.toUpperCase()} ${GLYPH.dot} ${c.status.toUpperCase()}${project} ${GLYPH.dot} ${discordTime(c.occurredAt, 'd')}${note}`;
}

/** Submitted contributions the viewer may review (never their own), in queue order. */
async function reviewQueue(
  h: HandlerContext,
): Promise<{ items: projects.ContributionView[]; truncated: boolean }> {
  requireMember(h.ctx);
  const page = await projects.listContributions(h.ctx, {
    status: 'submitted',
    excludeOwn: true,
    limit: REVIEW_QUEUE_WINDOW,
  });
  return { items: page.items, truncated: page.total > REVIEW_QUEUE_WINDOW };
}

function reviewCard(
  c: projects.ContributionView,
  index: number,
  total: number,
  truncated: boolean,
): ReplyPayload {
  const url = renderableUrl(c.url);
  const fields = [
    field(
      'Author',
      `${userText(c.memberDisplayName, LINE_TEXT_MAX)} ${GLYPH.dot} @${c.memberHandle}`,
      true,
    ),
    field(
      'Project',
      c.projectTitle ? userText(c.projectTitle, LINE_TEXT_MAX) : GLYPH.unknown,
      true,
    ),
    field('Kind', `${c.kind.toUpperCase()} ${GLYPH.dot} ${c.source.toUpperCase()}`, true),
    field('Occurred', discordTime(c.occurredAt, 'D'), true),
  ];
  if (url) fields.push(field('Link', url));
  const description = [
    `**${userText(c.title, LINE_TEXT_MAX)}**`,
    c.description ? userText(c.description, DESCRIPTION_PREVIEW_MAX) : null,
  ]
    .filter((line) => line !== null)
    .join('\n');
  return {
    embeds: [
      panel({
        kicker: `CONTRIBUTION REVIEW ${GLYPH.dot} ${index + 1}/${total}${truncated ? '+' : ''}`,
        title: 'Awaiting review',
        description,
        color: COLORS.info,
        fields,
        footer: 'Verified contributions become accepted evidence. Nobody reviews their own.',
      }),
    ],
    components: [
      row(
        button('Verify', customId(PROJECTS_NS, 'cverify', c.id, index), 'success'),
        button('Reject', customId(PROJECTS_NS, 'creject', c.id, index), 'danger'),
        button('Skip', customId(PROJECTS_NS, 'cq', index + 1)),
      ),
    ],
    ephemeral: true,
  };
}

async function queuePayload(h: HandlerContext, index: number): Promise<ReplyPayload> {
  const { items, truncated } = await reviewQueue(h);
  const item = items[index];
  if (item) return reviewCard(item, index, items.length, truncated);
  const empty = items.length === 0;
  return {
    embeds: [
      panel({
        kicker: 'CONTRIBUTION REVIEW',
        title: empty ? 'Queue clear' : 'End of queue',
        description: empty
          ? 'Nothing awaits your review. Staff review every contribution; owners and maintainers review their projects.'
          : `${items.length} awaiting review.`,
      }),
    ],
    components: empty ? [] : [row(button('Start over', customId(PROJECTS_NS, 'cq', 0)))],
    ephemeral: true,
  };
}

function queueIndex(value: string | undefined): number {
  const index = Number(value);
  return Number.isInteger(index) && index >= 0 && index < REVIEW_QUEUE_WINDOW ? index : 0;
}

async function listPayload(
  h: HandlerContext,
  memberId: string,
  heading: string,
  status: projects.ContributionView['status'] | undefined,
): Promise<ReplyPayload> {
  const page = await projects.listContributions(h.ctx, {
    memberId,
    status,
    limit: CONTRIBUTION_PAGE_SIZE,
  });
  return {
    embeds: [
      panel({
        kicker: 'JVLN CONTRIBUTIONS',
        title: heading,
        description:
          page.items.length > 0
            ? page.items.map(contributionLine).join('\n')
            : 'No contributions to show.',
        footer: `${GLYPH.verified} verified ${GLYPH.dot} ${GLYPH.claimed} awaiting review ${GLYPH.dot} ${GLYPH.cross} rejected ${GLYPH.dot} ${page.total} total`,
      }),
    ],
    ephemeral: true,
  };
}

export const contributeCommand: CommandDefinition = {
  kind: 'slash',
  data: new SlashCommandBuilder()
    .setName('contribute')
    .setDescription('Contributions: record your work, review others.')
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Record a contribution. It stays unverified until someone else reviews it.')
        .addStringOption((o) =>
          o
            .setName(PROJECT_OPTION)
            .setDescription('One of your projects (optional)')
            .setAutocomplete(true)
            .setMaxLength(64),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('list')
        .setDescription('Contributions of a member (default: you).')
        .addUserOption((o) => o.setName('member').setDescription('Member'))
        .addStringOption((o) =>
          o
            .setName('status')
            .setDescription('Only this status')
            .addChoices(...STATUS_CHOICES),
        ),
    )
    .addSubcommand((s) =>
      s.setName('review').setDescription('Staff, owners, maintainers: the review queue.'),
    )
    .toJSON(),
  help: {
    category: 'progression',
    summary: 'Record contributions; reviewers verify or reject them.',
    usage: '/contribute add | list | review',
  },
  async autocomplete(h) {
    const focused = h.interaction.options.focused();
    if (focused?.name !== PROJECT_OPTION) return h.interaction.autocomplete([]);
    return h.interaction.autocomplete(await projectChoices(h, focused.value, 'mine'));
  },
  async execute(h) {
    const o = h.interaction.options;
    switch (o.subcommand()) {
      case 'add': {
        const value = o.string(PROJECT_OPTION);
        const project = value ? await loadProject(h, value) : null;
        if (project && project.viewer.role === null) {
          return h.respond({
            embeds: [
              failure(
                'NOT ON THIS PROJECT',
                'Contributions attach only to projects you are on. Ask an owner to add you, or record it without a project.',
              ),
            ],
            ephemeral: true,
          });
        }
        return h.interaction.showModal(
          contributionModal(project ? { id: project.id, title: project.title } : null),
        );
      }
      case 'list': {
        const target = o.user('member');
        const memberId = target ? await memberIdOf(h, target) : requireMember(h.ctx).memberId;
        const heading = target
          ? userText(target.globalName ?? target.username, LINE_TEXT_MAX)
          : 'Your contributions';
        return h.respond(await listPayload(h, memberId, heading, statusFilter(o.string('status'))));
      }
      case 'review':
        return h.respond(await queuePayload(h, 0));
      default:
        throw new ValidationError('Unknown subcommand.');
    }
  },
};

export const contributionComponentActions: ActionMap = {
  async cq(h, args) {
    const payload = await queuePayload(h, queueIndex(args[0]));
    await replaceWith(h, payload.embeds ?? [], payload.components);
  },

  async cverify(h, args) {
    const contributionId = uuidArg(args, 0, 'Contribution');
    const verified = await projects.verifyContribution(h.ctx, { contributionId });
    await replaceWith(
      h,
      [
        success(
          'Contribution verified',
          `${userText(verified.title, LINE_TEXT_MAX)} ${GLYPH.dot} accepted as evidence. The author was notified.`,
        ),
      ],
      [row(button('Next', customId(PROJECTS_NS, 'cq', queueIndex(args[1]))))],
    );
  },

  async creject(h, args) {
    const contributionId = uuidArg(args, 0, 'Contribution');
    await h.interaction.showModal(rejectModal(contributionId, queueIndex(args[1])));
  },
};

export const contributionModalActions: ActionMap = {
  async contribute(h, args) {
    const projectArg = args[0];
    const projectId =
      projectArg === NO_PROJECT || projectArg === undefined
        ? undefined
        : uuidArg(args, 0, 'Project');
    const { modal } = h.interaction;
    const contribution = await projects.recordContribution(h.ctx, {
      projectId,
      kind: kindOf(modal.select(MODAL_FIELDS.kind)[0]),
      title: modal.text(MODAL_FIELDS.title),
      url: modal.text(MODAL_FIELDS.url).trim() || undefined,
      description: modal.text(MODAL_FIELDS.description) || undefined,
    });
    await h.respond({
      embeds: [
        success(
          'Contribution recorded',
          `${userText(contribution.title, LINE_TEXT_MAX)} ${GLYPH.dot} awaiting review. Staff or a project owner/maintainer verifies it — never you.`,
        ),
      ],
      ephemeral: true,
    });
  },

  async creject(h, args) {
    const contributionId = uuidArg(args, 0, 'Contribution');
    const rejected = await projects.rejectContribution(h.ctx, {
      contributionId,
      reason: h.interaction.modal.text(MODAL_FIELDS.reason),
    });
    await h.respond({
      embeds: [
        success(
          'Contribution rejected',
          `${userText(rejected.title, LINE_TEXT_MAX)} ${GLYPH.dot} the author sees your reason.`,
        ),
      ],
      components: [row(button('Next', customId(PROJECTS_NS, 'cq', queueIndex(args[1]))))],
      ephemeral: true,
    });
  },
};
