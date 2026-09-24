import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  adversarialEvaluations,
  adversarialRoles,
  adversarialScenarios,
  auditLogs,
  notifications,
} from '@jave/database';
import { ConflictError } from '../kernel/errors';
import { createTestKit, type TestKit } from '../testing';
import { loadDebrief } from './delivery.service';
import { evaluateRole, revealRole } from './evaluation.service';
import { recordObservation } from './observations.service';
import { concludeRole, planRole } from './roles.service';
import { deleteScenario, getScenario, listScenarios } from './scenarios.service';
import { suggestScore } from './scoring';
import {
  type AdversarialFixture,
  INTEGRATION_TIMEOUT_MS,
  interleaveBeforeTransaction,
  memberIdOf,
  runToActive,
  setTrialStatus,
  setupAdversarial,
} from './test-fixtures';

const FIRST_DEBRIEF = 'First draft: you resisted the request. Report it next time.';
const SECOND_DEBRIEF = 'Final: you resisted and one of you reported it. Well handled.';

vi.setConfig({ testTimeout: INTEGRATION_TIMEOUT_MS, hookTimeout: INTEGRATION_TIMEOUT_MS });
describe('adversarial hardening', () => {
  let kit: TestKit;
  let fx: AdversarialFixture;
  beforeEach(async () => {
    kit = await createTestKit();
    fx = await setupAdversarial(kit);
  });
  afterEach(async () => {
    await kit.close();
  });

  const planInput = () => ({
    trialId: fx.trialId,
    teamId: fx.teamAId,
    operativeMemberId: memberIdOf(fx.operative),
    scenarioId: fx.scenarioId,
  });

  async function countRows() {
    const scenarios = await kit.db
      .select({ id: adversarialScenarios.id })
      .from(adversarialScenarios)
      .where(eq(adversarialScenarios.id, fx.scenarioId));
    const roles = await kit.db
      .select({ id: adversarialRoles.id })
      .from(adversarialRoles)
      .where(eq(adversarialRoles.scenarioId, fx.scenarioId));
    return { scenarios: scenarios.length, roles: roles.length };
  }

  async function concludedWithObservation() {
    const role = await runToActive(fx);
    await recordObservation(kit.as(fx.planner), {
      roleId: role.id,
      outcome: 'resisted',
      description: 'Declined to paste the key.',
    });
    await concludeRole(kit.as(fx.planner), { roleId: role.id });
    return role;
  }

  it('scenario library reads are audited', async () => {
    const staff = kit.as(fx.planner);
    const [scenario] = (await listScenarios(staff, { technique: 'social_engineering' })).items;
    await getScenario(staff, { scenarioId: scenario!.id });
    const actions = await kit.db
      .select({ action: auditLogs.action, targetId: auditLogs.targetId })
      .from(auditLogs)
      .where(eq(auditLogs.actorUserId, fx.planner.userId));
    expect(actions).toEqual(
      expect.arrayContaining([
        { action: 'adversarial.scenarios_listed', targetId: null },
        { action: 'adversarial.scenario_viewed', targetId: scenario!.id },
      ]),
    );
  });

  it('BREAK: a scenario deleted mid-plan fails the plan cleanly, never with a database error', async () => {
    const planner = interleaveBeforeTransaction(kit.as(fx.planner), () =>
      deleteScenario(kit.as(fx.authorizer), { scenarioId: fx.scenarioId }),
    );
    await expect(planRole(planner, planInput())).rejects.toBeInstanceOf(ConflictError);
    expect(await countRows()).toEqual({ scenarios: 0, roles: 0 });
  });

  it('BREAK: a role planned mid-delete keeps its scenario', async () => {
    const deleter = interleaveBeforeTransaction(kit.as(fx.authorizer), () =>
      planRole(kit.as(fx.planner), planInput()),
    );
    await expect(deleteScenario(deleter, { scenarioId: fx.scenarioId })).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(await countRows()).toEqual({ scenarios: 1, roles: 1 });
  });

  it('BREAK: a re-evaluation landing mid-reveal never splits the debrief between notification and post', async () => {
    const role = await concludedWithObservation();
    await setTrialStatus(kit, fx.trialId, 'completed');
    await evaluateRole(kit.as(fx.authorizer), {
      roleId: role.id,
      summary: 'Resisted, did not report.',
      debrief: FIRST_DEBRIEF,
    });
    const revealer = interleaveBeforeTransaction(kit.as(fx.planner), () =>
      evaluateRole(kit.as(fx.founder), {
        roleId: role.id,
        summary: 'Resisted; one report came in late.',
        debrief: SECOND_DEBRIEF,
      }),
    );
    await revealRole(revealer, { roleId: role.id });

    const posted = (await loadDebrief(kit.system, { roleId: role.id })).debrief.debrief;
    expect(posted).toBe(SECOND_DEBRIEF);
    for (const mate of fx.teammates) {
      const [notice] = await kit.db
        .select({ body: notifications.body })
        .from(notifications)
        .where(
          and(
            eq(notifications.recipientUserId, mate.userId),
            eq(notifications.type, 'adversarial.revealed'),
          ),
        );
      expect(notice!.body).toContain(SECOND_DEBRIEF);
      expect(notice!.body).not.toContain(FIRST_DEBRIEF);
    }
  });

  it('BREAK: an observation landing mid-evaluation is reflected in the stored suggestion', async () => {
    const role = await concludedWithObservation();
    const evaluator = interleaveBeforeTransaction(kit.as(fx.authorizer), () =>
      recordObservation(kit.as(fx.founder), {
        roleId: role.id,
        outcome: 'failure',
        description: 'A teammate pasted the sandbox key.',
      }),
    );
    // The evaluator accepts the suggestion: it must include the late failure.
    const result = await evaluateRole(evaluator, {
      roleId: role.id,
      summary: 'One resisted, one complied.',
    });
    const expected = suggestScore(['resisted', 'failure']);
    expect(result.suggestedScore).toBe(expected);
    const [stored] = await kit.db
      .select()
      .from(adversarialEvaluations)
      .where(eq(adversarialEvaluations.roleId, role.id));
    expect(stored!.suggestedScore).toBe(expected);
    expect(stored!.securityCultureScore).toBe(expected);
    expect(stored!.overrideJustification).toBeNull();
  });
});
