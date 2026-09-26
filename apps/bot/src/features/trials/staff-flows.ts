import type { APIEmbed, APISelectMenuOption } from 'discord.js';
import { can, ForbiddenError, requireUser, trials, ValidationError } from '@jave/core';
import type { HandlerContext, ReplyPayload } from '../../interactions/types';
import { button, linkButton, panel, row, stringSelect, success } from '../../ui/components';
import { clip, userText } from '../../ui/format';
import { COLORS, GLYPH, LIMITS } from '../../ui/theme';
import { type ConfirmedOperation, FIELDS, MEMBER_ACTIONS, STAFF_ACTIONS, trialsId } from './ids';
import {
  assignModal,
  cancelModal,
  evaluationModal,
  extendModal,
  QUICK_EVALUATION_MAX_CRITERIA,
  randomSelectionModal,
} from './modals';
import { formatScore } from './render/labels';
import { safeLink } from './render/member';
import { assignmentNotice, confirmCopy, controlPanel, type StaffAbilities } from './render/staff';
import { trialOption } from './member-flows';

type StaffView = trials.StaffTrialView;

const NAME_MAX = 64;
const PARTICIPANT_LABEL_MAX = 100;
/** Staff lists put running trials first. */
const PANEL_ORDER: readonly trials.TrialStatus[] = [
  'evaluating',
  'active',
  'teams_assigned',
  'recruiting',
  'draft',
  'completed',
  'cancelled',
];
const WHOLE_NUMBER = /^\d+$/;
/** Who a manual selection can pick from (core re-checks eligibility). */
const SELECTION_POOL: readonly trials.StaffParticipantView['status'][] = [
  'applied',
  'selected',
  'waitlisted',
];

function abilities(h: HandlerContext): StaffAbilities {
  return { manage: can(h.ctx, 'canManageTrials'), evaluate: can(h.ctx, 'canEvaluateTrials') };
}

/** UI gate only — every operation below is authorized again by core (capability and conflict of interest). */
export function assertTrialStaff(h: HandlerContext): void {
  const { manage, evaluate } = abilities(h);
  if (!manage && !evaluate) throw new ForbiddenError('Trial control is for trial staff.');
}

export function dashboardUrl(h: HandlerContext, trialId: string): string | null {
  const base = h.ctx.config.publicUrl;
  return base ? safeLink(`${base.replace(/\/+$/, '')}/trials/${trialId}`) : null;
}

async function panelPayload(h: HandlerContext, trialId: string, notice?: APIEmbed): Promise<ReplyPayload> {
  const view = await trials.getTrialForStaff(h.ctx, { trialId });
  return controlPanel(view, abilities(h), { dashboardUrl: dashboardUrl(h, trialId), notice });
}

/** Update the panel in place when the click came from it; otherwise answer with a fresh one. */
async function showPanel(h: HandlerContext, trialId: string, notice?: APIEmbed): Promise<void> {
  const payload = await panelPayload(h, trialId, notice);
  if (h.interaction.kind === 'button' || h.interaction.kind === 'select')
    await h.interaction.update(payload);
  else await h.respond(payload);
}

/** /trial manage without a trial: a picker of every trial, running ones first. */
export async function pickTrialToManage(h: HandlerContext): Promise<void> {
  assertTrialStaff(h);
  const page = await trials.listTrials(h.ctx, { limit: LIMITS.selectOptions * 2 });
  const ordered = [...page.items].sort(
    (a, b) => PANEL_ORDER.indexOf(a.status) - PANEL_ORDER.indexOf(b.status) || b.number - a.number,
  );
  if (ordered.length === 0) {
    const url = h.ctx.config.publicUrl ? safeLink(`${h.ctx.config.publicUrl}/trials/new`) : null;
    await h.respond({
      embeds: [
        panel({
          kicker: 'TRIAL CONTROL',
          title: 'No trials yet',
          description: 'Create one from a template or from scratch in the dashboard.',
          color: COLORS.steel,
        }),
      ],
      components: url ? [row(linkButton('Create in dashboard', url))] : undefined,
      ephemeral: true,
    });
    return;
  }
  await h.respond({
    embeds: [panel({ kicker: 'TRIAL CONTROL', title: 'Choose a trial', color: COLORS.base })],
    components: [
      row(
        stringSelect(
          trialsId(MEMBER_ACTIONS.pick, 'manage'),
          'Trial to operate',
          ordered.slice(0, LIMITS.selectOptions).map(trialOption),
        ),
      ),
    ],
    ephemeral: true,
  });
}

export async function openPanel(h: HandlerContext, trialId: string): Promise<void> {
  assertTrialStaff(h);
  await showPanel(h, trialId);
}

/** Confirmation step for a one-click operation: the consequence, then CONFIRM or BACK. */
export async function askConfirmation(
  h: HandlerContext,
  operation: ConfirmedOperation,
  trialId: string,
): Promise<void> {
  const view = await trials.getTrialForStaff(h.ctx, { trialId });
  const preview =
    operation === 'publish' || operation === 'publish-incomplete'
      ? await trials.previewResults(h.ctx, { trialId })
      : null;
  const copy = confirmCopy(operation, view, preview);
  const unevaluated = preview?.results.some((r) => r.incompleteReason === 'not_evaluated') ?? false;
  const runAs: ConfirmedOperation =
    operation === 'publish' && unevaluated ? 'publish-incomplete' : operation;
  const confirmId =
    operation === 'cancel'
      ? trialsId(STAFF_ACTIONS.cancel, trialId)
      : trialsId(STAFF_ACTIONS.run, runAs, trialId);
  await h.interaction.update({
    embeds: [
      panel({
        kicker: `CONFIRM ${GLYPH.dot} ${view.ref}`,
        title: copy.title,
        description: copy.body,
        color: copy.style === 'danger' ? COLORS.danger : COLORS.warning,
      }),
    ],
    components: [
      row(
        button(copy.confirmLabel, confirmId, copy.style),
        button('Back', trialsId(STAFF_ACTIONS.panel, trialId)),
      ),
    ],
    ephemeral: true,
  });
}

/** Execute a confirmed operation through core, then show the panel with the result on top. */
export async function runOperation(
  h: HandlerContext,
  operation: ConfirmedOperation,
  trialId: string,
): Promise<void> {
  let notice: APIEmbed;
  switch (operation) {
    case 'open': {
      const view = await trials.openRecruitment(h.ctx, { trialId });
      notice = success('Recruitment open', `${view.ref} — the card is on its way to the announcements channel.`);
      break;
    }
    case 'start': {
      const view = await trials.startTrial(h.ctx, { trialId });
      notice = success('Trial live', `${view.ref} — the clock is running. Teams are being briefed.`);
      break;
    }
    case 'close': {
      const outcome = await trials.closeSubmissions(h.ctx, { trialId });
      notice = success(
        'Submissions closed',
        `${outcome.submittedTeams ?? 0} of ${outcome.teams ?? 0} teams submitted. Evaluation is open.`,
      );
      break;
    }
    case 'reprovision': {
      const { enqueued } = await trials.reprovisionTeams(h.ctx, { trialId });
      notice = success('Channels re-syncing', `${enqueued} team channel(s) queued.`);
      break;
    }
    case 'publish':
    case 'publish-incomplete': {
      const results = await trials.publishResults(h.ctx, {
        trialId,
        acknowledgeIncomplete: operation === 'publish-incomplete',
      });
      const { counts } = results;
      notice = success(
        'Results published',
        `DISTINCTION ${counts.distinction} ${GLYPH.dot} PASS ${counts.pass} ${GLYPH.dot} NOT PASSED ${counts.fail} ${GLYPH.dot} INCOMPLETE ${counts.incomplete}\nRank consequences are applied separately, per member, in the dashboard.`,
      );
      break;
    }
    case 'cancel':
      await h.interaction.showModal(cancelModal(trialId));
      return;
  }
  await showPanel(h, trialId, notice);
}

// ─── Modal-driven operations ─────────────────────────────────────────────────

function parseWholeNumber(raw: string, label: string): number | undefined {
  const value = raw.trim();
  if (!value) return undefined;
  if (!WHOLE_NUMBER.test(value)) throw new ValidationError(`${label} must be a whole number.`);
  return Number(value);
}

function requiredWholeNumber(raw: string, label: string): number {
  const value = parseWholeNumber(raw, label);
  if (value === undefined) throw new ValidationError(`Enter ${label.toLowerCase()}.`);
  return value;
}

export async function openModal(h: HandlerContext, action: string, trialId: string): Promise<void> {
  assertTrialStaff(h);
  switch (action) {
    case STAFF_ACTIONS.selectRandom:
      return h.interaction.showModal(randomSelectionModal(trialId));
    case STAFF_ACTIONS.extend:
      return h.interaction.showModal(extendModal(trialId));
    case STAFF_ACTIONS.cancel:
      return h.interaction.showModal(cancelModal(trialId));
    case STAFF_ACTIONS.assign: {
      const view = await trials.getTrialForStaff(h.ctx, { trialId });
      return h.interaction.showModal(assignModal(trialId, view.teamSize));
    }
  }
}

export async function submitRandomSelection(h: HandlerContext, trialId: string): Promise<void> {
  const { modal } = h.interaction;
  const result = await trials.selectParticipants(h.ctx, {
    mode: 'random',
    trialId,
    count: requiredWholeNumber(modal.text(FIELDS.count), 'How many'),
    seed: modal.text(FIELDS.seed).trim() || undefined,
  });
  await h.respond(
    await panelPayload(
      h,
      trialId,
      success(
        'Participants selected',
        `${result.selectedMemberIds.length} drawn from ${result.poolSize} eligible applicants ${GLYPH.dot} seed \`${result.seed}\``,
      ),
    ),
  );
}

export async function submitAssignment(h: HandlerContext, trialId: string): Promise<void> {
  const { modal } = h.interaction;
  const strategy = modal.select(FIELDS.strategy)[0] === 'random' ? 'random' : 'balanced';
  const result = await trials.assignTeams(h.ctx, {
    trialId,
    strategy,
    teamSize: parseWholeNumber(modal.text(FIELDS.teamSize), 'Team size'),
    seed: modal.text(FIELDS.seed).trim() || undefined,
  });
  const view = await trials.getTrialForStaff(h.ctx, { trialId });
  const payload = controlPanel(view, abilities(h), {
    dashboardUrl: dashboardUrl(h, trialId),
    notice: assignmentNotice(result, view),
  });
  await h.respond(payload);
}

export async function submitExtension(h: HandlerContext, trialId: string): Promise<void> {
  const { modal } = h.interaction;
  const view = await trials.extendDeadline(h.ctx, {
    trialId,
    minutes: requiredWholeNumber(modal.text(FIELDS.minutes), 'Minutes'),
    reason: modal.text(FIELDS.reason),
  });
  await h.respond(
    await panelPayload(
      h,
      trialId,
      success('Deadline extended', `${view.ref} — competitors are notified of the new deadline.`),
    ),
  );
}

export async function submitCancellation(h: HandlerContext, trialId: string): Promise<void> {
  const view = await trials.cancelTrial(h.ctx, {
    trialId,
    reason: h.interaction.modal.text(FIELDS.reason),
  });
  await h.respond(
    await panelPayload(
      h,
      trialId,
      success('Trial cancelled', `${view.ref} — stakeholders are notified; team channels become read-only.`),
    ),
  );
}

// ─── Manual selection ────────────────────────────────────────────────────────

export async function offerManualSelection(h: HandlerContext, trialId: string): Promise<void> {
  const view = await trials.getTrialForStaff(h.ctx, { trialId });
  const pool = view.participants.filter((p) => SELECTION_POOL.includes(p.status));
  if (pool.length === 0) {
    await h.respond({
      embeds: [panel({ kicker: view.ref, title: 'No applicants yet', color: COLORS.steel })],
      ephemeral: true,
    });
    return;
  }
  const options: APISelectMenuOption[] = pool.slice(0, LIMITS.selectOptions).map((p) => ({
    label: clip(`${p.displayName} · @${p.handle}`, PARTICIPANT_LABEL_MAX),
    value: p.memberId,
    description: clip(p.statement ?? 'No statement', PARTICIPANT_LABEL_MAX),
    default: p.status === 'selected',
  }));
  const overflow =
    pool.length > LIMITS.selectOptions
      ? `\n${pool.length} applicants — only the first ${LIMITS.selectOptions} fit here. Use random selection or the dashboard.`
      : '';
  await h.respond({
    embeds: [
      panel({
        kicker: `SELECTION ${GLYPH.dot} ${view.ref}`,
        title: 'Choose participants',
        description: `The choice replaces the current selection. Eligibility is re-checked now.${overflow}`,
        color: COLORS.base,
      }),
    ],
    components: [
      row(
        stringSelect(trialsId(STAFF_ACTIONS.selectPick, trialId), 'Participants', options, {
          min: 1,
          max: options.length,
        }),
      ),
    ],
    ephemeral: true,
  });
}

export async function applyManualSelection(h: HandlerContext, trialId: string): Promise<void> {
  const result = await trials.selectParticipants(h.ctx, {
    mode: 'manual',
    trialId,
    memberIds: [...h.interaction.values],
  });
  await showPanel(
    h,
    trialId,
    success('Participants selected', `${result.selectedMemberIds.length} selected of ${result.poolSize} eligible.`),
  );
}

// ─── Quick evaluation ────────────────────────────────────────────────────────

function submittedTeams(view: StaffView) {
  return view.teams.filter((team) => team.submissions.length > 0);
}

export async function offerEvaluation(h: HandlerContext, trialId: string): Promise<void> {
  const view = await trials.getTrialForStaff(h.ctx, { trialId });
  const me = requireUser(h.ctx).userId;
  const teams = submittedTeams(view);
  if (teams.length === 0) {
    await h.respond({
      embeds: [panel({ kicker: view.ref, title: 'Nothing to evaluate', description: 'No team submitted.', color: COLORS.steel })],
      ephemeral: true,
    });
    return;
  }
  const url = dashboardUrl(h, trialId);
  if (view.rubric.length > QUICK_EVALUATION_MAX_CRITERIA) {
    await h.respond({
      embeds: [
        panel({
          kicker: `EVALUATION ${GLYPH.dot} ${view.ref}`,
          title: 'Score in the dashboard',
          description: `This rubric has ${view.rubric.length} criteria — more than a Discord form holds. The dashboard shows the full grid with weighted totals.`,
          color: COLORS.base,
        }),
      ],
      components: url ? [row(linkButton('Open evaluation', `${url}?tab=evaluation`))] : undefined,
      ephemeral: true,
    });
    return;
  }
  const options: APISelectMenuOption[] = teams.slice(0, LIMITS.selectOptions).map((team) => {
    const mine = team.evaluations.find((e) => e.memberId === null && e.evaluatorUserId === me);
    const latest = team.submissions[0]!;
    return {
      label: clip(team.name, PARTICIPANT_LABEL_MAX),
      value: team.id,
      description: clip(
        `v${latest.version}${latest.isLate ? ' LATE' : ''} · ${mine ? `your score ${formatScore(mine.overallScore)}` : 'not scored by you'}`,
        PARTICIPANT_LABEL_MAX,
      ),
    };
  });
  await h.respond({
    embeds: [
      panel({
        kicker: `EVALUATION ${GLYPH.dot} ${view.ref}`,
        title: 'Choose a team',
        description: 'Score every criterion 0–10. Late work is flagged; judge it — there is no automatic penalty.',
        color: COLORS.base,
      }),
    ],
    components: [row(stringSelect(trialsId(STAFF_ACTIONS.evaluateTeam, trialId), 'Team to score', options))],
    ephemeral: true,
  });
}

export async function openEvaluationModal(h: HandlerContext, trialId: string): Promise<void> {
  const teamId = h.interaction.values[0] ?? '';
  const view = await trials.getTrialForStaff(h.ctx, { trialId });
  const team = view.teams.find((candidate) => candidate.id === teamId);
  if (!team) throw new ValidationError('Choose a team of this trial.');
  if (view.rubric.length > QUICK_EVALUATION_MAX_CRITERIA)
    throw new ValidationError('This rubric is scored in the dashboard.');
  const me = requireUser(h.ctx).userId;
  const mine = team.evaluations.find((e) => e.memberId === null && e.evaluatorUserId === me);
  await h.interaction.showModal(
    evaluationModal({
      trialId,
      teamId: team.id,
      teamName: team.name,
      rubric: view.rubric,
      previous: mine?.scores ?? null,
      previousNotes: mine?.notes ?? null,
    }),
  );
}

export async function submitEvaluation(h: HandlerContext, trialId: string, teamId: string): Promise<void> {
  const view = await trials.getTrialForStaff(h.ctx, { trialId });
  if (view.rubric.length > QUICK_EVALUATION_MAX_CRITERIA)
    throw new ValidationError('This rubric is scored in the dashboard.');
  const scores: Record<string, number> = {};
  view.rubric.forEach((criterion, index) => {
    scores[criterion.key] = requiredWholeNumber(
      h.interaction.modal.text(`${FIELDS.scorePrefix}${index}`),
      criterion.label,
    );
  });
  const notes = h.interaction.modal.text(FIELDS.notes).trim();
  const receipt = await trials.evaluate(h.ctx, { trialId, teamId, scores, notes: notes || undefined });
  const team = view.teams.find((candidate) => candidate.id === teamId);
  await h.respond({
    embeds: [
      success(
        'Evaluation recorded',
        `${userText(team?.name ?? 'Team', NAME_MAX)} ${GLYPH.dot} ${formatScore(receipt.overallScore)} weighted.\nRe-scoring replaces your earlier evaluation of this team.`,
      ),
    ],
    components: [row(button('Control panel', trialsId(STAFF_ACTIONS.panel, trialId)))],
    ephemeral: true,
  });
}
