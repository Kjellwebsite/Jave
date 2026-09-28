import type { APIButtonComponent, APIEmbed } from 'discord.js';
import { LabelBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { can, isUuid, missions, NotFoundError } from '@jave/core';
import type { HandlerContext, ModalPayload, ReplyPayload } from '../../interactions/types';
import { customId } from '../../interactions/custom-id';
import { button, field, linkButton, panel, row, success } from '../../ui/components';
import { discordTime, plainText, userText } from '../../ui/format';
import { COLORS, GLYPH } from '../../ui/theme';
import { missionFromArg, offsetFromArg } from './data';
import { presentInPlace } from './present';
import {
  dashboardMissionUrl,
  linkableUrl,
  missionHeadline,
  MISSIONS_NS,
  SUBMISSION_PREVIEW_MAX,
} from './render';
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

/**
 * The review queue a panel shows: every mission's, or one mission's (from its
 * detail). Carried in every control of the panel so paging and decisions
 * stay in the same queue.
 */
export interface ReviewScope {
  missionId: string | null;
}

const ALL_MISSIONS: ReviewScope = { missionId: null };

/** Trailing custom-id argument of a scoped queue; none for the whole queue. */
function scopeArgs(scope: ReviewScope): string[] {
  return scope.missionId ? [scope.missionId] : [];
}

/** Scope from a custom-id argument. Untrusted: a malformed mission id reads as not found. */
export function scopeFromArg(value: string | undefined): ReviewScope {
  return value === undefined ? ALL_MISSIONS : { missionId: missionFromArg(value) };
}

/** The review queue control of a mission detail: that mission's submissions only. */
export function missionReviewId(missionId: string): string {
  return customId(MISSIONS_NS, 'review', 0, missionId);
}

/**
 * A submission's evidence link and where a reviewer opens it: on its own
 * button, or — too long for a Discord button — from the dashboard (the
 * mission's review tab, when a public URL is configured).
 */
interface EvidenceLink {
  host: string;
  open: { kind: 'button'; url: string } | { kind: 'dashboard'; url: string | null };
}

function evidenceLink(
  item: missions.ReviewQueueItem,
  publicUrl: string | undefined,
): EvidenceLink | null {
  const url = safeEvidenceUrl(item.evidenceUrl);
  if (!url) return null;
  const direct = linkableUrl(url.toString());
  return {
    host: url.host,
    open: direct
      ? { kind: 'button', url: direct }
      : { kind: 'dashboard', url: dashboardMissionUrl(publicUrl, item.missionId, 'review') },
  };
}

function evidenceText(
  item: missions.ReviewQueueItem,
  evidence: EvidenceLink | null,
): string | null {
  if (!item.evidenceTitle && !evidence) return null;
  // The link itself sits on a button; the host says where it goes.
  const host = evidence ? `\`${plainText(evidence.host, HOST_MAX).replaceAll('`', '')}\`` : null;
  const text = [
    item.evidenceTitle ? userText(item.evidenceTitle, EVIDENCE_TITLE_SHOWN) : null,
    host,
  ]
    .filter(Boolean)
    .join(` ${GLYPH.dot} `);
  if (evidence?.open.kind !== 'dashboard') return text;
  const where = evidence.open.url
    ? 'open it from DASHBOARD'
    : 'open it from the mission review queue in the dashboard';
  return `${text}\nThe link is too long for a Discord button: ${where}.`;
}

function reviewEmbed(
  item: missions.ReviewQueueItem,
  evidence: EvidenceLink | null,
  position: number,
  total: number,
  scope: ReviewScope,
): APIEmbed {
  const fields = [
    field(item.teamKey ? 'Team' : 'Member', unitText(item)),
    field('Submitted', item.submittedAt ? discordTime(item.submittedAt, 'R') : GLYPH.unknown, true),
    field('Attempt', `${item.attempts} of ${missions.MAX_SUBMISSION_ATTEMPTS}`, true),
  ];
  const evidenceField = evidenceText(item, evidence);
  if (evidenceField) fields.push(field('Evidence', evidenceField));
  if (item.isOwn)
    fields.push(
      field('Not yours to review', 'You are part of this unit. Another reviewer decides it.'),
    );
  const queue = scope.missionId
    ? `REVIEW QUEUE ${GLYPH.dot} ${item.missionNumber}`
    : 'REVIEW QUEUE';
  return panel({
    kicker: `${queue} ${GLYPH.dot} ${position} OF ${total}`,
    title: missionHeadline(item.missionNumber, item.missionTitle),
    description: item.submission
      ? userText(item.submission, SUBMISSION_PREVIEW_MAX)
      : 'No text submitted.',
    color: item.isOwn ? COLORS.steel : COLORS.chrome,
    fields,
  });
}

function queuePage(h: HandlerContext, scope: ReviewScope, offset: number) {
  return missions.listSubmissionsForReview(h.ctx, {
    limit: 1,
    offset,
    missionId: scope.missionId ?? undefined,
  });
}

/**
 * One unit from the review queue, oldest first, with VERIFY / REJECT and
 * paging: the whole queue, or one mission's.
 */
export async function reviewPayload(
  h: HandlerContext,
  requestedOffset: number,
  options: { scope?: ReviewScope; notice?: APIEmbed } = {},
): Promise<ReplyPayload> {
  const { scope = ALL_MISSIONS, notice } = options;
  let page = await queuePage(h, scope, requestedOffset);
  // Past the end (the last entry was just decided): show the new last entry.
  if (page.items.length === 0 && page.total > 0) page = await queuePage(h, scope, page.total - 1);
  const [item] = page.items;
  // A mission's queue can always widen to every mission's.
  const widen = scope.missionId
    ? [button('Full queue', customId(MISSIONS_NS, 'review', 0), 'secondary')]
    : [];
  if (!item) {
    const clear = panel({
      kicker: 'REVIEW QUEUE',
      title: 'Queue clear',
      description: scope.missionId
        ? 'No submissions for this mission await review.'
        : 'No submissions await review.',
      color: COLORS.success,
    });
    return {
      embeds: notice ? [notice, clear] : [clear],
      components: widen.length > 0 ? [row(...widen)] : [],
      ephemeral: true,
    };
  }
  const offset = page.offset;
  const scoped = scopeArgs(scope);
  const actions: APIButtonComponent[] = [];
  if (!item.isOwn) {
    actions.push(
      button(
        'Verify',
        customId(MISSIONS_NS, 'verify', item.assignmentId, offset, ...scoped),
        'success',
      ),
      button(
        'Reject',
        customId(MISSIONS_NS, 'reject', item.assignmentId, offset, ...scoped),
        'danger',
      ),
    );
  }
  const evidence = evidenceLink(item, h.ctx.config.publicUrl);
  if (evidence?.open.kind === 'button')
    actions.push(linkButton('Open evidence', evidence.open.url));
  else if (evidence?.open.url) actions.push(linkButton('Dashboard', evidence.open.url));
  const navigation = [
    button(
      'Previous',
      customId(MISSIONS_NS, 'review', Math.max(0, offset - 1), ...scoped),
      'secondary',
      offset === 0,
    ),
    button(
      'Next',
      customId(MISSIONS_NS, 'review', offset + 1, ...scoped),
      'secondary',
      offset + 1 >= page.total,
    ),
    ...widen,
  ];
  const embed = reviewEmbed(item, evidence, offset + 1, page.total, scope);
  return {
    embeds: notice ? [notice, embed] : [embed],
    components: [row(...actions), row(...navigation)].filter((r) => r.components.length > 0),
    ephemeral: true,
  };
}

/** Queue page from a button (`review:<offset>[:<missionId>]`): re-rendered in place. */
export async function showReviewPage(h: HandlerContext, args: readonly string[]) {
  if (!can(h.ctx, 'canVerifyMissions')) return h.respond(restricted(REVIEWER_ONLY));
  const [rawOffset, rawMission] = args;
  const scope = scopeFromArg(rawMission);
  await presentInPlace(h, await reviewPayload(h, offsetFromArg(rawOffset), { scope }));
}

type Decision = 'verify' | 'reject';

export function reviewModal(
  decision: Decision,
  assignmentId: string,
  offset: number,
  scope: ReviewScope = ALL_MISSIONS,
): ModalPayload {
  const feedback = new TextInputBuilder()
    .setCustomId(FIELD_FEEDBACK)
    .setStyle(TextInputStyle.Paragraph)
    .setMinLength(missions.FEEDBACK_MIN)
    .setMaxLength(missions.FEEDBACK_MAX)
    .setRequired(decision === 'reject');
  return new ModalBuilder()
    .setCustomId(customId(MISSIONS_NS, decision, assignmentId, offset, ...scopeArgs(scope)))
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
  const [rawAssignment, rawOffset, rawMission] = args;
  const assignmentId = assignmentFrom(rawAssignment);
  const scope = scopeFromArg(rawMission);
  await h.interaction.showModal(
    reviewModal(decision, assignmentId, offsetFromArg(rawOffset), scope),
  );
}

/** Decide the unit, then show the queue again at the same position. */
export async function submitReview(
  h: HandlerContext,
  decision: Decision,
  args: readonly string[],
): Promise<void> {
  const [rawAssignment, rawOffset, rawMission] = args;
  const assignmentId = assignmentFrom(rawAssignment);
  const scope = scopeFromArg(rawMission);
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
  await presentInPlace(h, await reviewPayload(h, offsetFromArg(rawOffset), { scope, notice }));
}

/** `/mission review`: the queue from the start. */
export async function reviewFromCommand(h: HandlerContext): Promise<void> {
  if (!can(h.ctx, 'canVerifyMissions')) return h.respond(restricted(REVIEWER_ONLY));
  await h.respond(await reviewPayload(h, 0));
}
