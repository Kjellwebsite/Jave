import type { APIEmbedField } from 'discord.js';
import type { applications } from '@jave/core';
import type { ReplyPayload } from '../../interactions/types';
import { button, field, linkButton, panel, row } from '../../ui/components';
import { dashboardLink } from './dashboard-link';
import { clip, discordTime, userText } from '../../ui/format';
import { COLORS, GLYPH } from '../../ui/theme';
import { fitEmbeds } from './embed-budget';
import { applicationsId, cardActionId, type Decision, STAFF_ACTIONS } from './ids';
import {
  RECOMMENDATION_LABELS,
  STAFF_ACTION_LABELS,
  STAFF_ACTION_STYLES,
  STATUS_COLORS,
  STATUS_LABELS,
} from './labels';
import { dashboardApplicationPath, personLine, tallyLine } from './review-card';

type StaffView = applications.StaffApplicationView;
type ReviewCard = applications.ReviewCard;
type StaffAction = applications.StaffAction;

const ANSWER_CHARS = 700;
const LINKS_CHARS = 700;
const REFERENCES_CHARS = 500;
const REVIEW_NOTE_CHARS = 140;
const REVIEWS_CHARS = 900;
const HISTORY_ENTRIES = 8;
const DECISION_CHARS = 400;

function answer(text: string | null): string {
  return text ? userText(text, ANSWER_CHARS) : GLYPH.unknown;
}

function reviewLines(view: StaffView): string {
  if (view.reviews.length === 0) return 'No reviews yet.';
  return view.reviews
    .map((review) => {
      const score = review.score === null ? '' : ` ${GLYPH.dot} ${review.score}/5`;
      const note = review.note ? ` — ${userText(review.note, REVIEW_NOTE_CHARS)}` : '';
      return `**${RECOMMENDATION_LABELS[review.recommendation]}**${score} ${GLYPH.dot} ${personLine(review.reviewer)}${note}`;
    })
    .join('\n');
}

function historyLines(view: StaffView): string {
  return view.history
    .slice(-HISTORY_ENTRIES)
    .map(
      (change) =>
        `${discordTime(change.at, 'f')} ${GLYPH.bar} ${change.from ? `${STATUS_LABELS[change.from]} ${GLYPH.arrow} ` : ''}${STATUS_LABELS[change.to]}${change.actor ? ` ${GLYPH.dot} ${userText(change.actor.displayName, 40)}` : ''}`,
    )
    .join('\n');
}

function actionRows(applicationId: string, actions: readonly StaffAction[]) {
  if (actions.length === 0) return [];
  return [
    row(
      ...actions.map((action) =>
        button(
          STAFF_ACTION_LABELS[action],
          cardActionId(action, applicationId),
          STAFF_ACTION_STYLES[action],
        ),
      ),
    ),
  ];
}

/**
 * The full staff view, privately. Holds references and the internal
 * decision reason, so it is only ever an ephemeral reply to a holder of
 * canViewApplications (core authorizes and audits the read). `actions` are
 * the controls this viewer can use now: the card's actions for the state,
 * narrowed to the viewer's capabilities, so no button shown always fails.
 */
export function renderStaffDetails(
  view: StaffView,
  actions: readonly StaffAction[],
  publicUrl: string | undefined,
): ReplyPayload {
  const overview: APIEmbedField[] = [
    field('Applicant', personLine(view.applicant), true),
    field('Domain', view.domainKey ? view.domainKey.toUpperCase() : GLYPH.unknown, true),
    field('Submitted', view.submittedAt ? discordTime(view.submittedAt, 'f') : GLYPH.unknown, true),
    field(
      'Reviewer',
      view.assignedReviewer ? personLine(view.assignedReviewer) : 'Unclaimed',
      true,
    ),
  ];
  if (view.interviewAt) overview.push(field('Interview', discordTime(view.interviewAt, 'F'), true));
  if (view.referral)
    overview.push(
      field(
        'Referral',
        `${userText(view.referral.code)}${view.referral.owner ? ` ${GLYPH.dot} ${personLine(view.referral.owner)}` : ''}`,
        true,
      ),
    );
  overview.push(
    field('Why JAVELIN', answer(view.motivation)),
    field('Experience', answer(view.experience)),
    field('Projects', answer(view.projects)),
  );

  const staff: APIEmbedField[] = [
    field('Portfolio', view.portfolioUrl ? userText(view.portfolioUrl) : GLYPH.unknown),
    field(
      `Evidence links (${view.evidenceLinks.length})`,
      view.evidenceLinks.length
        ? userText(
            view.evidenceLinks.map((link) => `${GLYPH.bullet} ${link}`).join('\n'),
            LINKS_CHARS,
          )
        : GLYPH.unknown,
    ),
    field(
      'References',
      view.references ? userText(view.references, REFERENCES_CHARS) : GLYPH.unknown,
    ),
    field(`Reviews — ${tallyLine(view.tally)}`, clip(reviewLines(view), REVIEWS_CHARS)),
  ];
  if (view.decidedAt) {
    staff.push(
      field(
        'Decision',
        [
          `${discordTime(view.decidedAt, 'f')}${view.decidedBy ? ` ${GLYPH.dot} ${personLine(view.decidedBy)}` : ''}`,
          view.decisionReason ? `Reason: ${userText(view.decisionReason, DECISION_CHARS)}` : '',
          view.applicantMessage
            ? `To applicant: ${userText(view.applicantMessage, DECISION_CHARS)}`
            : '',
        ]
          .filter(Boolean)
          .join('\n'),
      ),
    );
  }
  staff.push(field('History', historyLines(view) || GLYPH.unknown));

  const url = dashboardLink(publicUrl, dashboardApplicationPath(view.id));
  return {
    embeds: fitEmbeds([
      panel({
        kicker: 'APPLICATION — STAFF VIEW',
        title: `${view.number} — ${STATUS_LABELS[view.status]}`,
        color: STATUS_COLORS[view.status],
        fields: overview,
      }),
      panel({
        title: 'STAFF ONLY — EVIDENCE, REVIEWS, HISTORY',
        color: COLORS.graphite,
        fields: staff,
        footer: 'Private to you. This read is recorded in the audit log.',
      }),
    ]),
    components: [
      ...actionRows(view.id, actions),
      ...(url ? [row(linkButton('Open in dashboard', url))] : []),
    ],
    ephemeral: true,
  };
}

/** Step one of a decision: the consequence, stated before any reason is typed. */
export function renderDecisionConfirm(
  decision: Decision,
  card: ReviewCard,
  consequence: string,
): ReplyPayload {
  const accept = decision === 'accept';
  return {
    embeds: [
      panel({
        kicker: 'APPLICATION DECISION',
        title: `${accept ? 'ACCEPT' : 'REJECT'} ${card.number}?`,
        description: `${consequence}\nNext: an internal reason (staff only) and an optional message to the applicant.`,
        color: accept ? COLORS.success : COLORS.danger,
        fields: [
          field('Applicant', personLine(card.applicant), true),
          field('Status', STATUS_LABELS[card.status], true),
          field('Reviews', tallyLine(card.tally)),
        ],
      }),
    ],
    components: [
      row(
        button(
          accept ? 'Continue to accept' : 'Continue to reject',
          applicationsId(STAFF_ACTIONS.decide, decision, card.applicationId),
          accept ? 'success' : 'danger',
        ),
      ),
    ],
    ephemeral: true,
  };
}
