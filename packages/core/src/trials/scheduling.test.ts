import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { auditLogs, jobs } from '@jave/database';
import { MINUTE } from '../kernel/clock';
import type { JobHandlerMap } from '../jobs/worker';
import { createTestKit, type TestKit } from '../testing';
import {
  assignTeams,
  createTrial,
  getTrialForStaff,
  openRecruitment,
  selectParticipants,
  TRIAL_JOBS,
  updateTrial,
  withdraw,
} from './index';
import { applyToTrial } from './participation.service';
import {
  configureDiscord,
  createFakeDiscordLog,
  CUSTOM_TRIAL,
  members as makeMembers,
  STATEMENT,
  trialHandlers,
  PGLITE_HOOK_TIMEOUT_MS,
  PGLITE_SUITE,
} from './testing/fixtures';

describe('trials: scheduled start and timer rescheduling', PGLITE_SUITE, () => {
  let kit: TestKit;
  let handlers: JobHandlerMap;
  beforeEach(async () => {
    kit = await createTestKit();
    handlers = trialHandlers(createFakeDiscordLog());
    await configureDiscord(kit);
  }, PGLITE_HOOK_TIMEOUT_MS);
  afterEach(async () => {
    await kit.close();
  }, PGLITE_HOOK_TIMEOUT_MS);

  async function pending(type: string) {
    return (await kit.db.select().from(jobs).where(eq(jobs.type, type))).filter(
      (job) => job.status === 'pending',
    );
  }

  async function assigned(scheduledStartAt: Date) {
    const ops = await kit.member({ roles: ['operations'] });
    const [a, b] = await makeMembers(kit, 2);
    const trial = await createTrial(kit.as(ops), { ...CUSTOM_TRIAL, scheduledStartAt });
    await openRecruitment(kit.as(ops), { trialId: trial.id });
    for (const m of [a!, b!])
      await applyToTrial(kit.as(m), { trialId: trial.id, statement: STATEMENT });
    await selectParticipants(kit.as(ops), {
      trialId: trial.id,
      mode: 'manual',
      memberIds: [a!.memberId!, b!.memberId!],
    });
    await assignTeams(kit.as(ops), { trialId: trial.id, strategy: 'random', seed: 's' });
    return { ops, trialId: trial.id, a: a!, b: b! };
  }

  it('starts automatically at scheduledStartAt once teams are assigned', async () => {
    const startAt = new Date(kit.clock.now().getTime() + 120 * MINUTE);
    const { ops, trialId } = await assigned(startAt);
    expect(await pending(TRIAL_JOBS.autoStart)).toHaveLength(1);
    kit.clock.set(new Date(startAt.getTime() - 1));
    await kit.drain(handlers);
    expect((await getTrialForStaff(kit.as(ops), { trialId })).status).toBe('teams_assigned');
    kit.clock.set(startAt);
    await kit.drain(handlers);
    const live = await getTrialForStaff(kit.as(ops), { trialId });
    expect(live.status).toBe('active');
    expect(live.startedAt!.getTime()).toBe(startAt.getTime());
  });

  it('moving the scheduled start moves the job; the old one never fires', async () => {
    const startAt = new Date(kit.clock.now().getTime() + 60 * MINUTE);
    const { ops, trialId } = await assigned(startAt);
    const later = new Date(startAt.getTime() + 60 * MINUTE);
    await updateTrial(kit.as(ops), { trialId, scheduledStartAt: later });
    const scheduled = await pending(TRIAL_JOBS.autoStart);
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]!.payload.scheduledStartAt).toBe(later.toISOString());
    kit.clock.set(startAt);
    await kit.drain(handlers);
    expect((await getTrialForStaff(kit.as(ops), { trialId })).status).toBe('teams_assigned');
    kit.clock.set(later);
    await kit.drain(handlers);
    expect((await getTrialForStaff(kit.as(ops), { trialId })).status).toBe('active');

    // Clearing the schedule removes the job entirely.
    const other = await assigned(new Date(kit.clock.now().getTime() + 30 * MINUTE));
    await updateTrial(kit.as(other.ops), { trialId: other.trialId, scheduledStartAt: null });
    expect(await pending(TRIAL_JOBS.autoStart)).toEqual([]);
  });

  it('BREAK: a scheduled start that cannot happen is skipped, not dead-lettered', async () => {
    const startAt = new Date(kit.clock.now().getTime() + 30 * MINUTE);
    const { ops, trialId, a, b } = await assigned(startAt);
    await withdraw(kit.as(a), { trialId });
    await withdraw(kit.as(b), { trialId });
    kit.clock.set(startAt);
    const outcomes = await kit.drain(handlers);
    const auto = outcomes.find((o) => o.type === TRIAL_JOBS.autoStart)!;
    expect(auto.status).toBe('completed');
    expect(String(auto.result?.skipped)).toContain('has no members');
    expect((await getTrialForStaff(kit.as(ops), { trialId })).status).toBe('teams_assigned');
    const [audit] = await kit.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'trial.auto_start_skipped'));
    expect(audit).toMatchObject({ targetId: trialId, result: 'failure' });
    expect(String(audit!.context.reason)).toContain('has no members');
  });

  it('moving the recruitment close moves the card refresh', async () => {
    const ops = await kit.member({ roles: ['operations'] });
    const closesAt = new Date(kit.clock.now().getTime() + 60 * MINUTE);
    const trial = await createTrial(kit.as(ops), CUSTOM_TRIAL);
    await openRecruitment(kit.as(ops), { trialId: trial.id, recruitmentClosesAt: closesAt });
    await kit.drain(handlers);
    const later = new Date(closesAt.getTime() + 60 * MINUTE);
    await updateTrial(kit.as(ops), { trialId: trial.id, recruitmentClosesAt: later });
    const cards = await pending('discord.trials.announce');
    expect(cards.map((job) => job.runAt.getTime()).sort()).toEqual(
      [kit.clock.now().getTime(), later.getTime()].sort(),
    );
  });
});
