import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { members as membersTable, trials, trialTeams } from '@jave/database';
import { ForbiddenError, InvalidStateError } from '../kernel/errors';
import { createTestKit, type TestKit } from '../testing';
import { applyToTrial } from './participation.service';
import { assignTeams, previewTeams, selectParticipants } from './roster.service';
import {
  members as makeMembers,
  PGLITE_HOOK_TIMEOUT_MS,
  PGLITE_SUITE,
  recruitingTrial,
  STATEMENT,
} from './testing/fixtures';

vi.setConfig({ testTimeout: PGLITE_SUITE.timeout, hookTimeout: PGLITE_HOOK_TIMEOUT_MS });

describe('trials: team preview (dry run of assignTeams)', () => {
  let kit: TestKit;
  beforeEach(async () => {
    kit = await createTestKit();
  });
  afterEach(async () => {
    await kit.close();
  });

  async function selectedTrial(count: number) {
    const manager = await kit.member({ roles: ['operations'] });
    const people = [
      ...(await makeMembers(kit, count - 2)),
      ...(await makeMembers(kit, 2, ['verified'])),
    ];
    const trialId = await recruitingTrial(kit, manager, people);
    await selectParticipants(kit.as(manager), {
      trialId,
      mode: 'manual',
      memberIds: people.map((p) => p.memberId!),
    });
    return { manager, people, trialId };
  }

  it('previews exactly the teams the same seed assigns, and writes nothing', async () => {
    const { manager, trialId } = await selectedTrial(7);
    const preview = await previewTeams(kit.as(manager), {
      trialId,
      strategy: 'balanced',
      teamSize: 3,
      seed: 'preview-seed',
    });
    expect(preview.teams.map((team) => team.memberIds.length)).toEqual([4, 3]);
    expect(await kit.db.select().from(trialTeams)).toHaveLength(0);
    const [before] = await kit.db.select().from(trials).where(eq(trials.id, trialId));
    expect(before!.status).toBe('recruiting');

    const assigned = await assignTeams(kit.as(manager), {
      trialId,
      strategy: 'balanced',
      teamSize: 3,
      seed: preview.seed,
    });
    expect(
      assigned.teams.map(({ name, leadMemberId, memberIds }) => ({
        name,
        leadMemberId,
        memberIds,
      })),
    ).toEqual(
      preview.teams.map(({ name, leadMemberId, memberIds }) => ({ name, leadMemberId, memberIds })),
    );
  });

  it('generates a seed when none is given and reports members who would be removed', async () => {
    const { manager, people, trialId } = await selectedTrial(4);
    await kit.db
      .update(membersTable)
      .set({ standing: 'restricted' })
      .where(eq(membersTable.id, people[0]!.memberId!));
    const preview = await previewTeams(kit.as(manager), { trialId, strategy: 'random' });
    expect(preview.seed).toMatch(/^[0-9a-f]{24}$/);
    expect(preview.ineligibleMemberIds).toEqual([people[0]!.memberId]);
    expect(preview.teams.flatMap((team) => team.memberIds)).not.toContain(people[0]!.memberId);
  });

  it('BREAK: members, stakeholding staff and finished trials get no preview', async () => {
    const { manager, people, trialId } = await selectedTrial(4);
    await expect(
      previewTeams(kit.as(people[0]!), { trialId, strategy: 'random' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const stakeholder = await kit.member({ roles: ['operations'] });
    await applyToTrial(kit.as(stakeholder), { trialId, statement: STATEMENT });
    await expect(
      previewTeams(kit.as(stakeholder), { trialId, strategy: 'random' }),
    ).rejects.toThrow(/taking part/);
    await kit.db.update(trials).set({ status: 'completed' }).where(eq(trials.id, trialId));
    await expect(
      previewTeams(kit.as(manager), { trialId, strategy: 'random' }),
    ).rejects.toBeInstanceOf(InvalidStateError);
  });
});
