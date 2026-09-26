import {
  LabelBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { can, isUuid, research, requireUser, userNames, ValidationError } from '@jave/core';
import { customId } from '../../interactions/custom-id';
import type { HandlerContext, ModalPayload } from '../../interactions/types';
import { failure } from '../../ui/components';
import { type CardViewer, itemCard } from './card';
import {
  ACTION,
  EVIDENCE_LABELS,
  EVIDENCE_LEVELS,
  type EvidenceLevel,
  RESEARCH_NS,
  REVIEW_NOTE_MAX,
  REVIEW_STATUSES,
  type ReviewStatus,
  TAGS_INPUT_MAX,
  TOPIC_MAX,
} from './constants';

/**
 * Item card, review and Sidus push. Custom ids carry only an item id (and
 * the version a reviewer saw); every handler loads the item as the clicking
 * member and core decides what they may see or change.
 */

const FIELD = {
  status: 'status',
  evidence: 'evidence',
  topic: 'topic',
  tags: 'tags',
  note: 'note',
} as const;

const REVIEW_STATUS_LABELS: Readonly<Record<ReviewStatus, string>> = {
  needs_review: 'Needs review',
  reviewed: 'Reviewed',
  verified: 'Verified (requires an evidence level)',
};

const OWN_ITEM_MESSAGE = 'Nobody reviews their own submission. Another reviewer decides.';
const INVALID_ITEM_MESSAGE = 'Choose an item from the list.';

export function viewerOf(h: HandlerContext): CardViewer {
  const actor = requireUser(h.ctx);
  return { userId: actor.userId, canReview: can(h.ctx, 'canReviewResearch') };
}

export function requireItemId(value: string | null | undefined): string {
  if (!value || !isUuid(value)) throw new ValidationError(INVALID_ITEM_MESSAGE);
  return value;
}

async function submitterDiscordId(
  h: HandlerContext,
  item: research.ResearchItemView,
): Promise<string | null> {
  const names = await userNames(h.ctx, [item.submittedByUserId]);
  return names.get(item.submittedByUserId)?.discordId ?? null;
}

/** The item card for the clicking member (core enforces visibility). */
export async function cardFor(
  h: HandlerContext,
  item: research.ResearchItemView,
  notice?: { title: string; description: string },
) {
  return itemCard(item, viewerOf(h), await submitterDiscordId(h, item), notice);
}

export async function showItem(h: HandlerContext, itemId: string): Promise<void> {
  const item = await research.getResearchItem(h.ctx, { itemId });
  await h.respond(await cardFor(h, item));
}

function restricted(description: string) {
  return {
    embeds: [failure('ACCESS RESTRICTED', description)],
    ephemeral: true,
  };
}

function reviewModal(item: research.ResearchItemView): ModalPayload {
  const current = (REVIEW_STATUSES as readonly string[]).includes(item.status)
    ? item.status
    : null;
  return new ModalBuilder()
    .setCustomId(customId(RESEARCH_NS, ACTION.review, item.id, item.version))
    .setTitle('REVIEW RESEARCH ITEM')
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Status')
        .setDescription('Leave unchanged to keep the current status.')
        .setStringSelectMenuComponent(
          new StringSelectMenuBuilder()
            .setCustomId(FIELD.status)
            .setRequired(false)
            .addOptions(
              REVIEW_STATUSES.map((status) => ({
                label: REVIEW_STATUS_LABELS[status],
                value: status,
                default: status === current,
              })),
            ),
        ),
      new LabelBuilder().setLabel('Evidence level').setStringSelectMenuComponent(
        new StringSelectMenuBuilder()
          .setCustomId(FIELD.evidence)
          .setRequired(true)
          .addOptions(
            EVIDENCE_LEVELS.map((level) => ({
              label: EVIDENCE_LABELS[level],
              value: level,
              default: level === item.evidenceLevel,
            })),
          ),
      ),
      new LabelBuilder()
        .setLabel('Topic')
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(FIELD.topic)
            .setStyle(TextInputStyle.Short)
            .setMaxLength(TOPIC_MAX)
            .setRequired(false)
            .setValue(item.topic ?? ''),
        ),
      new LabelBuilder()
        .setLabel('Tags')
        .setDescription('Comma separated, at most 10.')
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(FIELD.tags)
            .setStyle(TextInputStyle.Short)
            .setMaxLength(TAGS_INPUT_MAX)
            .setRequired(false)
            .setValue(item.tags.join(', ')),
        ),
      new LabelBuilder()
        .setLabel('Review note')
        .setDescription('Optional. Recorded in the audit log.')
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(FIELD.note)
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(REVIEW_NOTE_MAX)
            .setRequired(false),
        ),
    )
    .toJSON();
}

/** REVIEW (button or /sidus review): reviewers only, never on their own submission. */
export async function openReview(h: HandlerContext, itemId: string): Promise<void> {
  const viewer = viewerOf(h);
  if (!viewer.canReview) {
    await h.respond(restricted('Reviewing research requires canReviewResearch.'));
    return;
  }
  const item = await research.getResearchItem(h.ctx, { itemId });
  if (item.submittedByUserId === viewer.userId) {
    await h.respond(restricted(OWN_ITEM_MESSAGE));
    return;
  }
  await h.interaction.showModal(reviewModal(item));
}

export function parseTags(raw: string): string[] {
  return raw
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

function chosen<T extends string>(values: readonly string[], allowed: readonly T[]): T | undefined {
  const [value] = values;
  return value !== undefined && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

/** Review modal submission: the decision applies to the version the reviewer saw. */
export async function submitReview(
  h: HandlerContext,
  itemId: string,
  versionArg: string | undefined,
): Promise<void> {
  const version = Number(versionArg);
  if (!Number.isSafeInteger(version) || version < 1) {
    await h.respond({
      embeds: [failure('EXPIRED', 'This form is no longer active. Open the item again.')],
      ephemeral: true,
    });
    return;
  }
  const { modal } = h.interaction;
  const topic = modal.text(FIELD.topic).trim();
  const note = modal.text(FIELD.note).trim();
  const item = await research.reviewResearchItem(h.ctx, {
    itemId,
    expectedVersion: version,
    status: chosen(modal.select(FIELD.status), REVIEW_STATUSES),
    evidenceLevel: chosen<EvidenceLevel>(modal.select(FIELD.evidence), EVIDENCE_LEVELS),
    topic: topic || null,
    tags: parseTags(modal.text(FIELD.tags)),
    note: note || undefined,
  });
  await h.respond(
    await cardFor(h, item, {
      title: `REVIEW RECORDED — ${research.STATUS_LABELS[item.status]}`,
      description: `Evidence: ${EVIDENCE_LABELS[item.evidenceLevel]}. The submitter is notified when an item becomes REVIEWED or VERIFIED.`,
    }),
  );
}

/** PUSH TO SIDUS: queues the sync job for a verified item (reviewers, not the submitter). */
export async function requestSync(h: HandlerContext, itemId: string): Promise<void> {
  const item = await research.requestSidusSync(h.ctx, { itemId });
  await h.respond(
    await cardFor(h, item, {
      title: 'SIDUS SYNC QUEUED',
      description:
        'The push runs in the background. Without Sidus credentials it is recorded as not synced, with the reason.',
    }),
  );
}

export function unknownControl(h: HandlerContext): Promise<void> {
  return h.respond({
    embeds: [failure('EXPIRED', 'This control is no longer active.')],
    ephemeral: true,
  });
}
