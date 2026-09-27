import {
  applications,
  authorize,
  type Capability,
  getMyPreferences,
  getSettings,
  InvalidStateError,
  ValidationError,
} from '@jave/core';
import type { HandlerContext } from '../../interactions/types';
import { success } from '../../ui/components';
import { discordTime } from '../../ui/format';
import { type Decision, parseDecision } from './ids';
import { RECOMMENDATION_LABELS, STATUS_LABELS } from './labels';
import {
  DECISION_FIELDS,
  decisionModal,
  INTERVIEW_FIELDS,
  interviewModal,
  REVIEW_FIELDS,
  reviewModal,
} from './staff-modals';
import { renderDecisionConfirm, renderStaffDetails } from './staff-views';
import {
  formatWallTime,
  parseScheduleTime,
  safeTimeZone,
  SCHEDULE_TIME_EXAMPLES,
} from './schedule-time';

type StaffAction = applications.StaffAction;
type ReviewCard = applications.ReviewCard;

/**
 * UI gate before a modal opens, so nobody fills in a form that can only be
 * refused. The services re-check everything when the form is submitted.
 */
const ACTION_CAPABILITY: Readonly<Record<StaffAction, Capability>> = {
  start_review: 'canReviewApplications',
  review: 'canReviewApplications',
  schedule_interview: 'canDecideApplications',
  accept: 'canDecideApplications',
  reject: 'canDecideApplications',
};

const STAFF_ACTION_NAMES = Object.keys(ACTION_CAPABILITY) as StaffAction[];
const RECOMMENDATIONS = Object.keys(
  RECOMMENDATION_LABELS,
) as applications.ApplicationRecommendation[];

export function isStaffAction(action: string): action is StaffAction {
  return (STAFF_ACTION_NAMES as readonly string[]).includes(action);
}

/**
 * Loads the card as the clicking user (canViewApplications, never their own
 * application — both audited on refusal), checks the action's capability and
 * that the current state still offers it. Stale cards fail here, calmly.
 */
async function prepare(
  h: HandlerContext,
  action: StaffAction,
  applicationId: string | undefined,
): Promise<ReviewCard> {
  const card = await applications.getReviewCard(h.ctx, { applicationId: applicationId ?? '' });
  await authorize(h.ctx, ACTION_CAPABILITY[action], {
    type: 'application',
    id: card.applicationId,
  });
  if (!applications.staffActionsFor(card.status).includes(action)) {
    throw new InvalidStateError(
      `${card.number} is ${STATUS_LABELS[card.status]}. That action is no longer available.`,
    );
  }
  if (!card.actions.includes(action)) {
    throw new InvalidStateError(
      `${card.number} needs more counted reviews before a decision (${card.tally.counted} so far).`,
    );
  }
  return card;
}

async function staffTimeZone(h: HandlerContext): Promise<string> {
  const preferences = await getMyPreferences(h.ctx);
  return safeTimeZone(preferences.timezone);
}

async function decisionConsequence(h: HandlerContext, decision: Decision): Promise<string> {
  const settings = await getSettings(h.ctx, 'applications');
  if (decision === 'accept') {
    return `Grants ${settings.acceptedRole.toUpperCase()} (never a demotion) and notifies the applicant.`;
  }
  return `Returns APPLICANT to MEMBER, notifies the applicant and blocks a new submission for ${settings.cooldownDaysAfterRejection} days.`;
}

/** A card button (`applications:<StaffAction>:<applicationId>`). */
export async function handleCardAction(
  h: HandlerContext,
  action: StaffAction,
  applicationId: string | undefined,
): Promise<void> {
  const card = await prepare(h, action, applicationId);
  switch (action) {
    case 'start_review': {
      await applications.startReview(h.ctx, { applicationId: card.applicationId });
      await h.respond({
        embeds: [
          success(`CLAIMED — ${card.number}`, 'Assigned to you for review. The card updates.'),
        ],
        ephemeral: true,
      });
      return;
    }
    case 'review':
      await h.interaction.showModal(reviewModal(card.applicationId, card.number));
      return;
    case 'schedule_interview': {
      const timeZone = await staffTimeZone(h);
      await h.interaction.showModal(
        interviewModal(card.applicationId, card.number, {
          timeZone,
          current: card.interviewAt ? formatWallTime(card.interviewAt, timeZone) : null,
        }),
      );
      return;
    }
    case 'accept':
    case 'reject':
      await h.respond(renderDecisionConfirm(action, card, await decisionConsequence(h, action)));
      return;
  }
}

/** Step two of a decision: the confirmed button opens the reason form. */
export async function openDecisionForm(
  h: HandlerContext,
  decisionArg: string | undefined,
  applicationId: string | undefined,
): Promise<void> {
  const decision = parseDecision(decisionArg);
  if (!decision) throw new ValidationError('Unknown decision.');
  const card = await prepare(h, decision, applicationId);
  await h.interaction.showModal(decisionModal(decision, card.applicationId, card.number));
}

/** VIEW DETAILS: the full staff view, privately. */
export async function showDetails(
  h: HandlerContext,
  applicationId: string | undefined,
): Promise<void> {
  const view = await applications.getApplication(h.ctx, { applicationId: applicationId ?? '' });
  const card = await applications.getReviewCard(h.ctx, { applicationId: view.id });
  await h.respond(renderStaffDetails(view, card, h.ctx.config.publicUrl));
}

export async function submitReview(
  h: HandlerContext,
  applicationId: string | undefined,
): Promise<void> {
  const { modal } = h.interaction;
  const [chosen] = modal.select(REVIEW_FIELDS.recommendation);
  const recommendation = RECOMMENDATIONS.find((value) => value === chosen);
  if (!recommendation) throw new ValidationError('Choose a recommendation.');
  const [score] = modal.select(REVIEW_FIELDS.score);
  const result = await applications.reviewApplication(h.ctx, {
    applicationId: applicationId ?? '',
    recommendation,
    score,
    note: modal.text(REVIEW_FIELDS.note),
  });
  const scored = result.score === null ? '' : ` · ${result.score}/5`;
  await h.respond({
    embeds: [
      success(
        result.updated ? 'REVIEW UPDATED' : 'REVIEW RECORDED',
        `${RECOMMENDATION_LABELS[result.recommendation]}${scored}. ${result.updated ? 'Your earlier review was replaced.' : 'The card updates.'}`,
      ),
    ],
    ephemeral: true,
  });
}

export async function submitInterview(
  h: HandlerContext,
  applicationId: string | undefined,
): Promise<void> {
  const { modal } = h.interaction;
  const timeZone = await staffTimeZone(h);
  const interviewAt = parseScheduleTime(
    modal.text(INTERVIEW_FIELDS.time),
    h.ctx.clock.now(),
    timeZone,
  );
  if (!interviewAt) {
    throw new ValidationError(`Could not read that time. Try: ${SCHEDULE_TIME_EXAMPLES}.`, [
      { path: 'interviewAt', message: 'unrecognised time' },
    ]);
  }
  const summary = await applications.scheduleInterview(h.ctx, {
    applicationId: applicationId ?? '',
    interviewAt,
    applicantMessage: modal.text(INTERVIEW_FIELDS.message),
  });
  await h.respond({
    embeds: [
      success(
        `INTERVIEW SET — ${summary.number}`,
        `${discordTime(interviewAt, 'F')} (${discordTime(interviewAt)}). The applicant is notified and reminded one hour before.`,
      ),
    ],
    ephemeral: true,
  });
}

export async function submitDecision(
  h: HandlerContext,
  decisionArg: string | undefined,
  applicationId: string | undefined,
): Promise<void> {
  const decision = parseDecision(decisionArg);
  if (!decision) throw new ValidationError('Unknown decision.');
  const { modal } = h.interaction;
  const result = await applications.decideApplication(h.ctx, {
    applicationId: applicationId ?? '',
    decision,
    reason: modal.text(DECISION_FIELDS.reason),
    applicantMessage: modal.text(DECISION_FIELDS.message),
  });
  const detail =
    decision === 'accept'
      ? result.grantedRole
        ? `${result.grantedRole.toUpperCase()} granted. The applicant is notified.`
        : 'They already held that role or higher. The applicant is notified.'
      : 'The applicant is notified. The reason stays internal.';
  await h.respond({
    embeds: [
      success(
        `${decision === 'accept' ? 'APPLICATION ACCEPTED' : 'APPLICATION NOT ACCEPTED'} — ${result.number}`,
        detail,
      ),
    ],
    ephemeral: true,
  });
}
