import type { APIEmbed, APIEmbedField } from 'discord.js';
import type { trials } from '@jave/core';
import type { ReplyPayload } from '../../../interactions/types';
import { button, field, panel, row } from '../../../ui/components';
import { clip, discordTime, userText } from '../../../ui/format';
import { COLORS, GLYPH, LIMITS } from '../../../ui/theme';
import { MEMBER_ACTIONS, REFERENCE, trialsId } from '../ids';
import { deadlineLine } from './cards';
import {
  categoryLabel,
  formatScore,
  OUTCOME_COLOR,
  OUTCOME_LABEL,
  PARTICIPANT_LABEL,
  STATUS_COLOR,
  STATUS_LABEL,
} from './labels';
import { packEmbeds, safeChunks } from './text';

type Summary = trials.TrialSummaryView;
type ParticipantView = trials.ParticipantTrialView;
type HistoryEntry = trials.TrialHistoryEntry;

const TITLE_MAX = 120;
const SUMMARY_MAX = 600;
const NAME_MAX = 64;
const SUBMISSION_SUMMARY_MAX = 400;
const LINKS_SHOWN = 5;
/** Discord allows 5 buttons per row. */
const BUTTONS_PER_ROW = 5;

export function trialTitle(summary: Pick<Summary, 'ref' | 'title'>): string {
  return `${summary.ref} — ${userText(summary.title, TITLE_MAX)}`;
}

/** One line of facts: state, category, team size, duration. */
export function factsLine(summary: Summary): string {
  const hours = summary.durationMinutes / 60;
  const duration = Number.isInteger(hours) ? `${hours}h` : `${summary.durationMinutes}m`;
  return [
    STATUS_LABEL[summary.status],
    categoryLabel(summary.category),
    `teams of ${summary.teamSize}`,
    duration,
  ].join(` ${GLYPH.dot} `);
}

/** The time that matters now: recruitment close, scheduled start, deadline or the late window. */
export function clockLine(summary: Summary): string | null {
  const { timing } = summary;
  if (summary.status === 'recruiting')
    return summary.recruitmentClosesAt
      ? `Recruitment closes ${discordTime(summary.recruitmentClosesAt, 'R')}`
      : 'Recruitment open until staff close it';
  if (summary.status === 'teams_assigned')
    return summary.scheduledStartAt
      ? `Starts ${discordTime(summary.scheduledStartAt, 'R')}`
      : 'Teams set — starts when staff give the signal';
  if (timing.phase === 'open' && timing.deadlineAt)
    return `Deadline ${deadlineLine(timing.deadlineAt)}`;
  if (timing.phase === 'grace' && timing.closesAt)
    return `Deadline passed — late window closes ${discordTime(timing.closesAt, 'R')}`;
  return null;
}

/** Rows of up to five buttons (Discord's per-row cap). */
export function buttonRows(
  buttons: ReturnType<typeof button>[],
): NonNullable<ReplyPayload['components']> {
  const rows: NonNullable<ReplyPayload['components']> = [];
  for (let index = 0; index < buttons.length; index += BUTTONS_PER_ROW)
    rows.push(row(...buttons.slice(index, index + BUTTONS_PER_ROW)));
  return rows;
}

function participationFields(view: ParticipantView): APIEmbedField[] {
  const participation = view.participation;
  if (!participation) return [];
  const fields = [field('Your status', PARTICIPANT_LABEL[participation.status], true)];
  const team = participation.team;
  if (team) {
    const roster = team.members
      .map(
        (member) =>
          `${userText(member.displayName, NAME_MAX)}${member.role === 'lead' ? ' (lead)' : ''}`,
      )
      .join('\n');
    fields.push(
      field(
        'Team',
        `**${userText(team.name, NAME_MAX)}**${team.role === 'lead' ? ' — you lead' : ''}`,
        true,
      ),
    );
    if (team.channelId) fields.push(field('Channel', `<#${team.channelId}>`, true));
    fields.push(field('Roster', roster || GLYPH.unknown));
  }
  return fields;
}

/** An http(s) URL in its normalized form (special characters percent-encoded), else null. */
export function safeLink(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function submissionField(view: ParticipantView): APIEmbedField | null {
  const latest = view.mySubmissions[0];
  if (!latest) return view.canSubmit ? field('Submission', 'Nothing submitted yet.') : null;
  const links = latest.links
    .slice(0, LINKS_SHOWN)
    .map(safeLink)
    .filter((link): link is string => link !== null)
    .map((link) => `<${link}>`)
    .join('\n');
  return field(
    `Submission ${GLYPH.dot} v${latest.version}${latest.isLate ? ' · LATE' : ''}`,
    clip(
      [
        `${discordTime(latest.submittedAt, 'f')} by ${userText(latest.submittedBy, NAME_MAX)}`,
        userText(latest.summary, SUBMISSION_SUMMARY_MAX),
        links,
      ]
        .filter(Boolean)
        .join('\n'),
      LIMITS.fieldValue,
    ),
  );
}

function resultEmbed(result: NonNullable<ParticipantView['result']>): APIEmbed {
  return panel({
    kicker: 'TRIAL RESULT',
    title: OUTCOME_LABEL[result.outcome],
    description:
      result.outcome === 'incomplete'
        ? 'No assessable result. A missing evaluation is never counted as a fail.'
        : 'Descriptive evidence for one capability — not a measure of worth.',
    color: OUTCOME_COLOR[result.outcome],
    fields: [
      field('Final', formatScore(result.finalScore), true),
      field('Team', formatScore(result.teamScore), true),
      field('Individual', formatScore(result.individualScore), true),
      ...(result.recommendedRank
        ? [
            field(
              'Recommended rank',
              `${result.recommendedRank} ${GLYPH.dot} applied only by an evaluator, never automatically`,
            ),
          ]
        : []),
    ],
    timestamp: result.publishedAt,
  });
}

/** Buttons a member can use on this trial right now (as computed by core). */
export function participantButtons(
  view: ParticipantView,
  referenceShown: boolean,
): ReturnType<typeof button>[] {
  const buttons: ReturnType<typeof button>[] = [];
  if (view.canApply)
    buttons.push(button('Apply', trialsId(MEMBER_ACTIONS.apply, view.id), 'primary'));
  if (view.canSubmit)
    buttons.push(button('Submit', trialsId(MEMBER_ACTIONS.submit, view.id), 'primary'));
  if (view.canWithdraw)
    buttons.push(button('Withdraw', trialsId(MEMBER_ACTIONS.withdraw, view.id), 'danger'));
  buttons.push(
    button(
      'Refresh',
      trialsId(MEMBER_ACTIONS.open, view.id, referenceShown ? REFERENCE.shown : REFERENCE.absent),
    ),
  );
  return buttons;
}

/** Reference material that never changes once shown: the unsealed brief and the rubric. */
function referenceEmbeds(view: ParticipantView): APIEmbed[] {
  const embeds: APIEmbed[] = [];
  if (view.brief) {
    const chunks = safeChunks(view.brief);
    chunks.forEach((chunk, index) =>
      embeds.push(
        panel({
          kicker: chunks.length > 1 ? `BRIEF ${index + 1}/${chunks.length}` : 'BRIEF',
          title: index === 0 ? 'Mission' : 'Mission (continued)',
          description: chunk,
          color: COLORS.chrome,
        }),
      ),
    );
  }
  if (view.rubric?.length)
    embeds.push(
      panel({
        kicker: 'RUBRIC',
        title: 'What is measured',
        color: COLORS.base,
        fields: view.rubric.map((criterion) =>
          field(
            `${criterion.label} ${GLYPH.dot} ${criterion.weightPercent}%`,
            userText(criterion.description, 900) || GLYPH.unknown,
          ),
        ),
      }),
    );
  return embeds;
}

/**
 * A member's view of one trial: first the live message — state, clock, team,
 * submission, result — with the member's buttons (its Refresh updates it in
 * place), then the reference messages (brief, rubric). The brief and rubric
 * appear only when core unsealed them (competitors, once live); built only from
 * the member view, which never carries staff or adversarial fields. The live
 * message always fits one Discord message: its only long parts are three
 * fields clipped at 1024 characters, well under the 6000-character cap.
 */
export function participantReplies(
  view: ParticipantView,
  options: { referenceShown?: boolean } = {},
): ReplyPayload[] {
  const reference = packEmbeds(referenceEmbeds(view));
  const referenceShown = (options.referenceShown ?? false) || reference.length > 0;
  const live: APIEmbed[] = [mainEmbed(view)];
  if (view.result) live.push(resultEmbed(view.result));
  return [
    {
      embeds: live,
      components: buttonRows(participantButtons(view, referenceShown)),
      ephemeral: true,
    },
    ...reference.map((embeds) => ({ embeds, ephemeral: true })),
  ];
}

function mainEmbed(view: ParticipantView): APIEmbed {
  const clock = clockLine(view);
  return panel({
    kicker: `${view.ref} ${GLYPH.dot} ${categoryLabel(view.category)}`,
    title: userText(view.title, TITLE_MAX),
    description: [userText(view.summary, SUMMARY_MAX), clock ? `\n${clock}` : '']
      .filter(Boolean)
      .join('\n'),
    color: STATUS_COLOR[view.status],
    fields: [
      field('State', factsLine(view)),
      ...(view.teams.length > 0
        ? [
            field(
              'Teams',
              view.teams
                .map((team) => `${userText(team.name, NAME_MAX)} (${team.memberCount})`)
                .join(' · '),
            ),
          ]
        : []),
      ...participationFields(view),
      ...[submissionField(view)].filter((entry): entry is APIEmbedField => entry !== null),
    ],
  });
}

/** A trial as one list field. */
export function listField(summary: Summary): APIEmbedField {
  const clock = clockLine(summary);
  return field(
    trialTitle(summary),
    clip(
      [factsLine(summary), clock, userText(summary.summary, 200)].filter(Boolean).join('\n'),
      LIMITS.fieldValue,
    ),
  );
}

/** /trial status (and a member's trial record) — every trial listed, newest first. */
export function statusEmbed(
  entries: readonly HistoryEntry[],
  copy: { kicker: string; title: string; empty: string } = {
    kicker: 'TRIALS',
    title: 'Your trials',
    empty: 'Open trials are in `/trial list`. Apply with a short statement.',
  },
): APIEmbed {
  if (entries.length === 0)
    return panel({
      kicker: copy.kicker,
      title: copy.title,
      description: copy.empty,
      color: COLORS.steel,
    });
  return panel({
    kicker: copy.kicker,
    title: copy.title,
    color: COLORS.base,
    fields: entries.slice(0, LIMITS.fields).map((entry) => {
      const lines = [
        `${PARTICIPANT_LABEL[entry.status]} ${GLYPH.dot} ${STATUS_LABEL[entry.trial.status]}`,
        entry.teamName
          ? `Team ${userText(entry.teamName, NAME_MAX)}${entry.teamRole === 'lead' ? ' (lead)' : ''}`
          : null,
        entry.status === 'selected' ? clockLine(entry.trial) : null,
        entry.outcome
          ? `Result ${OUTCOME_LABEL[entry.outcome]} ${GLYPH.dot} ${formatScore(entry.finalScore)}`
          : null,
      ];
      return field(trialTitle(entry.trial), lines.filter(Boolean).join('\n'));
    }),
  });
}

/** Informational one-panel reply. */
export function infoReply(
  title: string,
  description: string,
  components?: ReplyPayload['components'],
): ReplyPayload {
  return {
    embeds: [panel({ kicker: 'TRIALS', title, description, color: COLORS.steel })],
    components,
    ephemeral: true,
  };
}
