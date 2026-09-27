import type { APIEmbedField } from 'discord.js';
import type { applications } from '@jave/core';
import type { MessagePayload } from '../../discord/gateway';
import { button, field, linkButton, panel, row } from '../../ui/components';
import { dashboardLink } from './dashboard-link';
import { discordTime, userText } from '../../ui/format';
import { GLYPH } from '../../ui/theme';
import { applicationsId, cardActionId, STAFF_ACTIONS } from './ids';
import { STAFF_ACTION_LABELS, STAFF_ACTION_STYLES, STATUS_COLORS, STATUS_LABELS } from './labels';

type ReviewCard = applications.ReviewCard;
type PersonRef = applications.PersonRef;

/** Card excerpts are already capped by core; this is the embed-side ceiling. */
const EXCERPT_FIELD_CHARS = 400;
const NAME_CHARS = 80;

export function personLine(person: PersonRef | null): string {
  if (!person) return GLYPH.unknown;
  const name = userText(person.displayName, NAME_CHARS);
  return person.handle ? `${name} ${GLYPH.dot} @${userText(person.handle, NAME_CHARS)}` : name;
}

export function tallyLine(tally: applications.ReviewTally): string {
  const parts = [
    `${tally.counted} counted`,
    `${tally.accept} accept`,
    `${tally.reject} reject`,
    `${tally.interview} interview`,
    `${tally.abstain} abstain`,
  ];
  if (tally.averageScore !== null) parts.push(`avg ${tally.averageScore.toFixed(1)} / 5`);
  return parts.join(` ${GLYPH.dot} `);
}

export function dashboardApplicationPath(applicationId: string): string {
  return `/applications/${applicationId}`;
}

/**
 * The staff review card (Discord job contract `discord.applications.review_card`).
 * Applicant answers are untrusted text: excerpts go through userText, links
 * stay plain text, and nothing mentions anyone. No references and no
 * decision reason — the card lives in a channel, not behind a capability.
 */
export function renderReviewCard(card: ReviewCard, publicUrl: string | undefined): MessagePayload {
  const fields: APIEmbedField[] = [
    field('Applicant', personLine(card.applicant), true),
    field('Domain', card.domain ? card.domain.label.toUpperCase() : GLYPH.unknown, true),
    field('Submitted', card.submittedAt ? discordTime(card.submittedAt, 'f') : GLYPH.unknown, true),
    field(
      'Reviewer',
      card.assignedReviewer ? personLine(card.assignedReviewer) : 'Unclaimed',
      true,
    ),
  ];
  if (card.interviewAt) fields.push(field('Interview', discordTime(card.interviewAt, 'F'), true));
  if (card.decidedAt) fields.push(field('Decided', discordTime(card.decidedAt, 'f'), true));
  fields.push(
    field(
      'Reviews',
      `${tallyLine(card.tally)}\n${card.decisionReady ? 'Enough counted reviews for a decision.' : 'More counted reviews needed before a decision.'}`,
    ),
    field('Why JAVELIN', userText(card.motivationExcerpt, EXCERPT_FIELD_CHARS) || GLYPH.unknown),
    field('Projects', userText(card.projectsExcerpt, EXCERPT_FIELD_CHARS) || GLYPH.unknown),
    field('Portfolio', userText(card.portfolioUrl) || GLYPH.unknown, true),
    field(
      'Evidence',
      `${card.evidenceLinkCount} link${card.evidenceLinkCount === 1 ? '' : 's'}`,
      true,
    ),
    field('Referred', card.referred ? 'Yes' : 'No', true),
  );

  const components: NonNullable<MessagePayload['components']> = [];
  if (card.actions.length > 0) {
    components.push(
      row(
        ...card.actions.map((action) =>
          button(
            STAFF_ACTION_LABELS[action],
            cardActionId(action, card.applicationId),
            STAFF_ACTION_STYLES[action],
          ),
        ),
      ),
    );
  }
  const url = dashboardLink(publicUrl, dashboardApplicationPath(card.applicationId));
  components.push(
    row(
      button('View details', applicationsId(STAFF_ACTIONS.details, card.applicationId)),
      ...(url ? [linkButton('Open in dashboard', url)] : []),
    ),
  );

  return {
    embeds: [
      panel({
        kicker: 'APPLICATION REVIEW',
        title: `${card.number} — ${STATUS_LABELS[card.status]}`,
        color: STATUS_COLORS[card.status],
        fields,
        footer: `JAVELIN ${GLYPH.dot} JAVE ${GLYPH.dot} revision ${card.revision}`,
      }),
    ],
    components,
  };
}
