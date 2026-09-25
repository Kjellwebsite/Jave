import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { adversarialRoles, members, notifications, trialParticipants } from '@jave/database';
import { ForbiddenError, NotFoundError } from '../kernel/errors';
import { resolveUserActor } from '../identity/users.service';
import type { UserActor } from '../permissions/actor';
import { createTestKit, type TestKit } from '../testing';
import { createEventHandlers } from '../events/bus';
import { enqueueJob } from '../jobs/queue';
import { jobHandlers, subscribers } from './index';
import { ADVERSARIAL_SWEEP_JOB } from './lifecycle';
import { fireTrigger, addTrigger } from './observations.service';
import { getMyBriefing, getRole, listMyBriefings, listRoles } from './queries.service';
import { planRole, raiseRedFlag } from './roles.service';
import {
  type AdversarialFixture,
  memberIdOf,
  planDefault,
  runToActive,
  setupAdversarial,
  INTEGRATION_TIMEOUT_MS,
} from './test-fixtures';

vi.setConfig({ testTimeout: INTEGRATION_TIMEOUT_MS, hookTimeout: INTEGRATION_TIMEOUT_MS });
describe('adversarial conflict of interest and standing', () => {
  let kit: TestKit;
  let fx: AdversarialFixture;
  beforeEach(async () => {
    kit = await createTestKit();
    fx = await setupAdversarial(kit);
  });
  afterEach(async () => {
    await kit.close();
  });

  /** A core staff member competing in the trial on team B. */
  async function coreParticipant(): Promise<UserActor> {
    const core = await kit.member({ roles: ['core'] });
    await kit.db.insert(trialParticipants).values({
      trialId: fx.trialId,
      memberId: memberIdOf(core),
      status: 'selected',
      teamId: fx.teamBId,
    });
    return core;
  }

  const quarantine = async (actor: UserActor) => {
    await kit.db
      .update(members)
      .set({ standing: 'quarantined' })
      .where(eq(members.id, memberIdOf(actor)));
    return resolveUserActor(kit.system, actor.userId);
  };

  it('BREAK: staff competing in a trial learn nothing about its roles', async () => {
    const insider = await coreParticipant();
    const role = await planDefault(fx);
    const ctx = kit.as(insider);

    const inbox = await kit.db
      .select()
      .from(notifications)
      .where(eq(notifications.recipientUserId, insider.userId));
    expect(inbox).toHaveLength(0);
    expect((await listRoles(ctx, { trialId: fx.trialId })).items).toHaveLength(0);
    expect((await listRoles(ctx)).total).toBe(0);
    await expect(getRole(ctx, { roleId: role.id })).rejects.toBeInstanceOf(NotFoundError);
    await expect(raiseRedFlag(ctx, { roleId: role.id })).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      planRole(ctx, {
        trialId: fx.trialId,
        teamId: fx.teamAId,
        operativeMemberId: memberIdOf(fx.operative),
        scenarioId: fx.scenarioId,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    // Other staff still see it.
    expect((await listRoles(kit.as(fx.authorizer), { trialId: fx.trialId })).total).toBe(1);
  });

  it('BREAK: RED FLAG alerts skip staff who compete in the trial', async () => {
    const insider = await coreParticipant();
    const role = await runToActive(fx);
    await raiseRedFlag(kit.as(fx.operative), { roleId: role.id });
    const alerts = async (userId: string) =>
      (
        await kit.db.select().from(notifications).where(eq(notifications.recipientUserId, userId))
      ).filter((n) => n.type === 'adversarial.alert');
    expect(await alerts(fx.founder.userId)).toHaveLength(1);
    expect(await alerts(insider.userId)).toHaveLength(0);
  });

  it('BREAK: a quarantined operative loses the briefing and triggers, but can still raise RED FLAG', async () => {
    const role = await runToActive(fx);
    const trigger = await addTrigger(kit.as(fx.founder), {
      roleId: role.id,
      label: 'Ask',
      description: 'Ask for the sandbox deploy key.',
    });
    const suspended = kit.as(await quarantine(fx.operative));
    expect(await listMyBriefings(suspended)).toEqual([]);
    await expect(getMyBriefing(suspended, { roleId: role.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      fireTrigger(suspended, { roleId: role.id, triggerId: trigger.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(raiseRedFlag(suspended, { roleId: role.id })).resolves.toMatchObject({
      status: 'aborted',
      alreadyStopped: false,
    });
  });

  it('the sweep aborts live roles whose operative lost eligibility', async () => {
    const role = await runToActive(fx);
    await quarantine(fx.operative);
    await enqueueJob(kit.system, ADVERSARIAL_SWEEP_JOB, {}, { dedupeKey: 'sweep-eligibility' });
    await kit.drain({ ...jobHandlers, ...createEventHandlers(subscribers) });
    const [row] = await kit.db
      .select()
      .from(adversarialRoles)
      .where(eq(adversarialRoles.id, role.id));
    expect(row!.status).toBe('aborted');
    expect(row!.abortReason).toBe('Operative no longer eligible.');
    expect(row!.stopNoticeDelivery).toBe('pending');
  });
});
