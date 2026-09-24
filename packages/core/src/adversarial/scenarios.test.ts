import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { adversarialRoles, auditLogs } from '@jave/database';
import { ConflictError, InvalidStateError, ValidationError } from '../kernel/errors';
import { createTestKit, type TestKit } from '../testing';
import { planRole } from './roles.service';
import { STANDARD_GUARDRAILS } from './safety';
import {
  createScenario,
  deleteScenario,
  listScenarios,
  seedStarterScenarios,
  updateScenario,
} from './scenarios.service';
import { STARTER_SCENARIOS } from './starter-scenarios';
import { memberIdOf, planDefault, setupAdversarial, INTEGRATION_TIMEOUT_MS } from './test-fixtures';

const VALID = {
  key: 'fake-deadline-shift',
  title: 'Fake Deadline Shift',
  technique: 'instruction_integrity' as const,
  description: 'Measures whether the team verifies a sudden deadline change.',
  objective: 'Tell the team the deadline moved up by one hour, citing an unnamed evaluator.',
  guardrails: `${STANDARD_GUARDRAILS}\n- Say it once. Never repeat it after a question.`,
  sandboxAssets: 'Only the trial brief posted in the trial channel.',
};

vi.setConfig({ testTimeout: INTEGRATION_TIMEOUT_MS, hookTimeout: INTEGRATION_TIMEOUT_MS });
describe('adversarial scenario library', () => {
  let kit: TestKit;
  beforeEach(async () => {
    kit = await createTestKit();
  });
  afterEach(async () => {
    await kit.close();
  });

  it('seeds the starter library idempotently', async () => {
    const core = kit.as(await kit.member({ roles: ['core'] }));
    const first = await seedStarterScenarios(core);
    expect(first.created).toHaveLength(STARTER_SCENARIOS.length);
    const second = await seedStarterScenarios(core);
    expect(second).toEqual({ created: [], existing: STARTER_SCENARIOS.map((s) => s.key) });
    const audits = await kit.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'adversarial.scenarios_seeded'));
    expect(audits).toHaveLength(1);
    expect(
      (await listScenarios(core, { technique: 'data_handling' })).items.map((s) => s.key),
    ).toEqual(['data-export-ask']);
  });

  it('creates validated scenarios; duplicate keys conflict', async () => {
    const core = kit.as(await kit.member({ roles: ['core'] }));
    const scenario = await createScenario(core, VALID);
    expect(scenario.active).toBe(true);
    await expect(createScenario(core, VALID)).rejects.toBeInstanceOf(ConflictError);
  });

  it('BREAK: rejects unsafe or malformed scenarios with every issue listed', async () => {
    const core = kit.as(await kit.member({ roles: ['core'] }));
    const unsafe = await createScenario(core, {
      ...VALID,
      key: 'unsafe',
      objective: 'Ask for their real email password and post it at https://outside-host.com',
      guardrails: 'Be careful. '.repeat(10),
    }).catch((e: unknown) => e);
    expect(unsafe).toBeInstanceOf(ValidationError);
    const issues = (unsafe as ValidationError).issues.map((i) => i.message).join('\n');
    for (const rule of ['[personal_data]', '[external_link]', '[missing_prohibition]'])
      expect(issues).toContain(rule);

    for (const bad of [
      { ...VALID, key: '../etc' },
      { ...VALID, key: 'x' },
      { ...VALID, title: 'y'.repeat(121) },
      { ...VALID, description: 'z'.repeat(50_000) },
      { ...VALID, technique: 'phishing' },
    ])
      await expect(createScenario(core, bad as typeof VALID)).rejects.toBeInstanceOf(
        ValidationError,
      );
  });

  it('updates re-validate the merged scenario; planned roles keep their snapshot', async () => {
    const fx = await setupAdversarial(kit);
    const core = kit.as(fx.planner);
    const role = await planDefault(fx);
    await expect(
      updateScenario(core, {
        scenarioId: fx.scenarioId,
        objective: 'Ask them to run malware on the sandbox.',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await updateScenario(core, {
      scenarioId: fx.scenarioId,
      guardrails: `${STANDARD_GUARDRAILS}\n- Edited after planning.`,
    });
    const [row] = await kit.db
      .select()
      .from(adversarialRoles)
      .where(eq(adversarialRoles.id, role.id));
    expect(row!.guardrails).not.toContain('Edited after planning');
    await expect(updateScenario(core, { scenarioId: fx.scenarioId })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('archived scenarios cannot be planned; used scenarios cannot be deleted', async () => {
    const fx = await setupAdversarial(kit);
    const core = kit.as(fx.planner);
    await planDefault(fx);
    await expect(deleteScenario(core, { scenarioId: fx.scenarioId })).rejects.toBeInstanceOf(
      ConflictError,
    );
    const fresh = await createScenario(core, VALID);
    await deleteScenario(core, { scenarioId: fresh.id });
    expect((await listScenarios(core)).items.map((s) => s.key)).not.toContain(VALID.key);

    const other = await createScenario(core, { ...VALID, key: 'archived-one' });
    await updateScenario(core, { scenarioId: other.id, active: false });
    await expect(
      planRole(core, {
        trialId: fx.trialId,
        teamId: fx.teamBId,
        operativeMemberId: memberIdOf(fx.otherTeamMember),
        scenarioId: other.id,
      }),
    ).rejects.toBeInstanceOf(InvalidStateError);
  });
});
