import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { jobs, notifications } from '@jave/database';
import { NotFoundError } from '../kernel/errors';
import type { JobHandlerMap } from '../jobs/worker';
import { updateSettings } from '../settings/settings.service';
import { createTestKit, type TestKit } from '../testing';
import {
  applyToTrial,
  assignTeams,
  cancelTrial,
  createTrial,
  DISCORD_TRIALS_PROVISION_JOB,
  DISCORD_TRIALS_TEARDOWN_JOB,
  getAnnouncementSpec,
  getTeamProvisioningSpec,
  getTeamWarningSpec,
  getTrialForStaff,
  markTeamProvisioned,
  openRecruitment,
  reprovisionTeams,
  selectParticipants,
  startTrial,
  withdraw,
} from './index';
import {
  configureDiscord,
  createFakeDiscordLog,
  CUSTOM_TRIAL,
  type FakeDiscordLog,
  members as makeMembers,
  OPERATIONS_DISCORD_ROLE_ID,
  recruitingTrial,
  STATEMENT,
  TRIALS_CATEGORY_ID,
  trialHandlers,
  PGLITE_HOOK_TIMEOUT_MS,
  PGLITE_SUITE,
} from './testing/fixtures';

describe('trials: Discord job contracts', PGLITE_SUITE, () => {
  let kit: TestKit;
  let log: FakeDiscordLog;
  let handlers: JobHandlerMap;
  beforeEach(async () => {
    kit = await createTestKit();
    log = createFakeDiscordLog();
    handlers = trialHandlers(log);
  }, PGLITE_HOOK_TIMEOUT_MS);
  afterEach(async () => {
    await kit.close();
  }, PGLITE_HOOK_TIMEOUT_MS);

  async function jobsOf(type: string, status?: 'pending' | 'dead' | 'completed') {
    const rows = await kit.db.select().from(jobs).where(eq(jobs.type, type));
    return status ? rows.filter((row) => row.status === status) : rows;
  }

  it('provisioning grants the team, evaluator roles, and denies staff competing elsewhere', async () => {
    await configureDiscord(kit);
    const ops = await kit.member({ roles: ['operations'] });
    const staffPlayer = await kit.member({ roles: ['moderator'] });
    const opsPlayer = await kit.member({ roles: ['operations'] });
    const [a, b] = await makeMembers(kit, 2);
    const trialId = await recruitingTrial(kit, ops, [opsPlayer, staffPlayer, a!, b!]);
    await selectParticipants(kit.as(ops), {
      trialId,
      mode: 'manual',
      memberIds: [opsPlayer, staffPlayer, a!, b!].map((m) => m.memberId!),
    });
    const assignment = await assignTeams(kit.as(ops), { trialId, strategy: 'random', seed: 'p' });
    const opsTeam = assignment.teams.find((t) => t.memberIds.includes(opsPlayer.memberId!))!;
    const otherTeam = assignment.teams.find((t) => t !== opsTeam)!;

    const spec = await getTeamProvisioningSpec(kit.system, { teamId: otherTeam.id });
    if (spec.action !== 'ensure') throw new Error('expected ensure');
    expect(spec.parentCategoryId).toBe(TRIALS_CATEGORY_ID);
    expect(spec.evaluatorRoleIds).toEqual([OPERATIONS_DISCORD_ROLE_ID]);
    expect(spec.memberDiscordIds).toHaveLength(otherTeam.memberIds.length);
    // The operations participant sits on another team: explicitly denied here.
    expect(spec.denyDiscordIds).toEqual([opsPlayer.discordId]);
    expect(spec.createRole).toBe(false);
    expect(spec.channelName).toMatch(/^trial-\d{4}-unit-(alpha|bravo)$/);

    await kit.drain(handlers);
    const staff = await getTrialForStaff(kit.as(ops), { trialId });
    expect(staff.teams.every((t) => t.discordChannelId !== null && t.discordRoleId === null)).toBe(
      true,
    );
  });

  it('a missing trials category dead-letters provisioning until staff re-provision', async () => {
    const ops = await kit.member({ roles: ['operations'] });
    const [a, b] = await makeMembers(kit, 2);
    const trialId = await recruitingTrial(kit, ops, [a!, b!]);
    await selectParticipants(kit.as(ops), {
      trialId,
      mode: 'manual',
      memberIds: [a!.memberId!, b!.memberId!],
    });
    await assignTeams(kit.as(ops), { trialId, strategy: 'random', seed: 's', teamSize: 2 });
    await kit.drain(handlers);
    const dead = await jobsOf(DISCORD_TRIALS_PROVISION_JOB, 'dead');
    expect(dead).toHaveLength(1);
    expect(dead[0]!.lastError).toContain('trialsCategory');
    // No announcements channel either: the card is skipped, not failed.
    expect(await jobsOf('discord.trials.announce', 'dead')).toEqual([]);
    expect(await getAnnouncementSpec(kit.system, { trialId })).toMatchObject({ action: 'skip' });

    await configureDiscord(kit);
    await updateSettings(kit.system, 'trials', { createTeamRoles: true });
    expect(await reprovisionTeams(kit.as(ops), { trialId })).toEqual({ enqueued: 1 });
    await kit.drain(handlers);
    const staff = await getTrialForStaff(kit.as(ops), { trialId });
    expect(staff.teams[0]!.discordChannelId).not.toBeNull();
    expect(staff.teams[0]!.discordRoleId).not.toBeNull();
  });

  it('a reshuffle tears down the old channels and provisions the new teams', async () => {
    await configureDiscord(kit);
    const ops = await kit.member({ roles: ['operations'] });
    const people = await makeMembers(kit, 4);
    const trialId = await recruitingTrial(kit, ops, people);
    await selectParticipants(kit.as(ops), {
      trialId,
      mode: 'manual',
      memberIds: people.map((p) => p.memberId!),
    });
    const first = await assignTeams(kit.as(ops), { trialId, strategy: 'random', seed: 'one' });
    await kit.drain(handlers);
    const oldChannels = [...log.channels.keys()];
    expect(oldChannels).toHaveLength(2);

    const second = await assignTeams(kit.as(ops), {
      trialId,
      strategy: 'balanced',
      seed: 'two',
      teamSize: 4,
    });
    expect(second.teams).toHaveLength(1);
    expect(second.teams[0]!.id).not.toBe(first.teams[0]!.id);
    await kit.drain(handlers);
    expect(await jobsOf(DISCORD_TRIALS_TEARDOWN_JOB, 'completed')).toHaveLength(2);
    expect(log.deleted.sort()).toEqual(oldChannels.sort());
    expect(log.channels.size).toBe(1);

    // A provision callback for a team that no longer exists is refused.
    await expect(
      markTeamProvisioned(kit.system, {
        teamId: first.teams[0]!.id,
        channelId: '123456789012345678',
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('BREAK: a channel provisioned while the trial was being cancelled is archived anyway', async () => {
    await configureDiscord(kit);
    const ops = await kit.member({ roles: ['operations'] });
    const [a] = await makeMembers(kit, 1);
    const trialId = await recruitingTrial(kit, ops, [a!]);
    await selectParticipants(kit.as(ops), { trialId, mode: 'manual', memberIds: [a!.memberId!] });
    const { teams } = await assignTeams(kit.as(ops), { trialId, strategy: 'random', seed: 's' });
    // The bot loads the spec, then staff cancel before the bot reports back.
    const spec = await getTeamProvisioningSpec(kit.system, { teamId: teams[0]!.id });
    expect(spec.action).toBe('ensure');
    await cancelTrial(kit.as(ops), { trialId, reason: 'Called off.' });
    await kit.drain(handlers);
    await markTeamProvisioned(kit.system, {
      teamId: teams[0]!.id,
      channelId: '123456789012345678',
    });
    await kit.drain(handlers);
    const staff = await getTrialForStaff(kit.as(ops), { trialId });
    expect(staff.teams[0]).toMatchObject({ discordChannelId: '123456789012345678' });
    expect(staff.teams[0]!.archivedAt).not.toBeNull();
  });

  it('a brief waits for its channel: provisioning after the start briefs the team', async () => {
    await configureDiscord(kit);
    const ops = await kit.member({ roles: ['operations'] });
    const [a] = await makeMembers(kit, 1);
    const trialId = await recruitingTrial(kit, ops, [a!]);
    await selectParticipants(kit.as(ops), { trialId, mode: 'manual', memberIds: [a!.memberId!] });
    await assignTeams(kit.as(ops), { trialId, strategy: 'random', seed: 's' });
    await startTrial(kit.as(ops), { trialId }); // provisioning has not run yet
    expect(await jobsOf('discord.trials.brief')).toEqual([]);
    await kit.drain(handlers);
    expect(log.posted.filter((p) => p.kind === 'brief')).toHaveLength(1);
    const staff = await getTrialForStaff(kit.as(ops), { trialId });
    expect(staff.teams[0]!.briefedAt).not.toBeNull();
  });

  it('warnings are skipped once the deadline moved', async () => {
    await configureDiscord(kit);
    const ops = await kit.member({ roles: ['operations'] });
    const [a] = await makeMembers(kit, 1);
    const trialId = await recruitingTrial(kit, ops, [a!]);
    await selectParticipants(kit.as(ops), { trialId, mode: 'manual', memberIds: [a!.memberId!] });
    const { teams } = await assignTeams(kit.as(ops), { trialId, strategy: 'random', seed: 's' });
    await kit.drain(handlers);
    const live = await startTrial(kit.as(ops), { trialId });
    const current = await getTeamWarningSpec(kit.system, {
      teamId: teams[0]!.id,
      minutesRemaining: 10,
      deadlineAt: live.deadlineAt!.toISOString(),
    });
    expect(current).toMatchObject({ action: 'post' });
    const stale = await getTeamWarningSpec(kit.system, {
      teamId: teams[0]!.id,
      minutesRemaining: 10,
      deadlineAt: new Date(live.deadlineAt!.getTime() - 1).toISOString(),
    });
    expect(stale).toEqual({ action: 'skip', reason: 'deadline moved' });
  });

  it('withdrawal re-syncs the team channel; cancellation archives it and tells everyone', async () => {
    await configureDiscord(kit);
    const ops = await kit.member({ roles: ['operations'] });
    const [a, b, c] = await makeMembers(kit, 3);
    const trial = await createTrial(kit.as(ops), { ...CUSTOM_TRIAL, teamSize: 3 });
    await openRecruitment(kit.as(ops), { trialId: trial.id });
    await kit.drain(handlers); // the bot posts the card right away
    expect(log.posted).toMatchObject([{ kind: 'announce' }]);
    for (const m of [a!, b!, c!])
      await applyToTrial(kit.as(m), { trialId: trial.id, statement: STATEMENT });
    await selectParticipants(kit.as(ops), {
      trialId: trial.id,
      mode: 'manual',
      memberIds: [a!.memberId!, b!.memberId!],
    });
    await assignTeams(kit.as(ops), { trialId: trial.id, strategy: 'random', seed: 's' });
    await kit.drain(handlers);
    const [channelId] = [...log.channels.keys()];
    expect(log.channels.get(channelId!)!.members).toHaveLength(2);

    await withdraw(kit.as(b!), { trialId: trial.id });
    await kit.drain(handlers);
    expect(log.channels.get(channelId!)!.members).toEqual([a!.discordId]);

    await cancelTrial(kit.as(ops), { trialId: trial.id, reason: 'Venue lost power.' });
    await kit.drain(handlers);
    expect(log.channels.get(channelId!)!.locked).toBe(true);
    expect(log.posted.at(-1)).toMatchObject({ kind: 'archive' });
    expect(log.posted.some((p) => p.kind === 'announce-edit' && p.text === 'CANCELLED')).toBe(true);
    const cancelled = await kit.db
      .select()
      .from(notifications)
      .where(
        and(eq(notifications.type, 'trial.update'), eq(notifications.title, 'TRIAL CANCELLED')),
      );
    // a (selected) and c (waitlisted) keep a stake; b withdrew.
    expect(cancelled.map((n) => n.recipientUserId).sort()).toEqual([a!.userId, c!.userId].sort());
    expect(cancelled[0]!.body).toContain('Venue lost power.');
  });
});
