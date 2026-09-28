import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  adversarialRoles,
  members,
  notifications,
  trialParticipants,
  trials,
} from '@jave/database';
import { listAuditLogs, recordAudit } from '../audit/audit.service';
import { ForbiddenError, NotFoundError } from '../kernel/errors';
import { resolveUserActor } from '../identity/users.service';
import type { UserActor } from '../permissions/actor';
import { createTestKit, type TestKit } from '../testing';
import { createEventHandlers } from '../events/bus';
import { enqueueJob } from '../jobs/queue';
import { jobHandlers, subscribers } from './index';
import { OPERATIVE_AUDIT_REASON } from './guards';
import { ADVERSARIAL_SWEEP_JOB } from './lifecycle';
import { getMyBriefing, getRole, listMyBriefings, listRoles } from './queries.service';
import { raiseRedFlag } from './red-flag.service';
import { planRole } from './roles.service';
import { fireTrigger } from './triggers.service';
import {
  addApprovedTrigger,
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

  it('BREAK: the shared audit log never tells a competing staff member who operates where', async () => {
    const insider = await coreParticipant();
    const role = await runToActive(fx);
    const trigger = await addApprovedTrigger(fx, {
      roleId: role.id,
      label: 'Ask',
      description: 'Ask for the sandbox deploy key.',
    });
    const operative = kit.as(fx.operative);
    await getMyBriefing(operative, { roleId: role.id });
    await listMyBriefings(operative);
    await fireTrigger(operative, { roleId: role.id, triggerId: trigger.id });
    await listRoles(kit.as(fx.authorizer), { trialId: fx.trialId });
    await raiseRedFlag(operative, { roleId: role.id, note: 'Stopping here.' });

    const adversarialEntries = async (reader: UserActor) => [
      ...(await listAuditLogs(kit.as(reader), { action: 'adversarial.*', limit: 100 })).items,
      ...(await listAuditLogs(kit.as(reader), { targetType: 'adversarial_role', limit: 100 }))
        .items,
    ];
    // A competing staff member sees no adversarial entry at all.
    expect(await adversarialEntries(insider)).toHaveLength(0);
    // Staff entitled to adversarial records see them, and even they are not told
    // in the shared log who operates where before the reveal.
    const entries = await adversarialEntries(fx.authorizer);
    expect(entries.length).toBeGreaterThan(10);
    const identifying = [
      fx.trialId,
      fx.teamAId,
      fx.teamBId,
      memberIdOf(fx.operative),
      fx.operative.userId,
      fx.operative.discordId,
      fx.operative.displayName,
    ];
    for (const entry of entries) {
      expect(entry.actorUserId).not.toBe(fx.operative.userId);
      const serialized = JSON.stringify(entry);
      for (const value of identifying) expect(serialized).not.toContain(value);
    }
    // Still audited: pseudonymously, attributable through the role row.
    const byOperative = entries
      .filter((entry) => entry.context.systemReason === OPERATIVE_AUDIT_REASON)
      .map((entry) => entry.action);
    expect(byOperative).toEqual(
      expect.arrayContaining([
        'adversarial.briefing_viewed',
        'adversarial.briefings_listed',
        'adversarial.trigger_fired',
        'adversarial.role_aborted',
      ]),
    );
  });

  it('BREAK: the shared audit log never tells a competing staff member that their trial has a role', async () => {
    const insider = await coreParticipant();
    const founderCtx = kit.as(fx.founder);
    await recordAudit(founderCtx, {
      action: 'trial.created',
      targetType: 'trial',
      targetId: fx.trialId,
      context: { title: 'Security sprint', adversarialEnabled: true },
    });
    await recordAudit(founderCtx, {
      action: 'trial.adversarial_toggled',
      targetType: 'trial',
      targetId: fx.trialId,
      context: { enabled: true },
    });
    await planDefault(fx);

    // The whole log (the /audit page and the overview panel), and the trial's own entries.
    for (const query of [{}, { targetType: 'trial', targetId: fx.trialId }]) {
      const page = await listAuditLogs(kit.as(insider), { ...query, limit: 100 });
      const actions = page.items.map((entry) => entry.action);
      expect(actions).not.toContain('trial.adversarial_toggled');
      expect(actions.some((action) => action.startsWith('adversarial.'))).toBe(false);
      const created = page.items.find((entry) => entry.action === 'trial.created');
      expect(created?.context).toEqual({ title: 'Security sprint' });
      expect(page.total).toBe(page.items.length);
    }

    // Staff entitled to adversarial records still see all of it.
    const entitled = await listAuditLogs(kit.as(fx.authorizer), {
      targetType: 'trial',
      targetId: fx.trialId,
      limit: 100,
    });
    expect(entitled.items.map((entry) => entry.action)).toContain('trial.adversarial_toggled');
    expect(entitled.items.find((entry) => entry.action === 'trial.created')?.context).toEqual({
      title: 'Security sprint',
      adversarialEnabled: true,
    });
    const planned = await listAuditLogs(kit.as(fx.authorizer), {
      action: 'adversarial.role_planned',
      limit: 10,
    });
    expect(planned.items).toHaveLength(1);
    // Once the trial is over, its participants are no longer kept out.
    await kit.db.update(trials).set({ status: 'completed' }).where(eq(trials.id, fx.trialId));
    const after = await listAuditLogs(kit.as(insider), { action: 'adversarial.*', limit: 100 });
    expect(after.items.length).toBeGreaterThan(0);
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
    const trigger = await addApprovedTrigger(fx, {
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
