import type { APIEmbed } from 'discord.js';
import type { trials } from '@jave/core';
import type { MessagePayload } from '../../../discord/gateway';
import { button, field, panel, row } from '../../../ui/components';
import { discordTime, userText } from '../../../ui/format';
import { COLORS, GLYPH } from '../../../ui/theme';
import { MEMBER_ACTIONS, trialsId } from '../ids';
import { STATUS_COLOR } from './labels';
import { packEmbeds, safeChunks } from './text';

type AnnouncementCard = trials.AnnouncementCard;
type BriefPost = Extract<trials.BriefSpec, { action: 'post' }>;
type WarningPost = Extract<trials.WarningSpec, { action: 'post' }>;

const TITLE_MAX = 200;
const SUMMARY_MAX = 1500;
const FACT_MAX = 200;
const RUBRIC_DESCRIPTION_MAX = 900;

/**
 * The public recruitment card (announcements channel). The APPLY button
 * opens the statement modal; once recruitment closes it stays, disabled,
 * labelled with the trial's state. VIEW opens the member view privately.
 */
export function announcementMessage(trialId: string, card: AnnouncementCard): MessagePayload {
  const embed = panel({
    kicker: card.kicker,
    title: userText(card.heading, TITLE_MAX),
    description: userText(card.summary, SUMMARY_MAX),
    color: STATUS_COLOR[card.status],
    fields: card.facts.map((fact) => field(fact.label, userText(fact.value, FACT_MAX), true)),
    footer: 'JAVELIN · TRIALS · Outcomes, not effort. AI tools allowed.',
  });
  return {
    embeds: [embed],
    components: [
      row(
        button(
          card.acceptingApplications ? 'Apply' : card.buttonLabel,
          trialsId(MEMBER_ACTIONS.apply, trialId),
          'primary',
          !card.acceptingApplications,
        ),
        button('View', trialsId(MEMBER_ACTIONS.view, trialId)),
      ),
    ],
  };
}

/** Deadline in the reader's time zone plus a live countdown. */
export function deadlineLine(date: Date): string {
  return `${discordTime(date, 'F')} ${GLYPH.dot} ${discordTime(date, 'R')}`;
}

function rubricEmbed(rubric: BriefPost['rubric']): APIEmbed {
  return panel({
    kicker: 'RUBRIC',
    title: 'What is measured',
    description: 'Every criterion is scored 0–10. Weights set its share of the result.',
    color: COLORS.base,
    fields: rubric.map((criterion) =>
      field(
        `${criterion.label} ${GLYPH.dot} ${criterion.weightPercent}%`,
        userText(criterion.description, RUBRIC_DESCRIPTION_MAX) || GLYPH.unknown,
      ),
    ),
  });
}

/**
 * The mission brief for one team channel: header (team, deadline, grace),
 * the brief itself — never clipped, split across embeds and messages as
 * needed — and the rubric. SUBMIT and STATUS sit under the last message.
 */
export function briefMessages(spec: BriefPost): MessagePayload[] {
  const members = spec.memberDiscordIds
    .map((id) => (id === spec.leadDiscordId ? `<@${id}> (lead)` : `<@${id}>`))
    .join(' ');
  const header = panel({
    kicker: `TRIAL BRIEF ${GLYPH.dot} ${spec.category.toUpperCase()}`,
    title: userText(spec.heading, TITLE_MAX),
    description: [
      'The clock is running. Outcomes count, effort does not. AI tools are allowed.',
      'Any member of the team can submit; a resubmission becomes the new version.',
    ].join('\n'),
    color: COLORS.chrome,
    fields: [
      field('Team', `${userText(spec.teamName, FACT_MAX)}\n${members || GLYPH.unknown}`),
      field('Deadline', deadlineLine(spec.deadlineAt)),
      field(
        'Late window',
        spec.graceMinutes > 0
          ? `Until ${discordTime(spec.closesAt, 't')} — accepted and flagged late.`
          : 'None. Nothing is accepted after the deadline.',
      ),
    ],
  });
  const chunks = safeChunks(spec.brief);
  const briefEmbeds = chunks.map((chunk, index) =>
    panel({
      kicker: chunks.length > 1 ? `BRIEF ${index + 1}/${chunks.length}` : 'BRIEF',
      title: index === 0 ? 'Mission' : 'Mission (continued)',
      description: chunk,
      color: COLORS.chrome,
    }),
  );
  const messages = packEmbeds([header, ...briefEmbeds, rubricEmbed(spec.rubric)]);
  return messages.map((embeds, index) => ({
    embeds,
    components:
      index === messages.length - 1
        ? [
            row(
              button('Submit', trialsId(MEMBER_ACTIONS.submit, spec.trialId), 'primary'),
              button('Status', trialsId(MEMBER_ACTIONS.view, spec.trialId)),
            ),
          ]
        : undefined,
  }));
}

export function warningMessage(trialId: string, spec: WarningPost): MessagePayload {
  return {
    embeds: [
      panel({
        kicker: 'TRIAL CLOCK',
        title: 'Time check',
        description: userText(spec.message, SUMMARY_MAX),
        color: COLORS.warning,
        fields: [field('Deadline', deadlineLine(spec.deadlineAt))],
      }),
    ],
    components: [row(button('Submit', trialsId(MEMBER_ACTIONS.submit, trialId), 'primary'))],
  };
}

export function closingMessage(text: string, finalStatus: 'completed' | 'cancelled') {
  return {
    embeds: [
      panel({
        kicker: 'TRIAL RECORD',
        title: finalStatus === 'completed' ? 'Channel archived' : 'Trial cancelled',
        description: userText(text, SUMMARY_MAX),
        color: finalStatus === 'completed' ? COLORS.steel : COLORS.danger,
      }),
    ],
  };
}
