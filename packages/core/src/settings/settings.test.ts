import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { auditLogs, jobs, members, serverSettings } from '@jave/database';
import { createTestKit, type TestKit } from '../testing';
import { ForbiddenError, ValidationError } from '../kernel/errors';
import { silentLogger } from '../kernel/logger';
import { defaultSettings, SETTINGS_SECTIONS, type Settings } from './schemas';
import {
  getAllSettings,
  getSettings,
  getSettingsFresh,
  requestRoleResync,
  updateSettings,
} from './settings.service';
import { mayMapRole } from './role-mapping';
import { DISCORD_ROLE_SYNC_JOB } from '../identity/users.service';
import { DISCORD_ROLE_RETIRE_JOB } from '../identity/role-resync';
import { TtlCache } from '../kernel/cache';

const MEMBER_ROLE = '500000000000000001';
const VERIFIED_ROLE = '500000000000000002';
const STAFF_ROLE = '500000000000000060';
const HELPERS_ROLE = '500000000000000061';
const QUARANTINE_ROLE = '500000000000000009';

describe('settings', () => {
  let kit: TestKit;
  beforeEach(async () => {
    kit = await createTestKit();
  });
  afterEach(async () => {
    await kit.close();
  });

  it('every section has complete defaults', () => {
    for (const section of SETTINGS_SECTIONS) expect(() => defaultSettings(section)).not.toThrow();
  });

  it('returns defaults on an empty database', async () => {
    const trials = await getSettings(kit.system, 'trials');
    expect(trials.passThreshold).toBe(6);
    expect(trials.adversarialEnabled).toBe(false);
  });

  it('updates with validation, audit diff and cache invalidation', async () => {
    const founder = await kit.member({ roles: ['founder'] });
    const ctx = kit.as(founder);
    await getSettings(ctx, 'tickets');
    await updateSettings(ctx, 'tickets', { maxOpenPerUser: 5 });
    expect((await getSettings(ctx, 'tickets')).maxOpenPerUser).toBe(5);
    const [audit] = await kit.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'settings.updated'));
    expect(audit!.context).toMatchObject({ changes: { maxOpenPerUser: { from: 3, to: 5 } } });
  });

  it('rejects invalid values', async () => {
    const founder = await kit.member({ roles: ['founder'] });
    await expect(
      updateSettings(kit.as(founder), 'channels', { welcome: 'not-a-snowflake' }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      updateSettings(kit.as(founder), 'moderation', {
        links: { mode: 'allowlist', allowlist: ['javascript:alert(1)'], denylist: [] },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('lets one Discord role back several JAVE roles, but never the quarantine role', async () => {
    const founder = kit.as(await kit.member({ roles: ['founder'] }));
    await expect(
      updateSettings(founder, 'roles', {
        discordRoleIds: { core: STAFF_ROLE, operations: STAFF_ROLE, moderator: STAFF_ROLE },
      }),
    ).resolves.toMatchObject({
      discordRoleIds: { core: STAFF_ROLE, operations: STAFF_ROLE, moderator: STAFF_ROLE },
    });
    await expect(
      updateSettings(founder, 'roles', { quarantineRoleId: STAFF_ROLE }),
    ).rejects.toThrow(/mapped to CORE, OPERATIONS, MODERATOR; quarantine needs its own role/);
    await expect(
      updateSettings(founder, 'roles', (current) => ({
        quarantineRoleId: QUARANTINE_ROLE,
        discordRoleIds: { ...current.discordRoleIds, member: QUARANTINE_ROLE },
      })),
    ).rejects.toThrow(/mapped to MEMBER/);
    await expect(
      updateSettings(founder, 'roles', { quarantineRoleId: QUARANTINE_ROLE }),
    ).resolves.toMatchObject({ quarantineRoleId: QUARANTINE_ROLE });
  });

  it('reads a stored role mapping back exactly as stored, whatever rules writes follow now', async () => {
    const stored = {
      discordRoleIds: {
        core: STAFF_ROLE,
        operations: STAFF_ROLE,
        moderator: STAFF_ROLE,
        verified: VERIFIED_ROLE,
      },
      quarantineRoleId: QUARANTINE_ROLE,
      syncToDiscord: true,
    };
    await kit.db.insert(serverSettings).values({ section: 'roles', value: stored });
    expect(await getSettings(kit.system, 'roles')).toEqual(stored);

    // An unrelated write keeps every stored mapping.
    const founder = kit.as(await kit.member({ roles: ['founder'] }));
    await updateSettings(founder, 'roles', (current) => ({
      discordRoleIds: { ...current.discordRoleIds, member: MEMBER_ROLE },
    }));
    expect(await getSettings(kit.system, 'roles')).toEqual({
      ...stored,
      discordRoleIds: { ...stored.discordRoleIds, member: MEMBER_ROLE },
    });
  });

  it('never lets a stored quarantine conflict block unrelated changes', async () => {
    const conflicted = {
      discordRoleIds: { member: QUARANTINE_ROLE },
      quarantineRoleId: QUARANTINE_ROLE,
      syncToDiscord: true,
    };
    await kit.db.insert(serverSettings).values({ section: 'roles', value: conflicted });
    expect(await getSettings(kit.system, 'roles')).toEqual(conflicted);
    const founder = kit.as(await kit.member({ roles: ['founder'] }));
    await expect(updateSettings(founder, 'roles', { syncToDiscord: false })).resolves.toMatchObject(
      { syncToDiscord: false },
    );
    // Mapping a second role onto the quarantine role is a new conflict: refused.
    await expect(
      updateSettings(founder, 'roles', (current) => ({
        discordRoleIds: { ...current.discordRoleIds, verified: QUARANTINE_ROLE },
      })),
    ).rejects.toThrow(/mapped to VERIFIED/);
    // Resolving it is always allowed.
    await expect(
      updateSettings(founder, 'roles', { discordRoleIds: { member: MEMBER_ROLE } }),
    ).resolves.toMatchObject({ discordRoleIds: { member: MEMBER_ROLE } });
  });

  it('recovers an invalid stored section field by field and says which fields', async () => {
    await kit.db.insert(serverSettings).values({
      section: 'applications',
      value: { open: 'yes', cooldownDaysAfterRejection: 12, minReviewsBeforeDecision: 99 },
    });
    const logger = silentLogger.child({});
    const warn = vi.spyOn(logger, 'warn');
    const reader = { ...kit.system, logger, cache: new TtlCache() };
    const applications = await getSettings(reader, 'applications');
    expect(applications).toMatchObject({
      open: true,
      cooldownDaysAfterRejection: 12,
      minReviewsBeforeDecision: 1,
    });
    expect(warn).toHaveBeenCalledWith(
      { section: 'applications', invalidFields: ['open', 'minReviewsBeforeDecision'] },
      expect.stringContaining('invalid fields read as their defaults'),
    );
  });

  describe('who may change a role mapping', () => {
    it('staff mappings are founder-only; core maps roles below staff', async () => {
      const core = kit.as(await kit.member({ roles: ['core'] }));
      for (const role of ['founder', 'core', 'operations', 'moderator'] as const) {
        await expect(
          updateSettings(core, 'roles', { discordRoleIds: { [role]: STAFF_ROLE } }),
          role,
        ).rejects.toThrow('Only a founder can map staff roles to Discord.');
      }
      await expect(
        updateSettings(core, 'roles', { discordRoleIds: { member: MEMBER_ROLE } }),
      ).resolves.toMatchObject({ discordRoleIds: { member: MEMBER_ROLE } });
      await expect(
        updateSettings(core, 'roles', { quarantineRoleId: QUARANTINE_ROLE }),
      ).resolves.toMatchObject({ quarantineRoleId: QUARANTINE_ROLE });
    });

    it('BREAK: core cannot clear or replace a staff mapping a founder made', async () => {
      const founder = kit.as(await kit.member({ roles: ['founder'] }));
      await updateSettings(founder, 'roles', { discordRoleIds: { moderator: STAFF_ROLE } });
      const core = kit.as(await kit.member({ roles: ['core'] }));
      await expect(updateSettings(core, 'roles', { discordRoleIds: {} })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await expect(
        updateSettings(core, 'roles', { discordRoleIds: { moderator: MEMBER_ROLE } }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      // A dashboard-style save that re-submits the staff mapping unchanged is fine.
      await expect(
        updateSettings(core, 'roles', {
          discordRoleIds: { moderator: STAFF_ROLE, verified: VERIFIED_ROLE },
          syncToDiscord: true,
        }),
      ).resolves.toMatchObject({ discordRoleIds: { moderator: STAFF_ROLE } });
    });

    it('mayMapRole follows the hierarchy for every actor kind', async () => {
      const founder = await kit.member({ roles: ['founder'] });
      const core = await kit.member({ roles: ['core'] });
      expect(mayMapRole(founder, 'founder')).toBe(true);
      expect(mayMapRole(core, 'core')).toBe(false);
      expect(mayMapRole(core, 'verified')).toBe(true);
      expect(mayMapRole(kit.system.actor, 'founder')).toBe(true);
      expect(mayMapRole({ kind: 'anonymous' }, 'member')).toBe(false);
    });
  });

  it('retires a replaced or cleared Discord role from every present member', async () => {
    const founder = kit.as(await kit.member({ roles: ['founder'] }));
    const present = await kit.member();
    await updateSettings(founder, 'roles', {
      discordRoleIds: { moderator: STAFF_ROLE, verified: VERIFIED_ROLE },
    });
    await kit.db.delete(jobs);
    const retireJobs = async () =>
      (await kit.db.select().from(jobs).where(eq(jobs.type, DISCORD_ROLE_RETIRE_JOB))).map(
        (job) => job.payload,
      );

    await updateSettings(founder, 'roles', {
      discordRoleIds: { moderator: HELPERS_ROLE, verified: VERIFIED_ROLE },
    });
    expect(await retireJobs()).toContainEqual({ memberId: present.memberId, roleId: STAFF_ROLE });
    expect((await retireJobs()).map((p) => p.roleId)).not.toContain(VERIFIED_ROLE);

    // A role that stays mapped elsewhere is not retired.
    await kit.db.delete(jobs);
    await updateSettings(founder, 'roles', {
      discordRoleIds: { moderator: VERIFIED_ROLE, verified: VERIFIED_ROLE },
    });
    expect((await retireJobs()).map((p) => p.roleId)).toEqual(
      expect.not.arrayContaining([VERIFIED_ROLE]),
    );
    expect((await retireJobs()).map((p) => p.roleId)).toContain(HELPERS_ROLE);
  });

  describe('requestRoleResync', () => {
    it('queues a sync per present member and audits the request', async () => {
      const core = kit.as(await kit.member({ roles: ['core'] }));
      const other = await kit.member();
      await kit.db.delete(jobs);
      const count = await requestRoleResync(core);
      expect(count).toBeGreaterThanOrEqual(2);
      const queued = await kit.db.select().from(jobs).where(eq(jobs.type, DISCORD_ROLE_SYNC_JOB));
      expect(queued.map((job) => job.payload.memberId)).toContain(other.memberId);
      const [audit] = await kit.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'settings.roles_resync_requested'));
      expect(audit!.context).toMatchObject({ members: count });
    });

    it('BREAK: refused without canManageSettings, and while role sync is off', async () => {
      const ops = kit.as(await kit.member({ roles: ['operations'] }));
      await expect(requestRoleResync(ops)).rejects.toBeInstanceOf(ForbiddenError);
      const founder = kit.as(await kit.member({ roles: ['founder'] }));
      await updateSettings(founder, 'roles', { syncToDiscord: false });
      await expect(requestRoleResync(founder)).rejects.toThrow('Role sync is off.');
    });
  });

  it('getSettingsFresh sees another process’s change and refreshes the cache', async () => {
    const founder = await kit.member({ roles: ['founder'] });
    const bot = { ...kit.as(founder), cache: new TtlCache(() => kit.clock.now().getTime()) };
    const dashboard = kit.as(founder);
    expect((await getSettings(bot, 'roles')).discordRoleIds).toEqual({});
    await updateSettings(dashboard, 'roles', { discordRoleIds: { member: MEMBER_ROLE } });
    expect((await getSettings(bot, 'roles')).discordRoleIds).toEqual({});
    expect((await getSettingsFresh(bot, 'roles')).discordRoleIds).toEqual({ member: MEMBER_ROLE });
    expect((await getSettings(bot, 'roles')).discordRoleIds).toEqual({ member: MEMBER_ROLE });
  });

  it('re-syncs every present member when the role mapping changes, in the background', async () => {
    const founder = kit.as(await kit.member({ roles: ['founder'] }));
    const present = await kit.member();
    const departed = await kit.member();
    await kit.db
      .update(members)
      .set({ guildStatus: 'departed' })
      .where(eq(members.id, departed.memberId!));
    await kit.db.delete(jobs);

    await updateSettings(founder, 'roles', { discordRoleIds: { member: '500000000000000001' } });
    const queued = await kit.db.select().from(jobs).where(eq(jobs.type, DISCORD_ROLE_SYNC_JOB));
    const memberIds = queued.map((job) => job.payload.memberId);
    expect(memberIds).toContain(present.memberId);
    expect(memberIds).not.toContain(departed.memberId);
    expect(founder.effects.jobIds).not.toEqual(expect.arrayContaining(queued.map((j) => j.id)));

    await kit.db.delete(jobs);
    await updateSettings(founder, 'roles', { syncToDiscord: false });
    await updateSettings(founder, 'tickets', { maxOpenPerUser: 4 });
    expect(await kit.db.select().from(jobs).where(eq(jobs.type, DISCORD_ROLE_SYNC_JOB))).toEqual(
      [],
    );
    await updateSettings(founder, 'roles', { syncToDiscord: true });
    expect(
      (await kit.db.select().from(jobs).where(eq(jobs.type, DISCORD_ROLE_SYNC_JOB))).length,
    ).toBeGreaterThan(0);
  });

  it('merges over the stored value, never over the stale cache of another process', async () => {
    const founder = await kit.member({ roles: ['founder'] });
    // Two processes (bot and dashboard): same database, separate caches.
    const bot = { ...kit.as(founder), cache: new TtlCache(() => kit.clock.now().getTime()) };
    const dashboard = kit.as(founder);
    expect((await getSettings(bot, 'roles')).discordRoleIds).toEqual({});

    await updateSettings(dashboard, 'roles', { discordRoleIds: { member: MEMBER_ROLE } });
    // The bot still caches the old section; its own changes must not undo the dashboard's.
    expect((await getSettings(bot, 'roles')).discordRoleIds).toEqual({});
    await updateSettings(bot, 'roles', { syncToDiscord: false });
    await updateSettings(bot, 'roles', (current) => ({
      discordRoleIds: { ...current.discordRoleIds, verified: VERIFIED_ROLE },
    }));
    expect(await getSettings(kit.as(founder), 'roles')).toMatchObject({
      discordRoleIds: { member: MEMBER_ROLE, verified: VERIFIED_ROLE },
      syncToDiscord: false,
    });
  });

  it('serializes concurrent writes of a section, including its very first write', async () => {
    const founder = await kit.member({ roles: ['founder'] });
    // Separate contexts and caches, as two processes would have.
    const first = kit.as(founder);
    const second = { ...kit.as(founder), cache: new TtlCache(() => kit.clock.now().getTime()) };
    const addRole = (role: 'member' | 'verified', id: string) => (current: Settings<'roles'>) => ({
      discordRoleIds: { ...current.discordRoleIds, [role]: id },
    });
    await Promise.all([
      updateSettings(first, 'roles', addRole('member', MEMBER_ROLE)),
      updateSettings(second, 'roles', addRole('verified', VERIFIED_ROLE)),
    ]);
    expect((await getSettings(kit.as(founder), 'roles')).discordRoleIds).toEqual({
      member: MEMBER_ROLE,
      verified: VERIFIED_ROLE,
    });
    const audits = await kit.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'settings.updated'));
    expect(audits).toHaveLength(2);
  });

  it('writes the value, its audit entry and its event together or not at all', async () => {
    const founder = kit.as(await kit.member({ roles: ['founder'] }));
    await updateSettings(founder, 'roles', { discordRoleIds: { member: MEMBER_ROLE } });
    const audits = async () =>
      (await kit.db.select().from(auditLogs).where(eq(auditLogs.action, 'settings.updated')))
        .length;
    const before = await audits();
    await expect(
      updateSettings(founder, 'roles', { quarantineRoleId: MEMBER_ROLE }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await audits()).toBe(before);
    expect((await getSettings(founder, 'roles')).discordRoleIds).toEqual({ member: MEMBER_ROLE });
    // A patch that changes nothing writes nothing.
    await updateSettings(founder, 'roles', { discordRoleIds: { member: MEMBER_ROLE } });
    expect(await audits()).toBe(before);
  });

  it('BREAK: operations can view but not change settings', async () => {
    const ops = await kit.member({ roles: ['operations'] });
    await expect(getAllSettings(kit.as(ops))).resolves.toBeTruthy();
    await expect(updateSettings(kit.as(ops), 'ai', { enabled: false })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('falls back to defaults when the stored value is corrupt', async () => {
    await kit.db
      .insert(serverSettings)
      .values({ section: 'trials', value: { passThreshold: 'banana' } });
    expect((await getSettings(kit.system, 'trials')).passThreshold).toBe(6);
  });
});
