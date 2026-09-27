import type { APISelectMenuOption } from 'discord.js';
import { isUuid, requireMember, trials, ValidationError } from '@jave/core';
import type { HandlerContext, ReplyPayload } from '../../interactions/types';
import { button, panel, row, stringSelect, success } from '../../ui/components';
import { clip, discordTime, userText } from '../../ui/format';
import { COLORS, GLYPH, LIMITS } from '../../ui/theme';
import { MEMBER_ACTIONS, type PickPurpose, trialsId } from './ids';
import { applyModal, submitModal } from './modals';
import { deadlineLine } from './render/cards';
import { ONGOING_STATUSES, PARTICIPANT_LABEL, STATUS_LABEL } from './render/labels';
import {
  buttonRows,
  factsLine,
  infoReply,
  listField,
  participantReplies,
  statusEmbed,
  trialTitle,
} from './render/member';

type Summary = trials.TrialSummaryView;
type ParticipantView = trials.ParticipantTrialView;

/** How many trials a list shows (one embed, one select menu). */
const LIST_SIZE = 10;
/** Applying needs a per-trial eligibility read; keep the candidate set small. */
const APPLY_CANDIDATES = 10;
const OPTION_LABEL_MAX = 100;
const OPTION_DESCRIPTION_MAX = 100;
const NAME_MAX = 64;
/** Participant statuses that still hold a place (and can withdraw before the start). */
const STAKE_STATUSES = ['applied', 'selected', 'waitlisted'] as const;
/** Trial statuses in which a member's team is theirs to work with. */
const TEAM_STATUSES: readonly trials.TrialStatus[] = ['teams_assigned', 'active', 'evaluating'];

/** Send a multi-message reply: the first through respond(), the rest as follow-ups. */
export async function respondAll(h: HandlerContext, replies: readonly ReplyPayload[]) {
  const [first, ...rest] = replies;
  if (!first) return;
  await h.respond(first);
  for (const reply of rest) await h.interaction.followUp(reply);
}

export async function showTrial(h: HandlerContext, trialId: string): Promise<void> {
  const view = await trials.getTrialForParticipant(h.ctx, { trialId });
  await respondAll(h, participantReplies(view));
}

/** Trials worth listing to a member: not drafts, not finished (staff see drafts in /trial manage). */
async function ongoingTrials(h: HandlerContext): Promise<Summary[]> {
  const page = await trials.listTrials(h.ctx, { limit: 50 });
  return page.items.filter((item) => ONGOING_STATUSES.includes(item.status));
}

export function trialOption(summary: Summary): APISelectMenuOption {
  return {
    label: clip(`${summary.ref} — ${summary.title}`, OPTION_LABEL_MAX),
    value: summary.id,
    description: clip(factsLine(summary), OPTION_DESCRIPTION_MAX),
  };
}

export function pickerRow(
  purpose: PickPurpose,
  placeholder: string,
  summaries: readonly Summary[],
) {
  return row(
    stringSelect(
      trialsId(MEMBER_ACTIONS.pick, purpose),
      placeholder,
      summaries.slice(0, LIMITS.selectOptions).map(trialOption),
    ),
  );
}

/** /trial list — ongoing trials, a picker to open one, APPLY where the member may apply. */
export async function listOngoing(h: HandlerContext): Promise<void> {
  const ongoing = (await ongoingTrials(h)).slice(0, LIST_SIZE);
  if (ongoing.length === 0) {
    await h.respond(
      infoReply(
        'No open trials',
        'Nothing is recruiting or running right now. New trials are announced in the announcements channel.',
      ),
    );
    return;
  }
  const applicable = await applicableTrials(h, ongoing);
  await h.respond({
    embeds: [
      panel({
        kicker: 'TRIALS',
        title: 'Open and running',
        description: 'YOU THINK YOU’RE ELITE? PROVE IT. Outcomes count, effort does not.',
        color: COLORS.chrome,
        fields: ongoing.map(listField),
      }),
    ],
    components: [
      pickerRow('view', 'Open a trial', ongoing),
      ...buttonRows(
        applicable.map((summary) =>
          button(`Apply · ${summary.ref}`, trialsId(MEMBER_ACTIONS.apply, summary.id), 'primary'),
        ),
      ).slice(0, 4),
    ],
    ephemeral: true,
  });
}

/** Recruiting trials this member may apply to right now (core decides, per trial). */
async function applicableTrials(h: HandlerContext, candidates: readonly Summary[]) {
  const recruiting = candidates.filter((c) => c.status === 'recruiting').slice(0, APPLY_CANDIDATES);
  const views = await Promise.all(
    recruiting.map((summary) => trials.getTrialForParticipant(h.ctx, { trialId: summary.id })),
  );
  return recruiting.filter((_, index) => views[index]!.canApply);
}

/** /trial view without a trial: pick one. */
export async function pickToView(h: HandlerContext): Promise<void> {
  const page = await trials.listTrials(h.ctx, { limit: LIMITS.selectOptions });
  const visible = page.items.filter((item) => item.status !== 'draft');
  if (visible.length === 0) {
    await h.respond(infoReply('No trials', 'There is no trial to show yet.'));
    return;
  }
  await h.respond({
    embeds: [panel({ kicker: 'TRIALS', title: 'Choose a trial', color: COLORS.base })],
    components: [pickerRow('view', 'Open a trial', visible)],
    ephemeral: true,
  });
}

/** /trial apply without a trial: one APPLY button per trial the member may apply to. */
export async function offerApply(h: HandlerContext): Promise<void> {
  const applicable = await applicableTrials(h, await ongoingTrials(h));
  if (applicable.length === 0) {
    await h.respond(
      infoReply(
        'Nothing to apply to',
        'No recruiting trial is open to you right now. Trials are open to TRIAL and VERIFIED members.',
      ),
    );
    return;
  }
  await h.respond({
    embeds: [
      panel({
        kicker: 'TRIALS',
        title: 'Apply',
        description: 'A short statement goes to staff with your application.',
        color: COLORS.chrome,
        fields: applicable.map(listField),
      }),
    ],
    components: buttonRows(
      applicable.map((summary) =>
        button(`Apply · ${summary.ref}`, trialsId(MEMBER_ACTIONS.apply, summary.id), 'primary'),
      ),
    ).slice(0, 5),
    ephemeral: true,
  });
}

/**
 * Why the member cannot apply, from what core computed for them. Core
 * re-checks everything when the statement arrives; this only spares the
 * member typing a statement that would be refused.
 */
function applyBlocker(h: HandlerContext, view: ParticipantView): string {
  const participation = view.participation;
  if (participation && (STAKE_STATUSES as readonly string[]).includes(participation.status))
    return `You already hold a place: ${PARTICIPANT_LABEL[participation.status]}.`;
  if (participation?.status === 'removed') return 'You were removed from this trial.';
  const closesAt = view.recruitmentClosesAt?.getTime() ?? Number.POSITIVE_INFINITY;
  if (view.status !== 'recruiting' || closesAt <= h.ctx.clock.now().getTime())
    return 'Recruitment for this trial is closed.';
  const actor = requireMember(h.ctx);
  return (
    trials.eligibilityProblem({
      roles: actor.roles,
      standing: actor.standing,
      guildStatus: 'present',
    }) ?? 'This trial is not open to you.'
  );
}

/** APPLY (card, list, /trial apply): the statement modal, or why applying is not possible. */
export async function openApplyModal(h: HandlerContext, trialId: string): Promise<void> {
  const view = await trials.getTrialForParticipant(h.ctx, { trialId });
  if (!view.canApply) {
    await h.respond(
      infoReply(`Cannot apply — ${view.ref}`, `${trialTitle(view)}\n${applyBlocker(h, view)}`),
    );
    return;
  }
  await h.interaction.showModal(applyModal(trialId, view.ref));
}

function submitBlocker(view: ParticipantView): string {
  const participation = view.participation;
  if (!participation?.team) return 'Only members of a team in this trial can submit.';
  if (view.status === 'teams_assigned') return 'The submission window opens when the trial starts.';
  return 'The submission window is closed.';
}

/** SUBMIT: the modal prefilled with the team's latest version, or why submitting is not possible. */
export async function openSubmitModal(h: HandlerContext, trialId: string): Promise<void> {
  const view = await trials.getTrialForParticipant(h.ctx, { trialId });
  if (!view.canSubmit) {
    await h.respond(
      infoReply(`Cannot submit — ${view.ref}`, `${trialTitle(view)}\n${submitBlocker(view)}`),
    );
    return;
  }
  const latest = view.mySubmissions[0] ?? null;
  await h.interaction.showModal(
    submitModal(trialId, {
      nextVersion: (latest?.version ?? 0) + 1,
      late: view.timing.phase === 'grace',
      previous: latest ? { summary: latest.summary, links: latest.links } : null,
    }),
  );
}

export async function completeApplication(h: HandlerContext, trialId: string): Promise<void> {
  const statement = h.interaction.modal.text('statement');
  await trials.applyToTrial(h.ctx, { trialId, statement });
  const view = await trials.getTrialForParticipant(h.ctx, { trialId });
  await h.respond({
    embeds: [
      success(
        'Application recorded',
        `${trialTitle(view)}\nSelection is announced by DM. Withdraw any time before the start.`,
      ),
    ],
    components: [row(button('View trial', trialsId(MEMBER_ACTIONS.view, trialId)))],
    ephemeral: true,
  });
}

/** Links field → URLs, one per line (or whitespace separated). Core validates each. */
export function parseLinks(raw: string): string[] {
  return raw
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

export async function completeSubmission(h: HandlerContext, trialId: string): Promise<void> {
  const receipt = await trials.submit(h.ctx, {
    trialId,
    summary: h.interaction.modal.text('summary'),
    links: parseLinks(h.interaction.modal.text('links')),
  });
  const view = await trials.getTrialForParticipant(h.ctx, { trialId });
  const late = receipt.isLate
    ? `\n**LATE** — received after the deadline, inside the late window. Evaluators see the flag.`
    : '';
  await h.respond({
    embeds: [
      success(
        `Submission received — v${receipt.version}`,
        `${trialTitle(view)}\n${discordTime(receipt.submittedAt, 'f')}. Evaluators assess your team's latest version.${late}`,
      ),
    ],
    components: [row(button('View trial', trialsId(MEMBER_ACTIONS.view, trialId)))],
    ephemeral: true,
  });
}

/** Trials the member can still withdraw from (before the start). */
async function withdrawable(h: HandlerContext) {
  const mine = await trials.myTrials(h.ctx);
  return mine.filter(
    (entry) =>
      (STAKE_STATUSES as readonly string[]).includes(entry.status) &&
      (entry.trial.status === 'recruiting' || entry.trial.status === 'teams_assigned'),
  );
}

export async function offerWithdraw(h: HandlerContext): Promise<void> {
  const entries = await withdrawable(h);
  if (entries.length === 0) {
    await h.respond(
      infoReply('Nothing to withdraw from', 'You hold no place in a trial that has not started.'),
    );
    return;
  }
  await h.respond({
    embeds: [
      panel({
        kicker: 'TRIALS',
        title: 'Withdraw',
        color: COLORS.base,
        fields: entries.map((e) => listField(e.trial)),
      }),
    ],
    components: buttonRows(
      entries.map((entry) =>
        button(
          `Withdraw · ${entry.trial.ref}`,
          trialsId(MEMBER_ACTIONS.withdraw, entry.trial.id),
          'danger',
        ),
      ),
    ).slice(0, 5),
    ephemeral: true,
  });
}

export async function confirmWithdraw(h: HandlerContext, trialId: string): Promise<void> {
  const view = await trials.getTrialForParticipant(h.ctx, { trialId });
  await h.respond({
    embeds: [
      panel({
        kicker: 'CONFIRM',
        title: `Withdraw from ${view.ref}`,
        description: [
          trialTitle(view),
          view.status === 'teams_assigned'
            ? 'You leave your team now; its channel is re-synced without you.'
            : 'Your application is withdrawn.',
          'You may re-apply while recruitment is open (staff may not).',
        ].join('\n'),
        color: COLORS.warning,
      }),
    ],
    components: [
      row(
        button('Confirm withdrawal', trialsId(MEMBER_ACTIONS.withdrawConfirm, trialId), 'danger'),
      ),
    ],
    ephemeral: true,
  });
}

export async function executeWithdraw(h: HandlerContext, trialId: string): Promise<void> {
  await trials.withdraw(h.ctx, { trialId });
  const view = await trials.getTrialForParticipant(h.ctx, { trialId });
  await h.respond({ embeds: [success('Withdrawn', trialTitle(view))], ephemeral: true });
}

/** Trials where the member's team can submit now. */
async function submittable(h: HandlerContext) {
  const mine = await trials.myTrials(h.ctx);
  return mine.filter(
    (entry) =>
      entry.status === 'selected' &&
      entry.teamName !== null &&
      entry.trial.status === 'active' &&
      (entry.trial.timing.phase === 'open' || entry.trial.timing.phase === 'grace'),
  );
}

export async function offerSubmit(h: HandlerContext): Promise<void> {
  const entries = await submittable(h);
  if (entries.length === 0) {
    await h.respond(
      infoReply('Nothing to submit', 'None of your teams has an open submission window.'),
    );
    return;
  }
  await h.respond({
    embeds: [
      panel({
        kicker: 'TRIALS',
        title: 'Submit',
        description: 'Each submission is a new version; evaluators assess the latest.',
        color: COLORS.chrome,
        fields: entries.map((e) => listField(e.trial)),
      }),
    ],
    components: buttonRows(
      entries.map((entry) =>
        button(
          `Submit · ${entry.trial.ref}`,
          trialsId(MEMBER_ACTIONS.submit, entry.trial.id),
          'primary',
        ),
      ),
    ).slice(0, 5),
    ephemeral: true,
  });
}

export async function showStatus(h: HandlerContext): Promise<void> {
  const mine = await trials.myTrials(h.ctx);
  const open = mine.filter((entry) => entry.trial.status !== 'draft');
  await h.respond({
    embeds: [statusEmbed(open)],
    components:
      open.length > 0
        ? [
            pickerRow(
              'view',
              'Open a trial',
              open.map((e) => e.trial),
            ),
          ]
        : undefined,
    ephemeral: true,
  });
}

/** /team — every team the member is on in a trial that is set up, live or in evaluation. */
export async function showTeams(h: HandlerContext): Promise<void> {
  const mine = await trials.myTrials(h.ctx);
  const onTeams = mine.filter(
    (entry) =>
      entry.status === 'selected' && entry.teamName && TEAM_STATUSES.includes(entry.trial.status),
  );
  if (onTeams.length === 0) {
    await h.respond(
      infoReply(
        'No active team',
        'You are not on a trial team right now. `/trial list` shows what is open.',
      ),
    );
    return;
  }
  const views = await Promise.all(
    onTeams.map((entry) => trials.getTrialForParticipant(h.ctx, { trialId: entry.trial.id })),
  );
  const replies: ReplyPayload[] = views.map((view) => {
    const team = view.participation?.team;
    const roster = (team?.members ?? [])
      .map(
        (m) =>
          `${GLYPH.bullet} ${userText(m.displayName, NAME_MAX)}${m.role === 'lead' ? ' — lead' : ''}`,
      )
      .join('\n');
    const lines = [
      `**${userText(team?.name ?? '', NAME_MAX)}** ${GLYPH.dot} ${STATUS_LABEL[view.status]}`,
      team?.channelId ? `Channel <#${team.channelId}>` : 'Channel — being prepared',
      view.timing.deadlineAt && view.timing.phase !== 'closed'
        ? `Deadline ${deadlineLine(view.timing.deadlineAt)}`
        : view.status === 'teams_assigned'
          ? view.scheduledStartAt
            ? `Starts ${discordTime(view.scheduledStartAt, 'R')}`
            : 'Starts when staff give the signal. The brief unseals at the start.'
          : null,
      '',
      roster,
      view.brief
        ? `\n**Brief** — ${userText(view.brief, 600)}\nThe full brief is in your team channel and in \`/trial view\`.`
        : null,
    ];
    return {
      embeds: [
        panel({
          kicker: `TEAM ${GLYPH.dot} ${view.ref}`,
          title: userText(view.title, NAME_MAX * 2),
          description: lines.filter((line) => line !== null).join('\n'),
          color: COLORS.chrome,
        }),
      ],
      components: buttonRows([
        ...(view.canSubmit
          ? [button('Submit', trialsId(MEMBER_ACTIONS.submit, view.id), 'primary')]
          : []),
        button('Trial', trialsId(MEMBER_ACTIONS.view, view.id)),
      ]),
      ephemeral: true,
    };
  });
  await respondAll(h, replies);
}

/** Staff-or-self record of trials a member competed in (user context menu). */
export async function showTrialRecord(
  h: HandlerContext,
  memberId: string,
  name: string,
): Promise<void> {
  const history = await trials.memberTrialHistory(h.ctx, { memberId });
  const embed = statusEmbed(history, {
    kicker: 'TRIAL RECORD',
    title: `${userText(name, NAME_MAX)} — ${history.length} trial${history.length === 1 ? '' : 's'}`,
    empty: 'No trials competed in yet.',
  });
  await h.respond({ embeds: [embed], ephemeral: true });
}

/** A routing argument (custom id, select value, option) must be a UUID before core sees it. */
export function requireUuid(value: string | undefined | null, what: string): string {
  if (!value || !isUuid(value)) throw new ValidationError(`Choose ${what}.`);
  return value;
}

export function requireTrialId(value: string | undefined | null): string {
  return requireUuid(value, 'a trial');
}
