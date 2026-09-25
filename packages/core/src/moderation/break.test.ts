import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { auditLogs, members, modCases, securityEvents } from '@jave/database';
import { createTestKit, type TestKit } from '../testing';
import {
  ConflictError,
  ForbiddenError,
  UnauthenticatedError,
  ValidationError,
} from '../kernel/errors';
import { resolveUserActor } from '../identity/users.service';
import { anonymousActor, systemActor, type UserActor } from '../permissions/actor';
import { applyAutomodDecision, screenMessage } from './automod.service';
import {
  banMember,
  kickMember,
  markCaseSynced,
  quarantineMember,
  releaseMember,
  revokeCase,
  timeoutMember,
  warnMember,
} from './cases.service';
import { getCase, getCaseHistory, listCases } from './cases.query';
import { MAX_QUARANTINE_SECONDS } from './constants';
import { getSecurityAlertCard, getSecurityEvent, listSecurityEvents } from './security.query';
import {
  markSecurityAlertPosted,
  recordSecurityEvent,
  reviewSecurityEvent,
} from './security.service';
import * as moderationModule from './index';
import { sweepExpiredCases } from './sweeps';
import { hierarchyViolation, overturnViolation } from './targets';
import { INTEGRATION_TIMEOUTS, configureModeration, MESSAGE_CHANNEL_ID } from './test-support';

vi.setConfig(INTEGRATION_TIMEOUTS);

describe('BREAK: moderation hierarchy (pure)', () => {
  const user = (userId: string, roles: UserActor['roles']): UserActor => ({
    kind: 'user',
    userId,
    discordId: '1',
    memberId: userId,
    displayName: userId,
    roles,
    standing: 'good',
    capabilities: new Set(),
  });
  let founder: UserActor;
  beforeAll(() => {
    founder = user('f', ['founder']);
  });

  it('denies self, equal and higher ranks; allows strictly lower', () => {
    const mod = user('m', ['moderator', 'verified']);
    expect(hierarchyViolation(mod, { userId: 'm', roles: [] }, 'warn')).toMatch(/yourself/);
    expect(hierarchyViolation(mod, { userId: 'x', roles: ['moderator'] }, 'warn')).toMatch(/below/);
    expect(hierarchyViolation(mod, { userId: 'x', roles: ['core'] }, 'timeout')).toMatch(/below/);
    expect(hierarchyViolation(mod, { userId: 'x', roles: ['verified'] }, 'timeout')).toBeNull();
    expect(hierarchyViolation(mod, { userId: 'x', roles: [] }, 'ban')).toBeNull();
  });

  it('founders can only be actioned out-of-band', () => {
    expect(
      hierarchyViolation(user('c', ['core']), { userId: 'f', roles: ['founder'] }, 'warn'),
    ).not.toBeNull();
    expect(
      hierarchyViolation(founder, { userId: 'f2', roles: ['founder'] }, 'quarantine'),
    ).not.toBeNull();
    expect(hierarchyViolation(founder, { userId: 'c', roles: ['core'] }, 'ban')).toBeNull();
  });

  it('automation never punishes staff but may lift restrictions', () => {
    const system = systemActor('automod');
    expect(hierarchyViolation(system, { userId: 'x', roles: ['moderator'] }, 'timeout')).toMatch(
      /never applies to staff/,
    );
    expect(hierarchyViolation(system, { userId: 'x', roles: ['moderator'] }, 'release')).toBeNull();
    expect(
      hierarchyViolation(system, { userId: 'x', roles: ['verified'] }, 'quarantine'),
    ).toBeNull();
  });

  it('users with no roles can act on nobody', () => {
    expect(hierarchyViolation(user('n', []), { userId: 'x', roles: [] }, 'warn')).not.toBeNull();
  });

  it('the module API does not leak helpers that skip authorization', () => {
    for (const internal of [
      'executeCase',
      'createSecurityEvent',
      'enqueueDiscordJob',
      'enqueueAlertPost',
      'enqueueAlertRefresh',
      'loadCaseView',
      'loadSecurityEventView',
      'casesForSecurityEvent',
      'sweepExpiredCases',
      'reapplyCase',
      'loadTarget',
      'lockTarget',
      'buildApplyPayload',
    ]) {
      expect(internal in moderationModule, internal).toBe(false);
    }
    expect(typeof moderationModule.banMember).toBe('function');
  });

  it('cannot overturn higher-ranked staff', () => {
    expect(overturnViolation(user('m', ['moderator']), ['core'])).not.toBeNull();
    expect(overturnViolation(user('m', ['moderator']), ['moderator'])).toBeNull();
    expect(overturnViolation(user('m', ['moderator']), null)).toBeNull();
    expect(overturnViolation(systemActor('sweep'), ['founder'])).toBeNull();
  });
});

describe('BREAK: moderation services', () => {
  let kit: TestKit;
  let moderator: UserActor;
  let core: UserActor;
  let member: UserActor;

  beforeEach(async () => {
    kit = await createTestKit({ founderDiscordIds: ['900000000000000001', '900000000000000002'] });
    await configureModeration(kit);
    moderator = await kit.member({ roles: ['moderator'], username: 'mod' });
    core = await kit.member({ roles: ['core'], username: 'core' });
    member = await kit.member({ roles: ['verified'], username: 'member' });
  });
  afterEach(async () => {
    await kit.close();
  });

  const denials = () =>
    kit.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'access.denied'), eq(auditLogs.result, 'denied')));

  it('moderator cannot ban (capability) and the denial is audited', async () => {
    await expect(
      banMember(kit.as(moderator), { targetUserId: member.userId, reason: 'Overreach.' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const [denial] = await denials();
    expect(denial).toMatchObject({ actorUserId: moderator.userId, targetId: member.userId });
    expect(denial?.context).toMatchObject({ capability: 'canBanMembers' });
    expect(await kit.db.select().from(modCases)).toHaveLength(0);
  });

  it('moderator cannot time out core (hierarchy) and the denial is audited', async () => {
    await expect(
      timeoutMember(kit.as(moderator), {
        targetUserId: core.userId,
        reason: 'Revenge.',
        durationSeconds: 600,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const [denial] = await denials();
    expect(denial?.context).toMatchObject({ action: 'timeout' });
  });

  it('moderators cannot act on each other', async () => {
    const peer = await kit.member({ roles: ['moderator'] });
    await expect(
      quarantineMember(kit.as(moderator), { targetUserId: peer.userId, reason: 'Peer.' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('nobody can action themselves', async () => {
    await expect(
      warnMember(kit.as(core), { targetUserId: core.userId, reason: 'Self.' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      kickMember(kit.as(moderator), { targetDiscordId: moderator.discordId, reason: 'Self.' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('founders cannot be actioned, not even by another founder', async () => {
    const founderA = await kit.member({ discordId: '900000000000000001' });
    const founderB = await kit.member({ discordId: '900000000000000002' });
    await expect(
      banMember(kit.as(core), { targetUserId: founderA.userId, reason: 'Coup.' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      quarantineMember(kit.as(founderB), { targetUserId: founderA.userId, reason: 'Coup.' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const ban = await banMember(kit.as(founderA), {
      targetUserId: core.userId,
      reason: 'Founder decision.',
    });
    expect(ban.action).toBe('ban');
  });

  it('members and anonymous visitors cannot moderate or read cases', async () => {
    const other = await kit.member();
    await expect(
      warnMember(kit.as(member), { targetUserId: other.userId, reason: 'Nope.' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      warnMember(kit.as(anonymousActor), { targetUserId: other.userId, reason: 'Nope.' }),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
    const warn = await warnMember(kit.as(moderator), {
      targetUserId: other.userId,
      reason: 'Real.',
    });
    await expect(getCase(kit.as(member), warn.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listCases(kit.as(member), {})).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      getCaseHistory(kit.as(other), { targetUserId: other.userId }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      revokeCase(kit.as(other), { caseId: warn.id, reason: 'Undo mine.' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('a quarantined moderator loses every moderation power', async () => {
    await quarantineMember(kit.as(core), {
      targetUserId: moderator.userId,
      reason: 'Compromised.',
    });
    const quarantined = await resolveUserActor(kit.system, moderator.userId);
    await expect(
      warnMember(kit.as(quarantined), { targetUserId: member.userId, reason: 'Still here?' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listSecurityEvents(kit.as(quarantined), {})).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('cannot overturn decisions of higher-ranked staff', async () => {
    const q = await quarantineMember(kit.as(core), {
      targetUserId: member.userId,
      reason: 'Core hold.',
    });
    await expect(
      releaseMember(kit.as(moderator), { targetUserId: member.userId, reason: 'Let out.' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      revokeCase(kit.as(moderator), { caseId: q.id, reason: 'Let out.' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const [row] = await kit.db.select().from(members).where(eq(members.id, member.memberId!));
    expect(row?.standing).toBe('quarantined');
  });

  it('ban revocation needs canBanMembers', async () => {
    const ban = await banMember(kit.as(core), {
      targetUserId: member.userId,
      reason: 'Spam ring.',
    });
    await expect(
      revokeCase(kit.as(moderator), { caseId: ban.id, reason: 'Appeal.' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const revoked = await revokeCase(kit.as(core), { caseId: ban.id, reason: 'Appeal.' });
    expect(revoked.reversal?.action).toBe('unban');
  });

  it('cannot revoke a case about yourself', async () => {
    const warn = await warnMember(kit.as(core), {
      targetUserId: moderator.userId,
      reason: 'Tone.',
    });
    await expect(
      revokeCase(kit.as(moderator), { caseId: warn.id, reason: 'Disagree.' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('rejects 29-day timeouts and 91-day quarantines', async () => {
    await expect(
      timeoutMember(kit.as(moderator), {
        targetUserId: member.userId,
        reason: 'Too long.',
        durationSeconds: 29 * 24 * 3600,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      quarantineMember(kit.as(moderator), {
        targetUserId: member.userId,
        reason: 'Too long.',
        durationSeconds: MAX_QUARANTINE_SECONDS + 1,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects malformed and huge input', async () => {
    const as = kit.as(moderator);
    await expect(
      warnMember(as, { targetUserId: member.userId, reason: 'x' }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      warnMember(as, { targetUserId: member.userId, reason: 'x'.repeat(10_000) }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      warnMember(as, { targetUserId: 'not-a-uuid', reason: 'Valid reason.' }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      warnMember(as, {
        targetUserId: member.userId,
        targetDiscordId: member.discordId,
        reason: 'Both.',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(warnMember(as, { reason: 'Nobody.' })).rejects.toBeInstanceOf(ValidationError);
    await expect(
      timeoutMember(as, {
        targetUserId: member.userId,
        reason: 'NaN.',
        durationSeconds: Number.NaN,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      timeoutMember(as, { targetUserId: member.userId, reason: 'Frac.', durationSeconds: 90.5 }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(getCase(as, "1' or '1'='1")).rejects.toBeInstanceOf(ValidationError);
  });

  it('duplicate concurrent bans: exactly one wins', async () => {
    const results = await Promise.allSettled([
      banMember(kit.as(core), { targetUserId: member.userId, reason: 'Race one.' }),
      banMember(kit.as(core), { targetUserId: member.userId, reason: 'Race two.' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason).toBeInstanceOf(ConflictError);
    expect(await kit.db.select().from(modCases)).toHaveLength(1);
  });

  it('a security event about someone else cannot be attached to a case', async () => {
    const event = await recordSecurityEvent(kit.system, {
      targetUserId: core.userId,
      trigger: 'spam_rate',
      riskScore: 50,
    });
    await expect(
      quarantineMember(kit.as(moderator), {
        targetUserId: member.userId,
        reason: 'Wrong event.',
        securityEventId: event.id,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  describe('security events (IDOR)', () => {
    it('members cannot read, list, review or report security events', async () => {
      const event = await recordSecurityEvent(kit.system, {
        targetUserId: member.userId,
        trigger: 'foreign_invite',
        riskScore: 45,
      });
      await expect(getSecurityEvent(kit.as(member), event.id)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await expect(listSecurityEvents(kit.as(member), {})).rejects.toBeInstanceOf(ForbiddenError);
      await expect(getSecurityAlertCard(kit.as(member), event.id)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await expect(
        reviewSecurityEvent(kit.as(member), { securityEventId: event.id, status: 'dismissed' }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        recordSecurityEvent(kit.as(member), {
          targetUserId: moderator.userId,
          trigger: 'manual_report',
          riskScore: 100,
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(getSecurityEvent(kit.as(anonymousActor), event.id)).rejects.toBeInstanceOf(
        UnauthenticatedError,
      );
    });

    it('authorization comes before existence (no probing)', async () => {
      await expect(
        getSecurityEvent(kit.as(member), '00000000-0000-4000-8000-000000000000'),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        revokeCase(kit.as(member), {
          caseId: '00000000-0000-4000-8000-000000000000',
          reason: 'Probe.',
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('staff cannot dismiss events about themselves or higher rank', async () => {
      const aboutMe = await recordSecurityEvent(kit.system, {
        targetUserId: moderator.userId,
        trigger: 'spam_rate',
        riskScore: 60,
      });
      await expect(
        reviewSecurityEvent(kit.as(moderator), {
          securityEventId: aboutMe.id,
          status: 'dismissed',
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      const aboutCore = await recordSecurityEvent(kit.system, {
        targetUserId: core.userId,
        trigger: 'spam_rate',
        riskScore: 60,
      });
      await expect(
        reviewSecurityEvent(kit.as(moderator), {
          securityEventId: aboutCore.id,
          status: 'dismissed',
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      const reviewed = await reviewSecurityEvent(kit.as(core), {
        securityEventId: aboutMe.id,
        status: 'acknowledged',
      });
      expect(reviewed.status).toBe('acknowledged');
    });

    it('staff reports cannot impersonate automation', async () => {
      await expect(
        recordSecurityEvent(kit.as(moderator), {
          targetUserId: member.userId,
          trigger: 'spam_rate',
          riskScore: 90,
        }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        recordSecurityEvent(kit.as(moderator), {
          targetUserId: member.userId,
          trigger: 'manual_report',
          riskScore: 90,
          actionTaken: 'ban',
        }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        recordSecurityEvent(kit.as(moderator), {
          discordUser: { discordId: member.discordId, username: 'renamed_by_mod' },
          trigger: 'manual_report',
          riskScore: 10,
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('staff dedupe keys cannot suppress automod detections', async () => {
      const messageId = '350000000000000001';
      await recordSecurityEvent(kit.as(moderator), {
        targetUserId: member.userId,
        trigger: 'manual_report',
        riskScore: 10,
        dedupeKey: `automod:${messageId}`,
      });
      const outcome = await applyAutomodDecision(kit.system, {
        discordUser: { discordId: member.discordId, username: 'member' },
        evaluation: {
          signals: [{ key: 'foreign_invite', weight: 45 }],
          riskScore: 45,
          action: 'delete',
          trigger: 'foreign_invite',
        },
        channelId: MESSAGE_CHANNEL_ID,
        messageIds: [messageId],
      });
      expect(outcome).toMatchObject({ applied: 'delete', duplicate: false });
      expect(await kit.db.select().from(securityEvents)).toHaveLength(2);
    });
  });

  describe('system-only entry points', () => {
    it('reject user actors', async () => {
      const warn = await warnMember(kit.as(moderator), {
        targetUserId: member.userId,
        reason: 'Real.',
      });
      const event = await recordSecurityEvent(kit.system, {
        targetUserId: member.userId,
        trigger: 'spam_rate',
        riskScore: 50,
      });
      await expect(
        markCaseSynced(kit.as(core), { caseId: warn.id, status: 'applied' }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        markSecurityAlertPosted(kit.as(core), {
          securityEventId: event.id,
          channelId: MESSAGE_CHANNEL_ID,
          messageId: '360000000000000001',
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        applyAutomodDecision(kit.as(core), {
          discordUser: { discordId: member.discordId, username: 'member' },
          evaluation: { signals: [], riskScore: 99, action: 'quarantine', trigger: 'spam_rate' },
          channelId: MESSAGE_CHANNEL_ID,
          messageIds: ['360000000000000002'],
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(sweepExpiredCases(kit.as(core))).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        screenMessage(kit.as(core), {
          author: { discordId: member.discordId, username: 'member' },
          channelId: MESSAGE_CHANNEL_ID,
          messageId: '360000000000000003',
          content: 'discord.gg/x',
          mentionCount: 0,
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect(await kit.db.select().from(modCases)).toHaveLength(1);
    });
  });
});
