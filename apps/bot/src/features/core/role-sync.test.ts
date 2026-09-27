import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { jobs, members } from '@jave/database';
import { testBackend } from '@jave/database/testing';
import {
  DISCORD_ROLE_RETIRE_JOB,
  DISCORD_ROLE_SYNC_JOB,
  getSettings,
  grantRoleUnchecked,
  moderation,
  requestRoleResync,
  revokeRoleUnchecked,
  type ServiceContext,
  TtlCache,
  updateSettings,
  type UserActor,
} from '@jave/core';
import { DiscordActionError } from '../../discord/gateway';
import { createBotHarness, type BotHarness } from '../../testing/harness';

const MEMBER_ROLE = '500000000000000001';
const VERIFIED_ROLE = '500000000000000002';
const SUPPORTER_ROLE = '500000000000000003';
const QUARANTINE_ROLE = '500000000000000009';
const UNRELATED_ROLE = '500000000000000077';
const ADMIN_ROLE = '500000000000000070';
const MODS_ROLE = '500000000000000060';

describe('role sync: quarantine', () => {
  let bot: BotHarness;
  let moderator: UserActor;
  let target: { actor: UserActor };

  beforeEach(async () => {
    bot = await createBotHarness();
    const founder = await bot.member({ roles: ['founder'] });
    await updateSettings(bot.kit.as(founder.actor), 'roles', {
      discordRoleIds: { member: MEMBER_ROLE, verified: VERIFIED_ROLE, supporter: SUPPORTER_ROLE },
      quarantineRoleId: QUARANTINE_ROLE,
    });
    moderator = (await bot.member({ roles: ['moderator'] })).actor;
    target = await bot.member({ roles: ['verified', 'supporter'] });
    await bot.drain();
    bot.gateway.members.get(target.actor.discordId)!.roleIds.push(UNRELATED_ROLE);
  });
  afterEach(async () => {
    await bot.close();
  });

  const discordRoles = () => [...bot.gateway.members.get(target.actor.discordId)!.roleIds].sort();

  it('strips managed roles while quarantined and restores them on release', async () => {
    expect(discordRoles()).toEqual([SUPPORTER_ROLE, VERIFIED_ROLE, UNRELATED_ROLE].sort());

    await moderation.quarantineMember(bot.kit.as(moderator), {
      targetUserId: target.actor.userId,
      reason: 'Suspicious link burst',
    });
    // A role change during quarantine must not hand managed roles back.
    await revokeRoleUnchecked(bot.kit.system, {
      memberId: target.actor.memberId!,
      role: 'supporter',
      reason: 'lapsed while quarantined',
    });
    await bot.drain();
    // Moderation applies the quarantine role; role sync strips every managed role.
    expect(discordRoles()).toEqual([QUARANTINE_ROLE, UNRELATED_ROLE].sort());

    await moderation.releaseMember(bot.kit.as(moderator), {
      targetUserId: target.actor.userId,
      reason: 'Reviewed: false positive',
    });
    await bot.drain();
    expect(discordRoles()).toEqual([VERIFIED_ROLE, UNRELATED_ROLE].sort());
  });

  it('never touches the quarantine role or unrelated roles', async () => {
    await bot.kit.db
      .update(members)
      .set({ standing: 'quarantined' })
      .where(eq(members.id, target.actor.memberId!));
    bot.gateway.members.get(target.actor.discordId)!.roleIds.push(QUARANTINE_ROLE);
    await grantRoleUnchecked(bot.kit.system, {
      memberId: target.actor.memberId!,
      role: 'core',
      reason: 'trigger a sync',
    });
    await bot.drain();
    expect(discordRoles()).toEqual([QUARANTINE_ROLE, UNRELATED_ROLE].sort());
  });

  it('strips managed roles from deleted members', async () => {
    await bot.kit.db
      .update(members)
      .set({ deletedAt: bot.kit.clock.now() })
      .where(eq(members.id, target.actor.memberId!));
    await bot.kit.db.insert(jobs).values({
      type: DISCORD_ROLE_SYNC_JOB,
      payload: { memberId: target.actor.memberId! },
      runAt: bot.kit.clock.now(),
    });
    await bot.drain();
    expect(discordRoles()).toEqual([UNRELATED_ROLE]);
  });

  it('BREAK: Discord refusing the change dead-letters the sync; a transient failure retries', async () => {
    const syncJobs = () =>
      bot.kit.db
        .select({ status: jobs.status, attempts: jobs.attempts })
        .from(jobs)
        .where(
          and(
            eq(jobs.type, DISCORD_ROLE_SYNC_JOB),
            eq(jobs.dedupeKey, `roles-sync:${target.actor.memberId!}`),
          ),
        );
    await bot.kit.db.delete(jobs);
    // JAVE's role below the mapped role: Discord answers Missing Permissions.
    bot.gateway.failures.set(
      'addRoles',
      new DiscordActionError('Missing Permissions', 50013, true),
    );
    await grantRoleUnchecked(bot.kit.system, {
      memberId: target.actor.memberId!,
      role: 'member',
      reason: 'lapsed verification',
    });
    await bot.drain();
    expect(await syncJobs()).toEqual([expect.objectContaining({ status: 'dead', attempts: 1 })]);
    // Nothing half-applied: the refused add comes before any removal.
    expect(discordRoles()).toEqual([SUPPORTER_ROLE, VERIFIED_ROLE, UNRELATED_ROLE].sort());

    bot.gateway.failures.set('addRoles', new DiscordActionError('gateway timeout', null, false));
    await revokeRoleUnchecked(bot.kit.system, {
      memberId: target.actor.memberId!,
      role: 'supporter',
      reason: 'lapsed',
    });
    await bot.drain();
    const [retrying] = (await syncJobs()).filter((job) => job.status !== 'dead');
    expect(retrying).toMatchObject({ status: 'pending', attempts: 1 });
  });
});

describe('role sync: mapping changes and what Discord allows', () => {
  let bot: BotHarness;
  let founder: UserActor;
  /** Another process (the dashboard): same database, its own settings cache. */
  let dashboard: ServiceContext;

  beforeEach(async () => {
    bot = await createBotHarness();
    founder = (await bot.member({ roles: ['founder'] })).actor;
    dashboard = { ...bot.kit.as(founder), cache: new TtlCache() };
  });
  afterEach(async () => {
    await bot.close();
  });

  const rolesOf = (actor: UserActor) =>
    [...bot.gateway.members.get(actor.discordId)!.roleIds].sort();
  const deadJobs = () =>
    bot.kit.db.select({ type: jobs.type }).from(jobs).where(eq(jobs.status, 'dead'));

  it('applies a mapping made on the dashboard even while the bot caches the old one', async () => {
    const member = (await bot.member({ roles: ['member'] })).actor;
    await bot.drain();
    // The bot reads the roles section (a sync, /settings view, readiness…): now cached.
    expect((await getSettings(bot.kit.system, 'roles')).discordRoleIds).toEqual({});

    await updateSettings(dashboard, 'roles', { discordRoleIds: { member: MEMBER_ROLE } });
    await bot.drain();
    expect(rolesOf(member)).toEqual([MEMBER_ROLE]);

    // Sync switched off and back on from the dashboard: the bot acts on it at once too.
    await updateSettings(dashboard, 'roles', { syncToDiscord: false });
    await getSettings(bot.kit.system, 'roles');
    bot.gateway.members.get(member.discordId)!.roleIds.length = 0;
    await updateSettings(dashboard, 'roles', { syncToDiscord: true });
    await bot.drain();
    expect(rolesOf(member)).toEqual([MEMBER_ROLE]);
  });

  it('BREAK: never hands out Administrator, or elevated roles through a non-staff mapping', async () => {
    bot.gateway.addRole(ADMIN_ROLE, 'Operators', 30, false, ['Administrator']);
    bot.gateway.addRole(MODS_ROLE, 'Mods', 25, false, ['KickMembers', 'BanMembers']);
    const member = (await bot.member({ roles: ['member'] })).actor;
    const verified = (await bot.member({ roles: ['verified'] })).actor;
    const moderator = (await bot.member({ roles: ['moderator'] })).actor;
    const core = bot.kit.as((await bot.member({ roles: ['core'] })).actor);
    await bot.drain();

    // The dashboard cannot inspect Discord roles: core accepts these non-staff mappings.
    await updateSettings(core, 'roles', {
      discordRoleIds: { member: ADMIN_ROLE, verified: MODS_ROLE },
    });
    await bot.drain();
    expect(rolesOf(member)).toEqual([]);
    expect(rolesOf(verified)).toEqual([]);

    // A founder's staff mapping may carry elevated permissions, never Administrator.
    await updateSettings(bot.kit.as(founder), 'roles', {
      discordRoleIds: { moderator: MODS_ROLE, core: ADMIN_ROLE },
    });
    await bot.drain();
    expect(rolesOf(moderator)).toEqual([MODS_ROLE]);
    expect(rolesOf(core.actor as UserActor)).toEqual([]);
    expect(await deadJobs()).toEqual([]);
  });

  it('withholds a role above JAVE without dead letters; RE-SYNC applies it once fixed', async () => {
    bot.gateway.addRole(VERIFIED_ROLE, 'Verified', 60);
    const verified = (await bot.member({ roles: ['verified'] })).actor;
    await updateSettings(dashboard, 'roles', { discordRoleIds: { verified: VERIFIED_ROLE } });
    await bot.drain();
    expect(rolesOf(verified)).toEqual([]);
    expect(await deadJobs()).toEqual([]);

    bot.gateway.botHighestRolePosition = 70;
    await requestRoleResync(bot.kit.as(founder));
    await bot.drain();
    expect(rolesOf(verified)).toEqual([VERIFIED_ROLE]);
  });

  it('retiring skips a role that is mapped again, and does nothing while sync is off', async () => {
    const verified = (await bot.member({ roles: ['verified'] })).actor;
    await updateSettings(dashboard, 'roles', { discordRoleIds: { verified: VERIFIED_ROLE } });
    await bot.drain();
    expect(rolesOf(verified)).toEqual([VERIFIED_ROLE]);

    // Remapped to MEMBER before the retire job runs: still managed, kept where due.
    await updateSettings(dashboard, 'roles', { discordRoleIds: { member: VERIFIED_ROLE } });
    await updateSettings(dashboard, 'roles', {
      discordRoleIds: { member: VERIFIED_ROLE, verified: SUPPORTER_ROLE },
    });
    await bot.drain();
    expect(rolesOf(verified)).toEqual([SUPPORTER_ROLE]);

    await updateSettings(dashboard, 'roles', { syncToDiscord: false });
    await updateSettings(dashboard, 'roles', { discordRoleIds: {} });
    await bot.drain();
    expect(rolesOf(verified)).toEqual([SUPPORTER_ROLE]);
    const retired = await bot.kit.db
      .select({ result: jobs.result })
      .from(jobs)
      .where(eq(jobs.type, DISCORD_ROLE_RETIRE_JOB));
    expect(retired.map((j) => j.result)).toContainEqual({ skipped: 'sync disabled' });
  });

  it('BREAK: a malformed retire job dead-letters without touching Discord', async () => {
    await bot.kit.db.insert(jobs).values({
      type: DISCORD_ROLE_RETIRE_JOB,
      payload: { memberId: founder.memberId!, roleId: 'not-a-role' },
      runAt: bot.kit.clock.now(),
    });
    await bot.drain();
    expect(await deadJobs()).toEqual([{ type: DISCORD_ROLE_RETIRE_JOB }]);
    expect(bot.gateway.callsTo('removeRoles')).toHaveLength(0);
  });
});

/**
 * Real interleaving needs real connections: on PGlite (one connection) jobs
 * cannot overlap at all, so this runs on the Postgres test backend only.
 */
describe.skipIf(testBackend() !== 'postgres')('role sync: concurrent jobs on real Postgres', () => {
  let bot: BotHarness;
  beforeEach(async () => {
    bot = await createBotHarness();
  });
  afterEach(async () => {
    await bot.close();
  });

  /** Long enough for an unserialized retire job to finish on a local database. */
  const OVERLAP_WINDOW_MS = 300;

  it('a sync that read the old mapping cannot re-add a role the retire job removes', async () => {
    const founder = (await bot.member({ roles: ['founder'] })).actor;
    const dashboard: ServiceContext = { ...bot.kit.as(founder), cache: new TtlCache() };
    const verified = (await bot.member({ roles: ['verified'] })).actor;
    await updateSettings(dashboard, 'roles', { discordRoleIds: { verified: VERIFIED_ROLE } });
    await bot.drain();
    const holder = bot.gateway.members.get(verified.discordId)!;
    expect(holder.roleIds).toEqual([VERIFIED_ROLE]);

    // Discord lost the role; a sync starts, reads the mapping, and stalls inside addRoles.
    holder.roleIds.length = 0;
    const addRoles = bot.gateway.addRoles.bind(bot.gateway);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let entered!: () => void;
    const stalled = new Promise<void>((resolve) => (entered = resolve));
    vi.spyOn(bot.gateway, 'addRoles').mockImplementationOnce(async (...args) => {
      entered();
      await gate;
      return addRoles(...args);
    });
    const [sync] = await bot.kit.db
      .insert(jobs)
      .values({
        type: DISCORD_ROLE_SYNC_JOB,
        payload: { memberId: verified.memberId! },
        runAt: bot.kit.clock.now(),
        dedupeKey: `roles-sync:${verified.memberId!}`,
      })
      .returning({ id: jobs.id });
    const syncRun = bot.app.worker.runNow([sync!.id]);
    await stalled;

    // Meanwhile the dashboard clears the mapping: VERIFIED_ROLE is retired.
    await updateSettings(dashboard, 'roles', { discordRoleIds: {} });
    const [retire] = await bot.kit.db
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        and(
          eq(jobs.type, DISCORD_ROLE_RETIRE_JOB),
          eq(jobs.dedupeKey, `roles-retire:${VERIFIED_ROLE}:${verified.memberId!}`),
        ),
      );
    const retireRun = bot.app.worker.runNow([retire!.id]);
    const finishedFirst = await Promise.race([
      retireRun.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), OVERLAP_WINDOW_MS)),
    ]);
    expect(finishedFirst).toBe(false);

    release();
    await Promise.all([syncRun, retireRun]);
    await bot.drain();
    expect(holder.roleIds).toEqual([]);
  });
});
