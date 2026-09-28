import type { APIButtonComponent, APIEmbed } from 'discord.js';
import { LabelBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { can, isUuid, missions, NotFoundError } from '@jave/core';
import type { HandlerContext, ModalPayload, ReplyPayload } from '../../interactions/types';
import { customId } from '../../interactions/custom-id';
import { button, field, linkButton, panel, row, success } from '../../ui/components';
import { discordTime, plainText, userText } from '../../ui/format';
import { COLORS, GLYPH } from '../../ui/theme';
import { offsetFromArg } from './data';
import { presentInPlace } from './present';
import { missionHeadline, MISSIONS_NS, SUBMISSION_PREVIEW_MAX } from './render';
import { restricted } from './staff-access';

/** Field id of the feedback text inside the verify and reject modals. */
export const FIELD_FEEDBACK = 'feedback';
const NAME_MAX = 64;
const EVIDENCE_TITLE_SHOWN = 200;
const HOST_MAX = 100;
const REVIEWER_ONLY = 'Only mission reviewers (canVerifyMissions) can review submissions.';

/** An http(s) evidence link, or null. Core validates on input; this re-checks before linking. */
export function safeEvidenceUrl(value: string | null): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

function unitText(item: missions.ReviewQueueItem): string {
  const names = item.members.map(
    (member) =>
      `${userText(member.displayName, NAME_MAX)} ${GLYPH.dot} @${userText(member.handle, NAME_MAX)}`,
  );
  return item.teamKey ? `Team \`${item.teamKey}\`\n${names.join('\n')}` : names.join('\n');
}

function evidenceText(item: missions.ReviewQueueItem): string | null {
  const url = safeEvidenceUrl(item.evidenceUrl);
  if (!item.evidenceTitle && !url) return null;
  // The link itself sits on the OPEN EVIDENCE button; the host says where it goes.
  const host = url ? `\`${plainText(url.host, HOST_MAX).replaceAll('`', '')}\`` : null;
  return [item.evidenceTitle ? userText(item.evidenceTitle, EVIDENCE_TITLE_SHOWN) : null, host]
    .filter(Boolean)
    .join(` ${GLYPH.dot} `);
}

function reviewEmbed(item: missions.ReviewQueueItem, position: number, total: number): APIEmbed {
  const fields = [
    field(item.teamKey ? 'Team' : 'Member', unitText(item)),
    field('Submitted', item.submittedAt ? discordTime(item.submittedAt, 'R') : GLYPH.unknown, true),
    field('Attempt', `${item.attempts} of ${missions.MAX_SUBMISSION_ATTEMPTS}`, true),
  ];
  const evidence = evidenceText(item);
  if (evidence) fields.push(field('Evidence', evidence));
  if (item.isOwn)
    fields.push(
      field('Not yours to review', 'You are part of this unit. Another reviewer decides it.'),
    );
  return panel({
    kicker: `REVIEW QUEUE ${GLYPH.dot} ${position} OF ${total}`,
    title: missionHeadline(item.missionNumber, item.missionTitle),
    description: item.submission
      ? userText(item.submission, SUBMISSION_PREVIEW_MAX)
      : 'No text submitted.',
    color: item.isOwn ? COLORS.steel : COLORS.chrome,
    fields,
  });
}

/** One unit from the review queue, oldest first, with VERIFY / REJECT and paging. */
export async function reviewPayload(
  h: HandlerContext,
  requestedOffset: number,
  notice?: APIEmbed,
): Promise<ReplyPayload> {
  let page = await missions.listSubmissionsForReview(h.ctx, { limit: 1, offset: requestedOffset });
  // Past the end (the last entry was just decided): show the new last entry.
  if (page.items.length === 0 && page.total > 0)
    page = await missions.listSubmissionsForReview(h.ctx, { limit: 1, offset: page.total - 1 });
  const [item] = page.items;
  if (!item) {
    const clear = panel({
      kicker: 'REVIEW QUEUE',
      title: 'Queue clear',
      description: 'No submissions await review.',
      color: COLORS.success,
    });
    return { embeds: notice ? [notice, clear] : [clear], components: [], ephemeral: true };
  }
  const offset = page.offset;
  const actions: APIButtonComponent[] = [];
  if (!item.isOwn) {
    actions.push(
      button('Verify', customId(MISSIONS_NS, 'verify', item.assignmentId, offset), 'success'),
      button('Reject', customId(MISSIONS_NS, 'reject', item.assignmentId, offset), 'danger'),
    );
  }
  const url = safeEvidenceUrl(item.evidenceUrl);
  if (url) actions.push(linkButton('Open evidence', url.toString()));
  const navigation = [
    button(
      'Previous',
      customId(MISSIONS_NS, 'review', Math.max(0, offset - 1)),
      'secondary',
      offset === 0,
    ),
    button(
      'Next',
      customId(MISSIONS_NS, 'review', offset + 1),
      'secondary',
      offset + 1 >= page.total,
    ),
  ];
  const embed = reviewEmbed(item, offset + 1, page.total);
  return {
    embeds: notice ? [notice, embed] : [embed],
    components: [row(...actions), row(...navigation)].filter((r) => r.components.length > 0),
    ephemeral: true,
  };
}

/** Queue page from a button: re-rendered in place. */
export async function showReviewPage(h: HandlerContext, rawOffset: string | undefined) {
  if (!can(h.ctx, 'canVerifyMissions')) return h.respond(restricted(REVIEWER_ONLY));
  await presentInPlace(h, await reviewPayload(h, offsetFromArg(rawOffset)));
}

type Decision = 'verify' | 'reject';

export function reviewModal(
  decision: Decision,
  assignmentId: string,
  offset: number,
): ModalPayload {
  const feedback = new TextInputBuilder()
    .setCustomId(FIELD_FEEDBACK)
    .setStyle(TextInputStyle.Paragraph)
    .setMinLength(missions.FEEDBACK_MIN)
    .setMaxLength(missions.FEEDBACK_MAX)
    .setRequired(decision === 'reject');
  return new ModalBuilder()
    .setCustomId(customId(MISSIONS_NS, decision, assignmentId, offset))
    .setTitle(decision === 'verify' ? 'VERIFY SUBMISSION' : 'RETURN SUBMISSION')
    .addLabelComponents(
      new LabelBuilder()
        .setLabel(decision === 'verify' ? 'Feedback (optional)' : 'Feedback')
        .setDescription(
          decision === 'verify'
            ? 'Shown to the member with the result.'
            : 'What to fix. The member sees it and can resubmit while attempts remain.',
        )
        .setTextInputComponent(feedback),
    )
    .toJSON();
}

function assignmentFrom(value: string | undefined): string {
  if (!value || !isUuid(value)) throw new NotFoundError('Submission');
  return value;
}

/** VERIFY / REJECT: open the feedback modal. Reviewers only; core re-checks on submit. */
export async function openReviewModal(
  h: HandlerContext,
  decision: Decision,
  args: readonly string[],
): Promise<void> {
  if (!can(h.ctx, 'canVerifyMissions')) return h.respond(restricted(REVIEWER_ONLY));
  const [rawAssignment, rawOffset] = args;
  const assignmentId = assignmentFrom(rawAssignment);
  await h.interaction.showModal(reviewModal(decision, assignmentId, offsetFromArg(rawOffset)));
}

/** Decide the unit, then show the queue again at the same position. */
export async function submitReview(
  h: HandlerContext,
  decision: Decision,
  args: readonly string[],
): Promise<void> {
  const [rawAssignment, rawOffset] = args;
  const assignmentId = assignmentFrom(rawAssignment);
  const feedback = h.interaction.modal.text(FIELD_FEEDBACK).trim();
  const decided =
    decision === 'verify'
      ? await missions.verifySubmission(h.ctx, {
          assignmentId,
          feedback: feedback === '' ? undefined : feedback,
        })
      : await missions.rejectSubmission(h.ctx, { assignmentId, feedback });
  const count = decided.length;
  const who = count === 1 ? 'member' : `${count} members`;
  const notice =
    decision === 'verify'
      ? success(
          'Submission verified',
          `Recorded as evidence for the ${who}. Rewards and achievements follow automatically.`,
        )
      : success(
          'Submission returned',
          `The ${who} ${count === 1 ? 'is' : 'are'} notified with your feedback.`,
        );
  // From the queue panel the queue advances in place; the decided entry leaves it.
  await presentInPlace(h, await reviewPayload(h, offsetFromArg(rawOffset), notice));
}

/** `/mission review`: the queue from the start. */
export async function reviewFromCommand(h: HandlerContext): Promise<void> {
  if (!can(h.ctx, 'canVerifyMissions')) return h.respond(restricted(REVIEWER_ONLY));
  await h.respond(await reviewPayload(h, 0));
}
