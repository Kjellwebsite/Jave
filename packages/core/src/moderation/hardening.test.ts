import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { members, modCases } from '@jave/database';
import { createTestKit, type TestKit } from '../testing';
import { HOUR } from '../kernel/clock';
import { ConflictError, ForbiddenError, ValidationError } from '../kernel/errors';
import { enqueueJob } from '../jobs/queue';
import { grantRoleUnchecked } from '../identity/roles.service';
import type { UserActor } from '../permissions/actor';
import { executeCase } from './case-engine';
import {
  banMember,
  quarantineMember,
  releaseMember,
  revokeCase,
  unbanMember,
  warnMember,
} from './cases.service';
import { jobHandlers } from './index';
import { recordSecurityEvent, reviewSecurityEvent } from './security.service';
import { SWEEP_EXPIRED_JOB } from './sweeps';
import { loadTarget } from './targets';
import { INTEGRATION_TIMEOUTS, configureModeration } from './test-support';

vi.setConfig(INTEGRATION_TIMEOUTS);

describe('BREAK: moderation hardening', () => {
  let kit: TestKit;
  let moderator: UserActor;
  let core: UserActor;
  let member: UserActor;

  beforeEach(async () => {
    kit = await createTestKit();
    await configureModeration(kit);
    moderator = await kit.member({ roles: ['moderator'], username: 'mod' });
    core = await kit.member({ roles: ['core'], username: 'core' });
    member = await kit.member({ roles: ['verified'], username: 'member' });
  });
  afterEach(async () => {
    await kit.close();
  });

  const liveCases = (userId: string) =>
    kit.db
      .select()
      .from(modCases)
      .where(and(eq(modCases.targetUserId, userId), isNull(modCases.endedAt)));
  const standing = async (actor: UserActor) =>
    (await kit.db.select().from(members).where(eq(members.id, actor.memberId!)))[0]?.standing;

  it('cannot revoke a case about a member promoted to your rank since', async () => {
    const warn = await warnMember(kit.as(moderator), {
      targetUserId: member.userId,
      reason: 'Before promotion.',
    });
    await grantRoleUnchecked(kit.system, {
      memberId: member.memberId!,
      role: 'moderator',
      reason: 'Promoted.',
    });
    await expect(
      revokeCase(kit.as(moderator), { caseId: warn.id, reason: 'Peer favour.' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const revoked = await revokeCase(kit.as(core), { caseId: warn.id, reason: 'Issued in error.' });
    expect(revoked.case.revokedAt).not.toBeNull();
  });

  it('the case engine refuses automated punishment of staff even if a caller forgets', async () => {
    const staffTarget = await loadTarget(kit.system, { userId: moderator.userId });
    for (const action of ['warn', 'timeout', 'kick', 'ban', 'quarantine'] as const) {
      await expect(
        executeCase(kit.system, {
          action,
          target: staffTarget,
          reason: 'Automated.',
          source: 'automod',
          durationSeconds: action === 'timeout' ? 600 : null,
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
    expect(await kit.db.select().from(modCases)).toHaveLength(0);
    expect(await standing(moderator)).toBe('good');
  });

  it('concurrent ban and quarantine never leave both in force', async () => {
    await Promise.allSettled([
      banMember(kit.as(core), { targetUserId: member.userId, reason: 'Race: ban.' }),
      quarantineMember(kit.as(moderator), { targetUserId: member.userId, reason: 'Race: hold.' }),
    ]);
    const live = await liveCases(member.userId);
    expect(live.map((c) => c.action)).toEqual(['ban']);
    expect(await standing(member)).toBe('banned');
  });

  it('revoking a quarantine that was already released only strikes it', async () => {
    const q = await quarantineMember(kit.as(moderator), {
      targetUserId: member.userId,
      reason: 'Hold.',
    });
    await releaseMember(kit.as(moderator), { targetUserId: member.userId, reason: 'Cleared.' });
    const result = await revokeCase(kit.as(moderator), { caseId: q.id, reason: 'Never needed.' });
    expect(result.reversal).toBeNull();
    expect(result.case).toMatchObject({ endedReason: 'lifted', inForce: false });
    expect(await standing(member)).toBe('good');
  });

  it('manual cases cannot claim to be automod or system', async () => {
    for (const source of ['automod', 'system', 'security_event']) {
      await expect(
        warnMember(kit.as(moderator), {
          targetUserId: member.userId,
          reason: 'Forged source.',
          source: source as 'manual',
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    }
  });

  it('moderators cannot unban directly', async () => {
    await banMember(kit.as(core), { targetUserId: member.userId, reason: 'Ban.' });
    await expect(
      unbanMember(kit.as(moderator), { targetUserId: member.userId, reason: 'Let back.' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await standing(member)).toBe('banned');
  });

  it('concurrent reviews of one security event: exactly one wins', async () => {
    const event = await recordSecurityEvent(kit.system, {
      targetUserId: member.userId,
      trigger: 'spam_rate',
      riskScore: 50,
    });
    const other = await kit.member({ roles: ['moderator'] });
    const results = await Promise.allSettled([
      reviewSecurityEvent(kit.as(moderator), { securityEventId: event.id, status: 'dismissed' }),
      reviewSecurityEvent(kit.as(other), { securityEventId: event.id, status: 'actioned' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason.code).toMatch(
      /^(CONFLICT|INVALID_STATE)$/,
    );
  });

  describe('expiry sweep isolation', () => {
    /** Make every future insert of a release case for `userId` fail, like a broken row would. */
    const breakReleasesFor = async (userId: string) => {
      expect(userId).toMatch(/^[0-9a-f-]{36}$/);
      await kit.database.exec(`
        create function fail_release() returns trigger language plpgsql as $$
        begin
          if new.action = 'release' and new.target_user_id = '${userId}' then
            raise exception 'simulated failure';
          end if;
          return new;
        end $$;
        create trigger fail_release before insert on mod_cases
          for each row execute function fail_release();
      `);
    };

    it('one failing release does not block the others', async () => {
      const second = await kit.member({ roles: ['verified'] });
      for (const target of [member, second]) {
        await quarantineMember(kit.as(moderator), {
          targetUserId: target.userId,
          reason: 'Timed hold.',
          durationSeconds: HOUR / 1000,
        });
      }
      await breakReleasesFor(member.userId);
      kit.clock.advance(HOUR);
      await enqueueJob(kit.system, SWEEP_EXPIRED_JOB);
      const [outcome] = await kit.drain(jobHandlers);
      expect(outcome).toMatchObject({
        status: 'completed',
        result: { quarantinesReleased: 1, failed: 1 },
      });
      expect(await standing(second)).toBe('good');
      expect(await standing(member)).toBe('quarantined');
    });

    it('fails the job when nothing could be released', async () => {
      await quarantineMember(kit.as(moderator), {
        targetUserId: member.userId,
        reason: 'Timed hold.',
        durationSeconds: HOUR / 1000,
      });
      await breakReleasesFor(member.userId);
      kit.clock.advance(HOUR);
      await enqueueJob(kit.system, SWEEP_EXPIRED_JOB);
      const [outcome] = await kit.drain(jobHandlers);
      expect(outcome?.status).toBe('retry');
      expect(await standing(member)).toBe('quarantined');
    });
  });

  it('a second ban of the same member is a conflict, not a duplicate case', async () => {
    await banMember(kit.as(core), { targetUserId: member.userId, reason: 'First.' });
    await expect(
      banMember(kit.as(core), { targetUserId: member.userId, reason: 'Second.' }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(await liveCases(member.userId)).toHaveLength(1);
  });
});
