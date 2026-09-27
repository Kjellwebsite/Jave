import { SlashCommandBuilder } from 'discord.js';
import { applications, ValidationError } from '@jave/core';
import type { CommandDefinition, HandlerContext, ReplyPayload } from '../../interactions/types';
import { button, panel, row, stringSelect } from '../../ui/components';
import { clip, discordTime, userText } from '../../ui/format';
import { COLORS, GLYPH, LIMITS } from '../../ui/theme';
import { applicationsId, STAFF_ACTIONS } from './ids';
import { STATUS_LABELS } from './labels';

/** The in-flight queue: submitted and not yet decided. */
const QUEUE_STATUSES = ['submitted', 'review', 'interview'] as const;
const PAGE_SIZE = LIMITS.selectOptions;
const OPTION_LABEL_CHARS = 100;

type QueueScope = 'all' | 'mine';
const SCOPES: readonly QueueScope[] = ['all', 'mine'];

function parseScope(value: string | undefined): QueueScope {
  return SCOPES.find((scope) => scope === value) ?? 'all';
}

function parseOffset(value: string | undefined): number {
  const offset = Number(value ?? 0);
  if (!Number.isInteger(offset) || offset < 0) throw new ValidationError('Invalid page.');
  return offset;
}

function line(item: applications.ApplicationListItem): string {
  const who = item.applicant ? userText(item.applicant.displayName, 40) : GLYPH.unknown;
  const reviewer = item.assignedReviewer
    ? `reviewer ${userText(item.assignedReviewer.displayName, 30)}`
    : 'unclaimed';
  const submitted = item.submittedAt ? discordTime(item.submittedAt) : GLYPH.unknown;
  return `**${item.number}** ${GLYPH.dot} ${STATUS_LABELS[item.status]} ${GLYPH.dot} ${who} ${GLYPH.dot} ${submitted} ${GLYPH.dot} ${reviewer} ${GLYPH.dot} ${item.reviewCount} review${item.reviewCount === 1 ? '' : 's'}`;
}

async function renderQueue(
  h: HandlerContext,
  scope: QueueScope,
  offset: number,
): Promise<ReplyPayload> {
  const page = await applications.listApplications(h.ctx, {
    status: [...QUEUE_STATUSES],
    assignedToMe: scope === 'mine' || undefined,
    sort: 'oldest',
    limit: PAGE_SIZE,
    offset,
  });
  const title = scope === 'mine' ? 'ASSIGNED TO YOU' : 'APPLICATION QUEUE';
  if (page.items.length === 0) {
    return {
      embeds: [
        panel({
          kicker: 'APPLICATIONS',
          title,
          description:
            offset > 0
              ? 'No more applications on this page.'
              : 'Nothing waiting. The queue is clear.',
          color: COLORS.steel,
        }),
      ],
      components: [],
      ephemeral: true,
    };
  }
  const components: NonNullable<ReplyPayload['components']> = [
    row(
      stringSelect(
        applicationsId(STAFF_ACTIONS.pick),
        'Open an application',
        page.items.map((item) => ({
          label: clip(
            `${item.number} — ${STATUS_LABELS[item.status]}${item.applicant ? ` — ${item.applicant.displayName}` : ''}`,
            OPTION_LABEL_CHARS,
          ),
          value: item.id,
        })),
      ),
    ),
  ];
  const hasPrevious = offset > 0;
  const hasNext = offset + page.items.length < page.total;
  if (hasPrevious || hasNext) {
    components.push(
      row(
        ...(hasPrevious
          ? [
              button(
                'Previous',
                applicationsId(STAFF_ACTIONS.queue, Math.max(0, offset - PAGE_SIZE), scope),
              ),
            ]
          : []),
        ...(hasNext
          ? [button('Next', applicationsId(STAFF_ACTIONS.queue, offset + PAGE_SIZE, scope))]
          : []),
      ),
    );
  }
  return {
    embeds: [
      panel({
        kicker: 'APPLICATIONS',
        title,
        description: page.items.map(line).join('\n'),
        color: COLORS.base,
        footer: `${offset + 1}–${offset + page.items.length} of ${page.total} ${GLYPH.dot} oldest first`,
      }),
    ],
    components,
    ephemeral: true,
  };
}

/** Queue paging and the queue's select; false when the action is not a queue one. */
export async function handleQueueComponent(
  h: HandlerContext,
  action: string,
  args: readonly string[],
  openDetails: (h: HandlerContext, applicationId: string | undefined) => Promise<void>,
): Promise<boolean> {
  if (action === STAFF_ACTIONS.queue) {
    await h.interaction.update(await renderQueue(h, parseScope(args[1]), parseOffset(args[0])));
    return true;
  }
  if (action === STAFF_ACTIONS.pick) {
    await openDetails(h, h.interaction.values[0]);
    return true;
  }
  return false;
}

export const applicationsQueueCommand: CommandDefinition = {
  kind: 'slash',
  data: new SlashCommandBuilder()
    .setName('applications')
    .setDescription('Staff: the application review queue.')
    .addSubcommand((s) =>
      s
        .setName('queue')
        .setDescription('Submitted applications awaiting a decision, oldest first.')
        .addBooleanOption((o) =>
          o.setName('mine').setDescription('Only applications assigned to you'),
        ),
    )
    .toJSON(),
  help: {
    category: 'staff',
    summary: 'Review queue: open an application, claim, review, decide.',
    usage: '/applications queue [mine]',
  },
  requires: 'canViewApplications',
  async execute(h) {
    const scope: QueueScope = h.interaction.options.boolean('mine') ? 'mine' : 'all';
    await h.respond(await renderQueue(h, scope, 0));
  },
};
