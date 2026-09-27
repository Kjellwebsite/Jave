'use server';

import { revalidatePath } from 'next/cache';
import { isUuid, trials, ValidationError } from '@jave/core';
import type { ActionState } from '@/lib/action-state';
import { formBoolean, formEnum, formOptional, formString, formStrings } from '@/lib/form-data';
import {
  formFacetKeys,
  formInteger,
  formRubric,
  formScores,
  formZonedDate,
  requiredInteger,
} from '@/lib/trial-form';
import { runAction } from '@/server/actions';
import type { UserContext } from '@/server/context';
import { loadViewer } from '@/server/data/viewer';

const STRATEGIES = ['balanced', 'random'] as const;

function uuidField(data: FormData, name: string, what: string): string {
  const value = formString(data, name);
  if (!isUuid(value)) throw new ValidationError(`Unknown ${what}.`, [{ path: name, message: 'unknown' }]);
  return value;
}

const trialIdOf = (data: FormData) => uuidField(data, 'trialId', 'trial');

function refresh(trialId: string): void {
  revalidatePath(`/trials/${trialId}`);
  revalidatePath('/trials');
}

/** Run a trial mutation: parse the trial id, do the work, refresh the pages. */
function trialAction(
  name: string,
  work: (ctx: UserContext, trialId: string, data: FormData) => Promise<string>,
  fieldNames: readonly string[] = [],
) {
  return (data: FormData) =>
    runAction(
      name,
      async (ctx) => {
        const trialId = trialIdOf(data);
        const message = await work(ctx, trialId, data);
        refresh(trialId);
        return message;
      },
      { fieldNames },
    );
}

// ─── Edit ────────────────────────────────────────────────────────────────────

const sameInstant = (a: Date | null, b: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null);

export async function updateTrialAction(_: ActionState, data: FormData): Promise<ActionState> {
  return trialAction(
    'trial.update',
    async (ctx, trialId) => {
      const { timeZone } = await loadViewer(ctx);
      const current = await trials.getTrialForStaff(ctx, { trialId });
      // Dates are sent only when changed: an untouched past schedule must not be re-validated.
      const closes = data.has('recruitmentClosesAt')
        ? formZonedDate(data, 'recruitmentClosesAt', timeZone)
        : current.recruitmentClosesAt;
      const start = formZonedDate(data, 'scheduledStartAt', timeZone);
      const updated = await trials.updateTrial(ctx, {
        trialId,
        title: formString(data, 'title'),
        summary: formString(data, 'summary'),
        brief: formString(data, 'brief'),
        rubric: formRubric(data),
        facetKeys: formFacetKeys(data),
        durationMinutes: formInteger(data, 'durationMinutes'),
        teamSize: formInteger(data, 'teamSize'),
        maxParticipants: formInteger(data, 'maxParticipants') ?? null,
        ...(sameInstant(closes, current.recruitmentClosesAt) ? {} : { recruitmentClosesAt: closes }),
        ...(sameInstant(start, current.scheduledStartAt) ? {} : { scheduledStartAt: start }),
      });
      return `TRIAL SAVED — ${updated.ref}.`;
    },
    [
      'title',
      'summary',
      'brief',
      'rubric',
      'facetKeys',
      'durationMinutes',
      'teamSize',
      'maxParticipants',
      'recruitmentClosesAt',
      'scheduledStartAt',
    ],
  )(data);
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

export async function openRecruitmentAction(_: ActionState, data: FormData): Promise<ActionState> {
  return trialAction(
    'trial.open_recruitment',
    async (ctx, trialId) => {
      const { timeZone } = await loadViewer(ctx);
      const closes = formZonedDate(data, 'recruitmentClosesAt', timeZone);
      const trial = await trials.openRecruitment(ctx, {
        trialId,
        ...(closes ? { recruitmentClosesAt: closes } : {}),
      });
      return `RECRUITMENT OPEN — ${trial.ref}. The card is on its way to Discord.`;
    },
    ['recruitmentClosesAt'],
  )(data);
}

export async function startTrialAction(_: ActionState, data: FormData): Promise<ActionState> {
  return trialAction('trial.start', async (ctx, trialId) => {
    const trial = await trials.startTrial(ctx, { trialId });
    return `TRIAL LIVE — ${trial.ref}. Teams are being briefed.`;
  })(data);
}

export async function closeSubmissionsAction(_: ActionState, data: FormData): Promise<ActionState> {
  return trialAction('trial.close', async (ctx, trialId) => {
    const outcome = await trials.closeSubmissions(ctx, { trialId });
    return `SUBMISSIONS CLOSED — ${outcome.submittedTeams ?? 0} of ${outcome.teams ?? 0} teams submitted.`;
  })(data);
}

export async function extendDeadlineAction(_: ActionState, data: FormData): Promise<ActionState> {
  return trialAction(
    'trial.extend',
    async (ctx, trialId) => {
      const trial = await trials.extendDeadline(ctx, {
        trialId,
        minutes: requiredInteger(data, 'minutes'),
        reason: formString(data, 'reason'),
      });
      return `DEADLINE EXTENDED — ${trial.ref}. Competitors are notified.`;
    },
    ['minutes', 'reason'],
  )(data);
}

export async function cancelTrialAction(_: ActionState, data: FormData): Promise<ActionState> {
  return trialAction(
    'trial.cancel',
    async (ctx, trialId) => {
      const trial = await trials.cancelTrial(ctx, { trialId, reason: formString(data, 'reason') });
      return `TRIAL CANCELLED — ${trial.ref}. Stakeholders are notified.`;
    },
    ['reason'],
  )(data);
}

export async function reprovisionAction(_: ActionState, data: FormData): Promise<ActionState> {
  return trialAction('trial.reprovision', async (ctx, trialId) => {
    const { enqueued } = await trials.reprovisionTeams(ctx, { trialId });
    return `CHANNELS RE-SYNCING — ${enqueued} team channel(s) queued.`;
  })(data);
}

// ─── Roster ──────────────────────────────────────────────────────────────────

export async function selectRandomAction(_: ActionState, data: FormData): Promise<ActionState> {
  return trialAction(
    'trial.select_random',
    async (ctx, trialId) => {
      const result = await trials.selectParticipants(ctx, {
        mode: 'random',
        trialId,
        count: requiredInteger(data, 'count'),
        seed: formOptional(data, 'seed'),
      });
      return `PARTICIPANTS SELECTED — ${result.selectedMemberIds.length} of ${result.poolSize} eligible. Seed ${result.seed}.`;
    },
    ['count', 'seed'],
  )(data);
}

export async function selectManualAction(_: ActionState, data: FormData): Promise<ActionState> {
  return trialAction(
    'trial.select_manual',
    async (ctx, trialId) => {
      const memberIds = formStrings(data, 'memberIds').filter(isUuid);
      if (memberIds.length === 0)
        throw new ValidationError('Choose at least one applicant.', [
          { path: 'memberIds', message: 'Choose at least one applicant.' },
        ]);
      const result = await trials.selectParticipants(ctx, { mode: 'manual', trialId, memberIds });
      return `PARTICIPANTS SELECTED — ${result.selectedMemberIds.length} of ${result.poolSize} eligible.`;
    },
    ['memberIds'],
  )(data);
}

export async function assignTeamsAction(_: ActionState, data: FormData): Promise<ActionState> {
  return trialAction(
    'trial.assign',
    async (ctx, trialId) => {
      const result = await trials.assignTeams(ctx, {
        trialId,
        strategy: formEnum(data, 'strategy', STRATEGIES) ?? 'balanced',
        teamSize: formInteger(data, 'teamSize'),
        seed: formOptional(data, 'seed'),
      });
      const start =
        result.scheduledStart === 'passed'
          ? ' The scheduled start has passed — start by hand.'
          : result.scheduledStart === 'scheduled'
            ? ' It starts itself at the scheduled time.'
            : '';
      return `TEAMS ASSIGNED — ${result.teams.length} teams of ${result.teamSize}. Seed ${result.seed}.${start}`;
    },
    ['strategy', 'teamSize', 'seed'],
  )(data);
}

// ─── Evaluation & results ────────────────────────────────────────────────────

export async function evaluateAction(_: ActionState, data: FormData): Promise<ActionState> {
  return trialAction(
    'trial.evaluate',
    async (ctx, trialId) => {
      const view = await trials.getTrialForStaff(ctx, { trialId });
      const target = formString(data, 'target');
      const [kind, id] = target.split(':');
      if (!id || !isUuid(id) || (kind !== 'team' && kind !== 'member'))
        throw new ValidationError('Choose what you are scoring.', [
          { path: 'target', message: 'Choose a team or a participant.' },
        ]);
      const receipt = await trials.evaluate(ctx, {
        trialId,
        ...(kind === 'team' ? { teamId: id } : { memberId: id }),
        scores: formScores(
          data,
          view.rubric.map((criterion) => criterion.key),
        ),
        notes: formOptional(data, 'notes'),
      });
      return `EVALUATION RECORDED — ${receipt.overallScore.toFixed(2)} weighted.`;
    },
    ['target', 'scores', 'notes'],
  )(data);
}

export async function publishResultsAction(_: ActionState, data: FormData): Promise<ActionState> {
  return trialAction(
    'trial.publish',
    async (ctx, trialId) => {
      const results = await trials.publishResults(ctx, {
        trialId,
        acknowledgeIncomplete: formBoolean(data, 'acknowledgeIncomplete'),
      });
      const { counts } = results;
      return `RESULTS PUBLISHED — ${counts.distinction} distinction · ${counts.pass} pass · ${counts.fail} not passed · ${counts.incomplete} incomplete.`;
    },
    ['acknowledgeIncomplete'],
  )(data);
}

export async function applyRankAction(_: ActionState, data: FormData): Promise<ActionState> {
  return trialAction(
    'trial.apply_rank',
    async (ctx, trialId) => {
      const receipt = await trials.applyRankConsequence(ctx, {
        trialId,
        memberId: uuidField(data, 'memberId', 'member'),
        rank: formOptional(data, 'rank'),
        reason: formOptional(data, 'reason'),
      });
      revalidatePath(`/members/${receipt.memberId}`);
      return `RANK VERIFIED — ${receipt.facetKey.toUpperCase()} — ${receipt.rank}. Recorded as trial evidence.`;
    },
    ['rank', 'reason'],
  )(data);
}
