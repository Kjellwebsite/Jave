import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { adversarialRoles, jobs, notifications, trialParticipants } from '@jave/database';
import { createEventHandlers, publishEvent } from '../events/bus';
import { DAY, HOUR } from '../kernel/clock';
import { enqueueJob } from '../jobs/queue';
import { coreJobHandlers, coreRecurringJobs, coreSubscribers } from '../registry';
import { updateSettings } from '../settings/settings.service';
import { createTestKit, type TestKit } from '../testing';
import { ADVERSARIAL_ABORT_JOB } from './discord-jobs';
import { jobHandlers, recurringJobs, subscribers } from './index';
import { ADVERSARIAL_SWEEP_JOB } from './lifecycle';
import { recordObservation } from './observations.service';
import { authorizeRole, briefRole, planRole } from './roles.service';
import {
  type AdversarialFixture,
  memberIdOf,
  runToActive,
  setTrialStatus,
  setupAdversarial,
  INTEGRATION_TIMEOUT_MS,
} from './test-fixtures';

vi.setConfig({ testTimeout: INTEGRATION_TIMEOUT_MS, hookTimeout: INTEGRATION_TIMEOUT_MS });
describe('adversarial background work', () => {
  let kit: TestKit;
  let fx: AdversarialFixture;
  const handlers = { ...jobHandlers, ...createEventHandlers(subscribers) };
  beforeEach(async () => {
    kit = await createTestKit();
    fx = await setupAdversarial(kit);
  });
  afterEach(async () => {
    await kit.close();
  });

  const statusOf = async (id: string) =>
    (await kit.db.select().from(adversarialRoles).where(eq(adversarialRoles.id, id)))[0]!;

  /** A briefed (not yet active) role on team B. */
  async function briefedOnTeamB() {
    const other = await kit.member({ roles: ['verified'] });
    await kit.db.insert(trialParticipants).values({
      trialId: fx.trialId,
      memberId: memberIdOf(other),
      status: 'selected',
      teamId: fx.teamBId,
    });
    const role = await planRole(kit.as(fx.planner), {
      trialId: fx.trialId,
      teamId: fx.teamBId,
      operativeMemberId: memberIdOf(other),
      scenarioId: fx.scenarioId,
    });
    await authorizeRole(kit.as(fx.authorizer), { roleId: role.id, sandboxAttested: true });
    return briefRole(kit.as(fx.planner), { roleId: role.id });
  }

  it('turning the kill switch off aborts every live exercise and tells operatives to STOP', async () => {
    const active = await runToActive(fx);
    const briefed = await briefedOnTeamB();
    await updateSettings(kit.as(fx.founder), 'trials', { adversarialEnabled: false });
    await kit.drain(handlers);
    for (const role of [active, briefed]) {
      const row = await statusOf(role.id);
      expect(row.status).toBe('aborted');
      expect(row.abortReason).toBe('Global kill switch turned off.');
    }
    expect(
      await kit.db.select().from(jobs).where(eq(jobs.type, ADVERSARIAL_ABORT_JOB)),
    ).toHaveLength(2);
  });

  it('other settings changes leave exercises alone', async () => {
    const active = await runToActive(fx);
    await updateSettings(kit.as(fx.founder), 'trials', { passThreshold: 7 });
    await kit.drain(handlers);
    expect((await statusOf(active.id)).status).toBe('active');
  });

  it('a cancelled trial aborts its live roles', async () => {
    const active = await runToActive(fx);
    await setTrialStatus(kit, fx.trialId, 'cancelled');
    await publishEvent(kit.system, {
      type: 'trial.cancelled',
      aggregateType: 'trial',
      aggregateId: fx.trialId,
    });
    await kit.drain(handlers);
    const row = await statusOf(active.id);
    expect(row.status).toBe('aborted');
    expect(row.abortReason).toBe('Trial cancelled.');
  });

  it('a finished trial concludes running exercises and aborts ones that never ran', async () => {
    const active = await runToActive(fx);
    const briefed = await briefedOnTeamB();
    await setTrialStatus(kit, fx.trialId, 'evaluating');
    await publishEvent(kit.system, {
      type: 'trial.submissions_closed',
      aggregateType: 'trial',
      aggregateId: fx.trialId,
    });
    await kit.drain(handlers);
    expect((await statusOf(active.id)).status).toBe('concluded');
    const neverRan = await statusOf(briefed.id);
    expect(neverRan.status).toBe('aborted');
    expect(neverRan.abortReason).toBe('Trial ended before the exercise ran.');
  });

  it('BREAK: event payloads are not trusted — the trial row decides', async () => {
    const active = await runToActive(fx);
    await publishEvent(kit.system, {
      type: 'trial.cancelled',
      aggregateType: 'trial',
      aggregateId: fx.trialId,
    });
    await publishEvent(kit.system, {
      type: 'trial.cancelled',
      aggregateType: 'trial',
      aggregateId: 'not-a-uuid',
    });
    await kit.drain(handlers);
    expect((await statusOf(active.id)).status).toBe('active');
  });

  it('the sweep reconciles without events and reminds about overdue reveals once', async () => {
    const active = await runToActive(fx);
    await recordObservation(kit.as(fx.planner), {
      roleId: active.id,
      outcome: 'resisted',
      description: 'Refused it.',
    });
    await setTrialStatus(kit, fx.trialId, 'completed');
    await enqueueJob(kit.system, ADVERSARIAL_SWEEP_JOB, {}, { dedupeKey: 'sweep-1' });
    await kit.drain(handlers);
    expect((await statusOf(active.id)).status).toBe('concluded');

    const reminders = () =>
      kit.db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientUserId, fx.founder.userId))
        .then((rows) => rows.filter((n) => n.title.startsWith('REVEAL PENDING')));
    expect(await reminders()).toHaveLength(0);
    kit.clock.advance(3 * DAY + HOUR);
    await enqueueJob(kit.system, ADVERSARIAL_SWEEP_JOB, {}, { dedupeKey: 'sweep-2' });
    await enqueueJob(kit.system, ADVERSARIAL_SWEEP_JOB, {}, { dedupeKey: 'sweep-3' });
    await kit.drain(handlers);
    expect(await reminders()).toHaveLength(1);
  });

  it('is wired into the core registry', () => {
    expect(Object.keys(coreJobHandlers())).toContain(ADVERSARIAL_SWEEP_JOB);
    expect(coreRecurringJobs.map((j) => j.type)).toContain(ADVERSARIAL_SWEEP_JOB);
    expect(recurringJobs[0]!.everyMs).toBeGreaterThan(0);
    const names = coreSubscribers.map((s) => s.name);
    expect(names).toEqual(
      expect.arrayContaining(['adversarial.trial-lifecycle', 'adversarial.kill-switch']),
    );
    // Discord side effects belong to the bot, never to core handlers.
    expect(Object.keys(jobHandlers).some((type) => type.startsWith('discord.'))).toBe(false);
  });
});
