import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { auditLogs, jobs, members } from '@jave/database';
import { createTestKit, type TestKit } from '../testing';
import { ForbiddenError, ValidationError } from '../kernel/errors';
import { defaultSettings, SETTINGS_SECTIONS } from './schemas';
import { getAllSettings, getSettings, updateSettings } from './settings.service';
import { DISCORD_ROLE_SYNC_JOB } from '../identity/users.service';

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

  it('BREAK: refuses one Discord role for two JAVE roles, or a managed quarantine role', async () => {
    const founder = kit.as(await kit.member({ roles: ['founder'] }));
    await expect(
      updateSettings(founder, 'roles', {
        discordRoleIds: { member: '500000000000000001', verified: '500000000000000001' },
      }),
    ).rejects.toThrow(/already mapped to MEMBER/);
    await updateSettings(founder, 'roles', { discordRoleIds: { trial: '500000000000000002' } });
    await expect(
      updateSettings(founder, 'roles', { quarantineRoleId: '500000000000000002' }),
    ).rejects.toThrow(/quarantine needs its own role/);
    await expect(
      updateSettings(founder, 'roles', { quarantineRoleId: '500000000000000003' }),
    ).resolves.toMatchObject({ quarantineRoleId: '500000000000000003' });
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

  it('BREAK: operations can view but not change settings', async () => {
    const ops = await kit.member({ roles: ['operations'] });
    await expect(getAllSettings(kit.as(ops))).resolves.toBeTruthy();
    await expect(updateSettings(kit.as(ops), 'ai', { enabled: false })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('falls back to defaults when the stored value is corrupt', async () => {
    const { serverSettings } = await import('@jave/database');
    await kit.db
      .insert(serverSettings)
      .values({ section: 'trials', value: { passThreshold: 'banana' } });
    expect((await getSettings(kit.system, 'trials')).passThreshold).toBe(6);
  });
});
