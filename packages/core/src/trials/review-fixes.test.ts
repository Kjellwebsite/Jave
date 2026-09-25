import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { jobs, members, notifications } from '@jave/database';
import { HOUR } from '../kernel/clock';
import { ForbiddenError, ValidationError } from '../kernel/errors';
import { claimJobs } from '../jobs/queue';
import { resolveUserActor } from '../identity/users.service';
import { updateSettings } from '../settings/settings.service';
import type { UserActor } from '../permissions/actor';
import { createTestKit, type TestKit } from '../testing';
import { createTrial, openRecruitment, updateTrial } from './admin.service';
import { DISCORD_TRIALS_PROVISION_JOB } from './discord-jobs';
import { evaluate } from './evaluation.service';
import { applyToTrial, submit, withdraw } from './participation.service';
import { assignTeams, selectParticipants } from './roster.service';
import { closeSubmissions } from './run.service';
import {
  configureDiscord,
  createFakeDiscordLog,
  CUSTOM_TRIAL,
  members as makeMembers,
  PGLITE_HOOK_TIMEOUT_MS,
  PGLITE_SUITE,
  recruitingTrial,
  runningTrial,
  STATEMENT,
  trialHandlers,
} from './testing/fixtures';

vi.setConfig({ testTimeout: PGLITE_SUITE.timeout, hookTimeout: PGLITE_HOOK_TIMEOUT_MS });

describe('trials: review fixes', () => {
  let kit: TestKit;
  beforeEach(async () => {
    kit = await createTestKit();
    await configureDiscord(kit);
  });
  afterEach(async () => {
    await kit.close();
  });

  const inOneHour = () => new Date(kit.clock.now().getTime() + HOUR);

  /** Recruiting trial starting in an hour, with `participants` selected. */
  async function scheduledTrial(manager: UserActor, count: number) {
    const participants = await makeMembers(kit, count);
    const trialId = await recruitingTrial(kit, manager, participants, {
      scheduledStartAt: inOneHour(),
    });
    await selectParticipants(kit.as(manager), {
      trialId,
      mode: 'manual',
      memberIds: participants.map((p) => p.memberId!),
    });
    return { trialId, participants };
  }

  it('BREAK: a rubric criterion named like an Object property must still be scored', async () => {
    const ops = await kit.member({ roles: ['operations'] });
    const [a, b] = await makeMembers(kit, 2);
    const { trialId, assignment } = await runningTrial(kit, ops, [a!, b!], {
      rubric: [
        { key: 'constructor', label: 'Construction', weight: 1 },
        { key: 'value', label: 'User value', weight: 1 },
      ],
    });
    await submit(kit.as(a!), { trialId, summary: 'A working product with real users.' });
    await closeSubmissions(kit.as(ops), { trialId });
    await expect(
      evaluate(kit.as(ops), { trialId, teamId: assignment.teams[0]!.id, scores: { value: 7 } }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('BREAK: the public summary cannot be emptied once recruitment is open', async () => {
    const ops = await kit.member({ roles: ['operations'] });
    const draft = await createTrial(kit.as(ops), CUSTOM_TRIAL);
    await updateTrial(kit.as(ops), { trialId: draft.id, summary: '' });
    await updateTrial(kit.as(ops), { trialId: draft.id, summary: CUSTOM_TRIAL.summary });
    await openRecruitment(kit.as(ops), { trialId: draft.id });
    await expect(
      updateTrial(kit.as(ops), { trialId: draft.id, summary: '' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  describe('scheduled starts', () => {
    it('BREAK: recruitment cannot open when the scheduled start already passed', async () => {
      const ops = await kit.member({ roles: ['operations'] });
      const trial = await createTrial(kit.as(ops), {
        ...CUSTOM_TRIAL,
        scheduledStartAt: inOneHour(),
      });
      kit.clock.advance(2 * HOUR);
      await expect(openRecruitment(kit.as(ops), { trialId: trial.id })).rejects.toMatchObject({
        code: 'VALIDATION',
        issues: [{ path: 'scheduledStartAt' }],
      });
    });

    it('team assignment reports whether the trial will still start itself', async () => {
      const ops = await kit.member({ roles: ['operations'] });
      const { trialId } = await scheduledTrial(ops, 2);
      const onTime = await assignTeams(kit.as(ops), { trialId, strategy: 'random', seed: 'a' });
      expect(onTime.scheduledStart).toBe('scheduled');
      kit.clock.advance(2 * HOUR);
      const late = await assignTeams(kit.as(ops), { trialId, strategy: 'random', seed: 'b' });
      expect(late.scheduledStart).toBe('passed');
    });

    it('a skipped scheduled start alerts the trial managers', async () => {
      const ops = await kit.member({ roles: ['operations'] });
      const { trialId } = await scheduledTrial(ops, 2);
      await assignTeams(kit.as(ops), { trialId, strategy: 'random', seed: 'a' });
      await updateSettings(kit.system, 'trials', { enabled: false });
      kit.clock.advance(HOUR + 1000);
      await kit.drain(trialHandlers(createFakeDiscordLog()));
      const alerts = await kit.db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.type, 'trial.attention'),
            eq(notifications.recipientUserId, ops.userId),
          ),
        );
      expect(alerts).toHaveLength(1);
      expect(alerts[0]!.title).toBe('SCHEDULED START SKIPPED');
    });
  });

  it('BREAK: staff who rewrote the brief or rubric cannot compete; other edits do not bar', async () => {
    const author = await kit.member({ roles: ['operations'] });
    const briefEditor = await kit.member({ roles: ['operations'] });
    const rubricEditor = await kit.member({ roles: ['operations'] });
    const titleEditor = await kit.member({ roles: ['operations'] });
    const trial = await createTrial(kit.as(author), CUSTOM_TRIAL);
    await updateTrial(kit.as(briefEditor), {
      trialId: trial.id,
      brief: `${CUSTOM_TRIAL.brief}\nHint: the judges love dashboards.`,
    });
    await updateTrial(kit.as(rubricEditor), {
      trialId: trial.id,
      rubric: [
        { key: 'shipped', label: 'Working product', weight: 2 },
        { key: 'value', label: 'User value', weight: 1 },
      ],
    });
    await updateTrial(kit.as(titleEditor), { trialId: trial.id, title: 'Night Build II' });
    await openRecruitment(kit.as(author), { trialId: trial.id });
    for (const editor of [briefEditor, rubricEditor]) {
      await expect(
        applyToTrial(kit.as(editor), { trialId: trial.id, statement: STATEMENT }),
      ).rejects.toThrow('You edited this trial’s brief or rubric');
    }
    await expect(
      applyToTrial(kit.as(titleEditor), { trialId: trial.id, statement: STATEMENT }),
    ).resolves.toBeTruthy();
  });

  it('BREAK: a competitor quarantined mid-trial cannot submit', async () => {
    const ops = await kit.member({ roles: ['operations'] });
    const [a, b] = await makeMembers(kit, 2);
    const { trialId } = await runningTrial(kit, ops, [a!, b!]);
    await kit.db
      .update(members)
      .set({ standing: 'quarantined' })
      .where(eq(members.id, a!.memberId!));
    const quarantined = await resolveUserActor(kit.system, a!.userId);
    await expect(
      submit(kit.as(quarantined), { trialId, summary: 'A working product with real users.' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('BREAK: a reshuffle locks the old teams before retiring them', async () => {
    const ops = await kit.member({ roles: ['operations'] });
    const { trialId } = await scheduledTrial(ops, 2);
    await assignTeams(kit.as(ops), { trialId, strategy: 'random', seed: 'a' });
    const statements: string[] = [];
    const db = kit.database.withQueryLog((query) => statements.push(query.toLowerCase()));
    await assignTeams(
      { ...kit.as(ops), db, rootDb: db },
      { trialId, strategy: 'random', seed: 'b' },
    );
    const lock = statements.findIndex((q) => /from "trial_teams".* for update/.test(q));
    const remove = statements.findIndex((q) => q.startsWith('delete from "trial_teams"'));
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(lock).toBeLessThan(remove);
  });

  it('a withdrawal during a running provision job makes it run again', async () => {
    const ops = await kit.member({ roles: ['operations'] });
    const [a, b, c] = await makeMembers(kit, 3);
    const trialId = await recruitingTrial(kit, ops, [a!, b!, c!]);
    await selectParticipants(kit.as(ops), {
      trialId,
      mode: 'manual',
      memberIds: [a!, b!, c!].map((p) => p.memberId!),
    });
    const { teams } = await assignTeams(kit.as(ops), { trialId, strategy: 'random', seed: 'a' });
    const handlers = trialHandlers(createFakeDiscordLog());
    await kit.drain(handlers); // provisions every team channel
    const team = teams.find((t) => t.memberIds.length > 1)!;
    const leaver = [a!, b!, c!].find((p) => team.memberIds.includes(p.memberId!))!;
    // A re-sync of this team is in flight (claimed by a worker) when the member withdraws.
    const { enqueueProvision } = await import('./effects');
    await enqueueProvision(kit.system, trialId, team.id);
    const [running] = await claimJobs(kit.db, {
      workerId: 'bot-1',
      limit: 1,
      now: kit.clock.now(),
      types: [DISCORD_TRIALS_PROVISION_JOB],
    });
    await withdraw(kit.as(leaver), { trialId });
    const [row] = await kit.db.select().from(jobs).where(eq(jobs.id, running!.id));
    expect(row).toMatchObject({ status: 'running', rerunRequested: true });
  });
});
