import type { APIEmbed, APIEmbedField } from 'discord.js';
import type { trials } from '@jave/core';
import type { ReplyPayload } from '../../../interactions/types';
import { button, field, linkButton, panel, row } from '../../../ui/components';
import { discordTime, userText } from '../../../ui/format';
import { COLORS, GLYPH, LIMITS } from '../../../ui/theme';
import { type ConfirmedOperation, STAFF_ACTIONS, trialsId } from '../ids';
import { deadlineLine } from './cards';
import { categoryLabel, OUTCOME_LABEL, STATUS_COLOR, STATUS_LABEL } from './labels';
import { buttonRows, clockLine, safeLink } from './member';

type StaffView = trials.StaffTrialView;
type AssignmentResult = trials.AssignmentResult;
type ResultsView = trials.ResultsView;

const TITLE_MAX = 120;
const NAME_MAX = 64;
const REASON_MAX = 500;
const TEAMS_LISTED = 12;

export interface StaffAbilities {
  manage: boolean;
  evaluate: boolean;
}

function countBy<T extends string>(values: readonly T[]): Map<T, number> {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

function participantField(view: StaffView): APIEmbedField {
  const counts = countBy(view.participants.map((p) => p.status));
  const line = (['applied', 'selected', 'waitlisted', 'withdrawn', 'removed'] as const)
    .filter((status) => (counts.get(status) ?? 0) > 0)
    .map((status) => `${status} ${counts.get(status)}`)
    .join(` ${GLYPH.dot} `);
  const cap = view.maxParticipants ? ` ${GLYPH.dot} cap ${view.maxParticipants}` : '';
  return field('Participants', `${line || 'none yet'}${cap}`);
}

function teamField(view: StaffView): APIEmbedField | null {
  if (view.teams.length === 0) return null;
  const channels = view.teams.filter((team) => team.discordChannelId).length;
  const briefed = view.teams.filter((team) => team.briefedAt).length;
  const lines = view.teams
    .slice(0, TEAMS_LISTED)
    .map((team) => {
      const channel = team.discordChannelId ? `<#${team.discordChannelId}>` : 'no channel yet';
      const latest = team.submissions[0];
      const work = latest ? ` ${GLYPH.dot} v${latest.version}${latest.isLate ? ' LATE' : ''}` : '';
      return `${GLYPH.bullet} **${userText(team.name, NAME_MAX)}** (${team.members.length}) ${channel}${work}`;
    });
  const summary = `${view.teams.length} teams ${GLYPH.dot} channels ${channels}/${view.teams.length}${
    view.status === 'active' || briefed > 0 ? ` ${GLYPH.dot} briefed ${briefed}/${view.teams.length}` : ''
  }`;
  return field('Teams', [summary, ...lines].join('\n'));
}

function progressField(view: StaffView): APIEmbedField | null {
  if (!['active', 'evaluating', 'completed'].includes(view.status) || view.teams.length === 0)
    return null;
  const submitted = view.teams.filter((team) => team.submissions.length > 0);
  const evaluated = submitted.filter((team) => team.evaluations.some((e) => e.memberId === null));
  const lines = [`Submitted ${submitted.length}/${view.teams.length} teams`];
  if (view.status !== 'active')
    lines.push(`Team evaluations ${evaluated.length}/${submitted.length} submitted teams`);
  return field('Progress', lines.join('\n'));
}

function resultsField(view: StaffView): APIEmbedField | null {
  if (!view.results) return null;
  const counts = countBy(view.results.rows.map((r) => r.outcome));
  const line = (['distinction', 'pass', 'fail', 'incomplete'] as const)
    .map((outcome) => `${OUTCOME_LABEL[outcome]} ${counts.get(outcome) ?? 0}`)
    .join(` ${GLYPH.dot} `);
  return field(view.results.published ? 'Results (published)' : 'Results (preview)', line);
}

/** The staff control panel: facts, then only the controls this state and this viewer allow. */
export function controlPanel(
  view: StaffView,
  abilities: StaffAbilities,
  options: { dashboardUrl: string | null; notice?: APIEmbed },
): ReplyPayload {
  const clock = clockLine(view);
  const fields = [
    participantField(view),
    teamField(view),
    progressField(view),
    resultsField(view),
    view.assignmentSeed
      ? field('Assignment', `${view.assignmentStrategy ?? '—'} ${GLYPH.dot} seed \`${view.assignmentSeed}\``)
      : null,
    view.scheduledStartAt && ['recruiting', 'teams_assigned'].includes(view.status)
      ? field('Scheduled start', deadlineLine(view.scheduledStartAt))
      : null,
    view.cancelReason ? field('Cancelled', userText(view.cancelReason, REASON_MAX)) : null,
  ].filter((entry): entry is APIEmbedField => entry !== null);
  const embed = panel({
    kicker: `TRIAL CONTROL ${GLYPH.dot} ${view.ref} ${GLYPH.dot} ${categoryLabel(view.category)}`,
    title: userText(view.title, TITLE_MAX),
    description: [`**${STATUS_LABEL[view.status]}**`, clock].filter(Boolean).join(`\n`),
    color: STATUS_COLOR[view.status],
    fields: fields.slice(0, LIMITS.fields),
  });
  const buttons = controlButtons(view, abilities);
  const navigation = [button('Refresh', trialsId(STAFF_ACTIONS.panel, view.id))];
  const dashboard = options.dashboardUrl ? safeLink(options.dashboardUrl) : null;
  if (dashboard) navigation.push(linkButton('Dashboard', dashboard));
  return {
    embeds: options.notice ? [options.notice, embed] : [embed],
    components: [...buttonRows(buttons), row(...navigation)],
    ephemeral: true,
  };
}

const ask = (operation: ConfirmedOperation, trialId: string) =>
  trialsId(STAFF_ACTIONS.ask, operation, trialId);

function controlButtons(view: StaffView, abilities: StaffAbilities): ReturnType<typeof button>[] {
  const id = view.id;
  const out: ReturnType<typeof button>[] = [];
  const cancel = button('Cancel trial', ask('cancel', id), 'danger');
  if (abilities.manage) {
    switch (view.status) {
      case 'draft':
        out.push(button('Open recruitment', ask('open', id), 'primary'), cancel);
        break;
      case 'recruiting':
        out.push(
          button('Select — random', trialsId(STAFF_ACTIONS.selectRandom, id)),
          button('Select — manual', trialsId(STAFF_ACTIONS.selectManual, id)),
          button('Assign teams', trialsId(STAFF_ACTIONS.assign, id), 'primary'),
          cancel,
        );
        break;
      case 'teams_assigned':
        out.push(
          button('Start', ask('start', id), 'success'),
          button('Reassign teams', trialsId(STAFF_ACTIONS.assign, id)),
          button('Re-sync channels', ask('reprovision', id)),
          cancel,
        );
        break;
      case 'active':
        out.push(
          button('Close submissions', ask('close', id), 'primary'),
          button('Extend deadline', trialsId(STAFF_ACTIONS.extend, id)),
          button('Re-sync channels', ask('reprovision', id)),
          cancel,
        );
        break;
      case 'evaluating':
        if (abilities.evaluate) out.push(button('Evaluate', trialsId(STAFF_ACTIONS.evaluate, id)));
        out.push(button('Publish results', ask('publish', id), 'success'), cancel);
        break;
      case 'completed':
      case 'cancelled':
        break;
    }
  } else if (abilities.evaluate && view.status === 'evaluating') {
    out.push(button('Evaluate', trialsId(STAFF_ACTIONS.evaluate, id), 'primary'));
  }
  return out;
}

interface ConfirmCopy {
  title: string;
  body: string;
  confirmLabel: string;
  style: 'primary' | 'success' | 'danger';
}

/** What each confirmed operation does, stated as a consequence. */
export function confirmCopy(
  operation: ConfirmedOperation,
  view: StaffView,
  preview: ResultsView | null,
): ConfirmCopy {
  const ref = view.ref;
  switch (operation) {
    case 'open':
      return {
        title: `Open recruitment — ${ref}`,
        body: 'The recruitment card goes to the announcements channel. TRIAL and VERIFIED members can apply with a statement.',
        confirmLabel: 'Open recruitment',
        style: 'primary',
      };
    case 'start':
      return {
        title: `Start ${ref}`,
        body: `The clock starts now: the deadline is ${view.durationMinutes} minutes away. Teams get the brief in their channels and by DM.`,
        confirmLabel: 'Start trial',
        style: 'success',
      };
    case 'close':
      return {
        title: `Close submissions — ${ref}`,
        body: 'No further submissions are accepted, late or not. Evaluators are notified and scoring opens.',
        confirmLabel: 'Close submissions',
        style: 'primary',
      };
    case 'reprovision':
      return {
        title: `Re-sync channels — ${ref}`,
        body: 'Every team channel is brought in line with the current roster and evaluator roles. Safe to repeat.',
        confirmLabel: 'Re-sync channels',
        style: 'primary',
      };
    case 'cancel':
      return {
        title: `Cancel ${ref}`,
        body: 'Every stakeholder is notified and team channels become read-only. This cannot be undone. A reason is required.',
        confirmLabel: 'Cancel with reason',
        style: 'danger',
      };
    case 'publish':
    case 'publish-incomplete': {
      const unevaluated = preview?.results.filter((r) => r.incompleteReason === 'not_evaluated') ?? [];
      const counts = preview?.counts;
      const tally = counts
        ? (['distinction', 'pass', 'fail', 'incomplete'] as const)
            .map((outcome) => `${OUTCOME_LABEL[outcome]} ${counts[outcome]}`)
            .join(` ${GLYPH.dot} `)
        : '';
      const warning =
        unevaluated.length > 0
          ? `\n\n**${unevaluated.length} participant(s) have no evaluation.** Publishing now records them INCOMPLETE — never as a fail.`
          : '';
      return {
        title: `Publish results — ${ref}`,
        body: `${tally}\nResults are final and every competitor is notified. Rank consequences stay a separate, explicit step.${warning}`,
        confirmLabel: unevaluated.length > 0 ? 'Publish — mark incomplete' : 'Publish results',
        style: 'success',
      };
    }
  }
}

/** Teams as assigned (seeded, reproducible), and what happens next with the start. */
export function assignmentNotice(result: AssignmentResult, view: StaffView): APIEmbed {
  const names = new Map(view.participants.map((p) => [p.memberId, p.displayName]));
  const lines = result.teams.slice(0, TEAMS_LISTED).map((team) => {
    const lead = names.get(team.leadMemberId) ?? '—';
    return `${GLYPH.bullet} **${userText(team.name, NAME_MAX)}** ${GLYPH.dot} ${team.memberIds.length} members ${GLYPH.dot} lead ${userText(lead, NAME_MAX)}`;
  });
  let start: string;
  if (result.scheduledStart === 'scheduled' && view.scheduledStartAt)
    start = `Starts automatically ${discordTime(view.scheduledStartAt, 'R')}.`;
  else if (result.scheduledStart === 'passed')
    start = `**The scheduled start${view.scheduledStartAt ? ` (${discordTime(view.scheduledStartAt, 'f')})` : ''} has passed.** Start it by hand now, or reschedule it in the dashboard.`;
  else start = 'No scheduled start — press START when the teams are ready.';
  return panel({
    kicker: `TEAMS ASSIGNED ${GLYPH.dot} ${result.strategy.toUpperCase()}`,
    title: `${result.teams.length} teams of ${result.teamSize}`,
    description: [
      ...lines,
      '',
      `Seed \`${result.seed}\` — the assignment is reproducible from it.`,
      result.waitlisted > 0 ? `${result.waitlisted} applicant(s) waitlisted.` : null,
      result.removed > 0 ? `${result.removed} selected member(s) removed — no longer eligible.` : null,
      '',
      start,
    ]
      .filter((line): line is string => line !== null)
      .join('\n'),
    color: result.scheduledStart === 'passed' ? COLORS.warning : COLORS.success,
  });
}
