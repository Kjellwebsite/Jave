import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { auditLogs } from '@jave/database';
import {
  ConflictError,
  ForbiddenError,
  InvalidStateError,
  ValidationError,
} from '../kernel/errors';
import { updateSettings } from '../settings/settings.service';
import { createTestKit, type TestKit } from '../testing';
import {
  createTemplate,
  createTrial,
  deactivateTemplate,
  getTemplate,
  listTemplates,
  seedStarterTemplates,
  updateTemplate,
} from './index';
import { PGLITE_HOOK_TIMEOUT_MS, PGLITE_SUITE } from './testing/fixtures';

const TEMPLATE = {
  key: 'field-recon',
  title: 'Field Recon',
  category: 'investigation' as const,
  summary: 'Find out what really happened, from public evidence only.',
  brief: 'MISSION\nReconstruct the timeline of a public event from open sources. Cite everything.',
  durationMinutes: 240,
  teamSizeMin: 2,
  teamSizeMax: 3,
  facetKeys: ['mind.research'],
  rubric: [
    { key: 'accuracy', label: 'Accuracy', description: 'Claims match the evidence.', weight: 3 },
    { key: 'sourcing', label: 'Sourcing', weight: 2 },
  ],
};

describe('trials: templates', PGLITE_SUITE, () => {
  let kit: TestKit;
  beforeEach(async () => {
    kit = await createTestKit();
  }, PGLITE_HOOK_TIMEOUT_MS);
  afterEach(async () => {
    await kit.close();
  }, PGLITE_HOOK_TIMEOUT_MS);

  it('creates, updates, lists and deactivates templates with an audit trail', async () => {
    const ops = await kit.member({ roles: ['operations'] });
    const created = await createTemplate(kit.as(ops), TEMPLATE);
    expect(created).toMatchObject({ key: 'field-recon', active: true, teamSizeMin: 2 });
    expect(created.rubric[1]).toEqual({
      key: 'sourcing',
      label: 'Sourcing',
      description: '',
      weight: 2,
    });

    // Partial updates never reset unspecified fields to defaults.
    const updated = await updateTemplate(kit.as(ops), {
      templateId: created.id,
      title: 'Field Recon II',
    });
    expect(updated).toMatchObject({ title: 'Field Recon II', teamSizeMin: 2, teamSizeMax: 3 });
    expect(updated.facetKeys).toEqual(['mind.research']);

    await expect(
      updateTemplate(kit.as(ops), { templateId: created.id, teamSizeMin: 5 }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(createTemplate(kit.as(ops), TEMPLATE)).rejects.toBeInstanceOf(ConflictError);

    const deactivated = await deactivateTemplate(kit.as(ops), { templateId: created.id });
    expect(deactivated.active).toBe(false);
    expect(await listTemplates(kit.as(ops))).toEqual([]);
    expect(await listTemplates(kit.as(ops), { includeInactive: true })).toHaveLength(1);
    await expect(createTrial(kit.as(ops), { templateId: created.id })).rejects.toBeInstanceOf(
      InvalidStateError,
    );
    await updateTemplate(kit.as(ops), { templateId: created.id, active: true });
    expect((await getTemplate(kit.as(ops), { templateId: created.id })).active).toBe(true);

    const actions = (
      await kit.db.select().from(auditLogs).where(eq(auditLogs.targetId, created.id))
    ).map((row) => row.action);
    expect(actions).toEqual([
      'trial.template_created',
      'trial.template_updated',
      'trial.template_deactivated',
      'trial.template_updated',
    ]);
  });

  it('snapshots the template into a trial; team size is clamped to the template range', async () => {
    const ops = await kit.member({ roles: ['operations'] });
    await updateSettings(kit.system, 'trials', { defaultTeamSize: 6 });
    const template = await createTemplate(kit.as(ops), TEMPLATE);
    const trial = await createTrial(kit.as(ops), { templateId: template.id });
    expect(trial).toMatchObject({
      title: 'Field Recon',
      category: 'investigation',
      teamSize: 3,
      durationMinutes: 240,
      facetKeys: ['mind.research'],
    });
    await updateTemplate(kit.as(ops), { templateId: template.id, durationMinutes: 30 });
    expect(trial.durationMinutes).toBe(240);
  });

  it('BREAK: template management requires canManageTrials', async () => {
    const verified = await kit.member({ roles: ['verified'] });
    const mod = await kit.member({ roles: ['moderator'] });
    for (const actor of [verified, mod]) {
      await expect(createTemplate(kit.as(actor), TEMPLATE)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(listTemplates(kit.as(actor))).rejects.toBeInstanceOf(ForbiddenError);
      await expect(seedStarterTemplates(kit.as(actor))).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it('BREAK: facet keys are checked against the live catalog', async () => {
    const ops = await kit.member({ roles: ['operations'] });
    await expect(
      createTemplate(kit.as(ops), { ...TEMPLATE, facetKeys: ['mind.research', 'mind.psychic'] }),
    ).rejects.toThrow('Unknown capability facet "mind.psychic"');
    await expect(
      createTemplate(kit.as(ops), { ...TEMPLATE, facetKeys: ['mind.research', 'mind.research'] }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createTemplate(kit.as(ops), {
        ...TEMPLATE,
        facetKeys: ['mind.research', 'mind.reasoning', 'create.technical', 'life.business'],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('BREAK: rubric rules are enforced by the service, not just the UI', async () => {
    const ops = await kit.member({ roles: ['operations'] });
    const bad = [
      [],
      Array.from({ length: 11 }, (_, i) => ({ key: `c${i}x`, label: 'Criterion', weight: 1 })),
      [{ key: 'a1', label: 'A', weight: 0 }],
      [{ key: 'a1', label: '', weight: 1 }],
      [{ key: '__proto__', label: 'Proto', weight: 1 }],
    ];
    for (const rubric of bad) {
      await expect(
        createTemplate(kit.as(ops), { ...TEMPLATE, key: 'bad-rubric', rubric }),
      ).rejects.toBeInstanceOf(ValidationError);
    }
  });
});
