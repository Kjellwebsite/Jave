import { LabelBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { missions, ValidationError } from '@jave/core';
import type { HandlerContext, ModalPayload } from '../../interactions/types';
import { customId } from '../../interactions/custom-id';
import { button, failure, panel, row, stringSelect, success } from '../../ui/components';
import { discordTime, plainText } from '../../ui/format';
import { COLORS, LIMITS } from '../../ui/theme';
import { ownAssignment } from './data';
import { MISSIONS_NS, missionHeadline, TYPE_LABEL } from './render';
import { detailPayload } from './views';

/** Field ids inside the submission modal. */
export const FIELD_SUBMISSION = 'submission';
export const FIELD_EVIDENCE_TITLE = 'evidence_title';
export const FIELD_EVIDENCE_URL = 'evidence_url';
/** Discord text inputs hold at most 4000 characters. */
const TEXT_INPUT_MAX = 4000;
const LABEL_DESCRIPTION_MAX = 100;

// ── Accept ──────────────────────────────────────────────────────────────────

/**
 * ACCEPT (the public card, lists and detail views). A staff assignment
 * waiting for the member is accepted; otherwise the member takes the
 * mission. Core re-checks everything as the clicking user.
 */
export async function acceptMission(h: HandlerContext, missionId: string): Promise<void> {
  const detail = await missions.getMissionDetail(h.ctx, { missionId });
  const own = detail.myAssignment;
  const assignment =
    own?.status === 'assigned'
      ? await missions.acceptMission(h.ctx, { assignmentId: own.id })
      : await missions.selfAssignMission(h.ctx, { missionId });
  const due = assignment.dueAt ? ` Due ${discordTime(assignment.dueAt, 'f')}.` : '';
  const notice = success(
    'Mission accepted',
    `${missionHeadline(detail.mission.number, detail.mission.title)}.${due}\nSubmit your work with SUBMIT or \`/mission submit\`.`,
  );
  await h.respond(await detailPayload(h, missionId, notice));
}

// ── Submit ──────────────────────────────────────────────────────────────────

export function submissionModal(
  detail: missions.MissionDetail,
  own: missions.OwnAssignmentView,
): ModalPayload {
  const { mission } = detail;
  const evidenceHint = mission.evidenceRequired
    ? 'Required for this mission, with its link.'
    : 'Optional. A repository, document, video or result.';
  const submissionHint = own.teamKey
    ? `Team ${own.teamKey}: this counts for every teammate still working.`
    : 'What you did, what it shows, what you learned.';
  return new ModalBuilder()
    .setCustomId(customId(MISSIONS_NS, 'submit', mission.id))
    .setTitle(plainText(`SUBMIT ${mission.number} — ${mission.title.toUpperCase()}`, LIMITS.modalTitle))
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Submission')
        .setDescription(plainText(submissionHint, LABEL_DESCRIPTION_MAX))
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(FIELD_SUBMISSION)
            .setStyle(TextInputStyle.Paragraph)
            .setMinLength(missions.SUBMISSION_MIN)
            .setMaxLength(Math.min(missions.SUBMISSION_MAX, TEXT_INPUT_MAX))
            .setRequired(true)
            .setValue(own.status === 'rejected' && own.submission ? own.submission.slice(0, TEXT_INPUT_MAX) : ''),
        ),
      new LabelBuilder()
        .setLabel('Evidence title')
        .setDescription(evidenceHint)
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(FIELD_EVIDENCE_TITLE)
            .setStyle(TextInputStyle.Short)
            .setMaxLength(missions.EVIDENCE_TITLE_MAX)
            .setRequired(mission.evidenceRequired),
        ),
      new LabelBuilder()
        .setLabel('Evidence link')
        .setDescription('http(s) only.')
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(FIELD_EVIDENCE_URL)
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('https://')
            .setMaxLength(TEXT_INPUT_MAX)
            .setRequired(mission.evidenceRequired),
        ),
    )
    .toJSON();
}

function canSubmit(own: missions.OwnAssignmentView): boolean {
  return (
    own.status !== 'assigned' &&
    missions.canTransitionAssignment(own.status, 'submitted') &&
    own.attempts < missions.MAX_SUBMISSION_ATTEMPTS
  );
}

/** SUBMIT: open the submission modal for the viewer's own assignment. */
export async function openSubmission(h: HandlerContext, missionId: string): Promise<void> {
  const { detail, own } = await ownAssignment(h, missionId);
  if (!canSubmit(own)) {
    const reason =
      own.status === 'assigned'
        ? 'Accept the mission first.'
        : own.status === 'submitted'
          ? 'Your submission is awaiting review.'
          : own.status === 'rejected'
            ? 'No submission attempts left.'
            : 'This assignment is closed.';
    await h.respond({ embeds: [failure('Nothing to submit', reason)], ephemeral: true });
    return;
  }
  await h.interaction.showModal(submissionModal(detail, own));
}

/** Evidence is a title and an http(s) link together, or nothing. */
export function evidenceFrom(title: string, url: string): { title: string; url: string } | undefined {
  const t = title.trim();
  const u = url.trim();
  if (!t && !u) return undefined;
  if (!t || !u) throw new ValidationError('evidence: give both a title and a link');
  return { title: t, url: u };
}

export async function submitFromModal(h: HandlerContext, missionId: string): Promise<void> {
  const { modal } = h.interaction;
  const evidence = evidenceFrom(modal.text(FIELD_EVIDENCE_TITLE), modal.text(FIELD_EVIDENCE_URL));
  const { detail, own } = await ownAssignment(h, missionId);
  const submitted = await missions.submitMission(h.ctx, {
    assignmentId: own.id,
    submission: modal.text(FIELD_SUBMISSION),
    evidence,
  });
  const team = submitted.teamKey ? ' Your team moves to review with you.' : '';
  const notice = success(
    'Submission sent',
    `${missionHeadline(detail.mission.number, detail.mission.title)}. Attempt ${submitted.attempts} of ${missions.MAX_SUBMISSION_ATTEMPTS}.${team}\nA reviewer verifies it; the result arrives as a notification.`,
  );
  await h.respond(await detailPayload(h, missionId, notice));
}

/** /mission submit without a mission: pick one of the assignments that can take a submission. */
export async function chooseSubmission(h: HandlerContext): Promise<void> {
  const items = (await missions.listMyMissions(h.ctx, { scope: 'active' })).filter((item) =>
    canSubmit(item.assignment),
  );
  const [only] = items;
  if (!only) {
    await h.respond({
      embeds: [panel({ title: 'NOTHING TO SUBMIT', description: 'No accepted mission is waiting for your work. `/mission mine` shows where things stand.' })],
      ephemeral: true,
    });
    return;
  }
  if (items.length === 1) {
    await h.interaction.showModal(submissionModal(await missions.getMissionDetail(h.ctx, { missionId: only.mission.id }), only.assignment));
    return;
  }
  await h.respond({
    embeds: [panel({ kicker: 'JVLN MISSIONS', title: 'Submit work', description: 'Choose the mission this submission is for.' })],
    components: [
      row(
        stringSelect(
          customId(MISSIONS_NS, 'submit_pick'),
          'Choose a mission',
          items.slice(0, LIMITS.selectOptions).map(({ mission }) => ({
            label: plainText(`${mission.number} · ${mission.title}`, 100),
            description: TYPE_LABEL[mission.type],
            value: mission.id,
          })),
        ),
      ),
    ],
    ephemeral: true,
  });
}

// ── Abandon ─────────────────────────────────────────────────────────────────

/** ABANDON asks first: only staff can restart an abandoned assignment. */
export async function confirmAbandon(h: HandlerContext, missionId: string): Promise<void> {
  const { detail } = await ownAssignment(h, missionId);
  await h.respond({
    embeds: [
      panel({
        kicker: 'CONFIRM',
        title: 'Abandon mission',
        description: `${missionHeadline(detail.mission.number, detail.mission.title)}.\nYou cannot take it again yourself; only staff can reassign you.`,
        color: COLORS.warning,
      }),
    ],
    components: [
      row(
        button('Abandon mission', customId(MISSIONS_NS, 'abandon_confirm', missionId), 'danger'),
        button('Keep it', customId(MISSIONS_NS, 'dismiss')),
      ),
    ],
    ephemeral: true,
  });
}

export async function abandon(h: HandlerContext, missionId: string): Promise<void> {
  const { detail, own } = await ownAssignment(h, missionId);
  await missions.abandonMission(h.ctx, { assignmentId: own.id });
  await h.interaction.update({
    embeds: [
      success('Mission abandoned', `${missionHeadline(detail.mission.number, detail.mission.title)}. Staff can reassign you if needed.`),
    ],
    components: [],
  });
}
