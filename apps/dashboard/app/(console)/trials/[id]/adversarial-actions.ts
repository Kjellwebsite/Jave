'use server';

import { revalidatePath } from 'next/cache';
import { adversarial, isUuid, trials, ValidationError } from '@jave/core';
import type { ActionState } from '@/lib/action-state';
import { formBoolean, formEnum, formOptional, formString } from '@/lib/form-data';
import { formInteger, formZonedDate } from '@/lib/trial-form';
import { runAction } from '@/server/actions';
import type { UserContext } from '@/server/context';
import { loadViewer } from '@/server/data/viewer';

/**
 * Adversarial exercise controls (SANDBOX — FICTIONAL DATA ONLY). Every
 * operation is authorized by the adversarial service: canManageAdversarial,
 * the two-person rule, conflict of interest, the kill switch and the safety
 * validator all live there.
 */

const ATTESTATION_REQUIRED =
  'Attest that the scenario uses only fictional data and sandbox accounts.';

const OUTCOMES = ['resisted', 'detected', 'reported', 'partial', 'failure'] as const;
const TECHNIQUES = [
  'social_engineering',
  'instruction_integrity',
  'permission_hygiene',
  'data_handling',
  'verification_discipline',
] as const;

function uuidField(data: FormData, name: string, what: string): string {
  const value = formString(data, name);
  if (!isUuid(value))
    throw new ValidationError(`Choose ${what}.`, [{ path: name, message: `Choose ${what}.` }]);
  return value;
}

function optionalUuid(data: FormData, name: string): string | undefined {
  const value = formOptional(data, name);
  return value && isUuid(value) ? value : undefined;
}

function refresh(data: FormData): void {
  const trialId = formString(data, 'trialId');
  if (isUuid(trialId)) revalidatePath(`/trials/${trialId}`);
}

function roleAction(
  name: string,
  work: (ctx: UserContext, roleId: string) => Promise<string>,
  fieldNames: readonly string[] = [],
) {
  return (data: FormData) =>
    runAction(
      name,
      async (ctx) => {
        const message = await work(ctx, uuidField(data, 'roleId', 'a role'));
        refresh(data);
        return message;
      },
      { fieldNames },
    );
}

// ─── Trial switch ────────────────────────────────────────────────────────────

export async function setTrialAdversarialAction(
  _: ActionState,
  data: FormData,
): Promise<ActionState> {
  return runAction('adversarial.trial_toggle', async (ctx) => {
    const trialId = uuidField(data, 'trialId', 'a trial');
    const enabled = formString(data, 'enabled') === 'true';
    await trials.setAdversarialEnabled(ctx, { trialId, enabled });
    refresh(data);
    return enabled
      ? 'ADVERSARIAL ROLES ENABLED — plan a role under two-person authorization.'
      : 'ADVERSARIAL ROLES DISABLED for this trial.';
  });
}

// ─── Roles ───────────────────────────────────────────────────────────────────

export async function planRoleAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction(
    'adversarial.plan',
    async (ctx) => {
      const [teamId, operativeMemberId] = formString(data, 'operative').split(':');
      if (!teamId || !operativeMemberId || !isUuid(teamId) || !isUuid(operativeMemberId))
        throw new ValidationError('Choose the operative.', [
          { path: 'operative', message: 'Choose the operative.' },
        ]);
      await adversarial.planRole(ctx, {
        trialId: uuidField(data, 'trialId', 'a trial'),
        teamId,
        operativeMemberId,
        scenarioId: uuidField(data, 'scenarioId', 'a scenario'),
        objective: formOptional(data, 'objective'),
      });
      refresh(data);
      return 'ROLE PLANNED — a second authorizer must approve it before any briefing.';
    },
    { fieldNames: ['operative', 'scenarioId', 'objective'] },
  );
}

export async function authorizeRoleAction(_: ActionState, data: FormData): Promise<ActionState> {
  return roleAction(
    'adversarial.authorize',
    async (ctx, roleId) => {
      if (!formBoolean(data, 'sandboxAttested'))
        throw new ValidationError(ATTESTATION_REQUIRED, [
          { path: 'sandboxAttested', message: ATTESTATION_REQUIRED },
        ]);
      await adversarial.authorizeRole(ctx, {
        roleId,
        sandboxAttested: true,
        note: formOptional(data, 'note'),
      });
      return 'ROLE AUTHORIZED — second person recorded. Ready to brief.';
    },
    ['sandboxAttested', 'note'],
  )(data);
}

export async function briefRoleAction(_: ActionState, data: FormData): Promise<ActionState> {
  return roleAction('adversarial.brief', async (ctx, roleId) => {
    await adversarial.briefRole(ctx, { roleId });
    return 'OPERATIVE BRIEFED — the briefing is on its way by DM.';
  })(data);
}

export async function activateRoleAction(_: ActionState, data: FormData): Promise<ActionState> {
  return roleAction('adversarial.activate', async (ctx, roleId) => {
    await adversarial.activateRole(ctx, { roleId });
    return 'EXERCISE ACTIVE — observe and record.';
  })(data);
}

export async function concludeRoleAction(_: ActionState, data: FormData): Promise<ActionState> {
  return roleAction('adversarial.conclude', async (ctx, roleId) => {
    await adversarial.concludeRole(ctx, { roleId });
    return 'EXERCISE CONCLUDED — evaluate, then reveal after the trial ends.';
  })(data);
}

export async function abortRoleAction(_: ActionState, data: FormData): Promise<ActionState> {
  return roleAction(
    'adversarial.abort',
    async (ctx, roleId) => {
      await adversarial.abortRole(ctx, { roleId, reason: formString(data, 'reason') });
      return 'EXERCISE STOPPED — the operative receives an immediate STOP.';
    },
    ['reason'],
  )(data);
}

export async function addTriggerAction(_: ActionState, data: FormData): Promise<ActionState> {
  return roleAction(
    'adversarial.add_trigger',
    async (ctx, roleId) => {
      const { timeZone } = await loadViewer(ctx);
      await adversarial.addTrigger(ctx, {
        roleId,
        label: formString(data, 'label'),
        description: formString(data, 'description'),
        plannedFor: formZonedDate(data, 'plannedFor', timeZone) ?? undefined,
      });
      return 'TRIGGER ADDED.';
    },
    ['label', 'description', 'plannedFor'],
  )(data);
}

export async function recordObservationAction(
  _: ActionState,
  data: FormData,
): Promise<ActionState> {
  return roleAction(
    'adversarial.observe',
    async (ctx, roleId) => {
      const outcome = formEnum(data, 'outcome', OUTCOMES);
      if (!outcome)
        throw new ValidationError('Choose an outcome.', [
          { path: 'outcome', message: 'Choose an outcome.' },
        ]);
      await adversarial.recordObservation(ctx, {
        roleId,
        outcome,
        description: formString(data, 'description'),
        triggerId: optionalUuid(data, 'triggerId'),
      });
      return `OBSERVATION RECORDED — ${adversarial.OUTCOME_LABELS[outcome].toUpperCase()}.`;
    },
    ['outcome', 'description', 'triggerId'],
  )(data);
}

export async function evaluateRoleAction(_: ActionState, data: FormData): Promise<ActionState> {
  return roleAction(
    'adversarial.evaluate',
    async (ctx, roleId) => {
      const result = await adversarial.evaluateRole(ctx, {
        roleId,
        score: formInteger(data, 'score'),
        justification: formOptional(data, 'justification'),
        summary: formString(data, 'summary'),
        debrief: formOptional(data, 'debrief'),
      });
      return `EXERCISE EVALUATED — security culture ${result.evaluation.securityCultureScore}/10.`;
    },
    ['score', 'justification', 'summary', 'debrief'],
  )(data);
}

export async function revealRoleAction(_: ActionState, data: FormData): Promise<ActionState> {
  return roleAction('adversarial.reveal', async (ctx, roleId) => {
    await adversarial.revealRole(ctx, { roleId });
    return 'EXERCISE REVEALED — the team receives the debrief.';
  })(data);
}

// ─── Scenario library ────────────────────────────────────────────────────────

function scenarioFields(data: FormData) {
  return {
    title: formString(data, 'title'),
    technique: formEnum(data, 'technique', TECHNIQUES),
    description: formString(data, 'description'),
    objective: formString(data, 'objective'),
    guardrails: formString(data, 'guardrails'),
    sandboxAssets: formString(data, 'sandboxAssets'),
  };
}

const SCENARIO_FIELDS = [
  'key',
  'title',
  'technique',
  'description',
  'objective',
  'guardrails',
  'sandboxAssets',
];

export async function createScenarioAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction(
    'adversarial.scenario_create',
    async (ctx) => {
      const fields = scenarioFields(data);
      if (!fields.technique)
        throw new ValidationError('Choose a technique.', [
          { path: 'technique', message: 'Choose a technique.' },
        ]);
      const scenario = await adversarial.createScenario(ctx, {
        ...fields,
        technique: fields.technique,
        key: formString(data, 'key'),
      });
      refresh(data);
      return `SCENARIO ADDED — ${scenario.title}.`;
    },
    { fieldNames: SCENARIO_FIELDS },
  );
}

export async function updateScenarioAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction(
    'adversarial.scenario_update',
    async (ctx) => {
      const scenario = await adversarial.updateScenario(ctx, {
        scenarioId: uuidField(data, 'scenarioId', 'a scenario'),
        ...scenarioFields(data),
        active: data.has('activeShown') ? formBoolean(data, 'active') : undefined,
      });
      refresh(data);
      return `SCENARIO SAVED — ${scenario.title}.`;
    },
    { fieldNames: SCENARIO_FIELDS },
  );
}

export async function deleteScenarioAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction('adversarial.scenario_delete', async (ctx) => {
    await adversarial.deleteScenario(ctx, {
      scenarioId: uuidField(data, 'scenarioId', 'a scenario'),
    });
    refresh(data);
    return 'SCENARIO DELETED.';
  });
}

export async function seedScenariosAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction('adversarial.scenarios_seed', async (ctx) => {
    const result = await adversarial.seedStarterScenarios(ctx);
    refresh(data);
    return result.created.length > 0
      ? `STARTER SCENARIOS INSTALLED — ${result.created.length} added. All fictional.`
      : 'Starter scenarios already installed. Nothing changed.';
  });
}
