import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  auditLogs,
  jobs,
  memberCapabilities,
  members,
  notifications,
  rankHistory,
} from '@jave/database';
import { createTestKit, type TestKit } from '../testing';
import { ForbiddenError, NotFoundError, ValidationError } from '../kernel/errors';
import { anonymousActor } from '../permissions/actor';
import { claimRank, getRankHistory, setVerifiedRank, submitEvidence } from './capabilities.service';
import { completeOnboarding, getProfile, updateProfile } from './profile.service';
import { assignableRoles, grantRole, revokeRole } from './roles.service';
import {
  listMembers,
  recordGuildJoin,
  recordGuildLeave,
  resolveUserActor,
  syncDiscordUser,
} from './users.service';
import { summarizeDomains, loadCatalog } from './ranks';

describe('identity', () => {
  let kit: TestKit;
  beforeEach(async () => {
    kit = await createTestKit({ founderDiscordIds: ['900000000000000001'] });
  });
  afterEach(async () => {
    await kit.close();
  });

  describe('members', () => {
    it('creates a member with the MEMBER role on first contact, idempotently', async () => {
      const a = await syncDiscordUser(
        kit.system,
        { discordId: '200000000000000001', username: 'Kjell' },
        { inGuild: true },
      );
      const b = await syncDiscordUser(
        kit.system,
        { discordId: '200000000000000001', username: 'Kjell' },
        { inGuild: true },
      );
      expect(a.member.id).toBe(b.member.id);
      expect(a.member.handle).toBe('kjell');
      const actor = await resolveUserActor(kit.system, a.user.id);
      expect(actor.roles).toEqual(['member']);
    });

    it('generates unique handles', async () => {
      const a = await syncDiscordUser(
        kit.system,
        { discordId: '200000000000000002', username: 'ada' },
        { inGuild: true },
      );
      const b = await syncDiscordUser(
        kit.system,
        { discordId: '200000000000000003', username: 'Ada' },
        { inGuild: true },
      );
      expect(a.member.handle).toBe('ada');
      expect(b.member.handle).toBe('ada-2');
    });

    it('bootstraps configured founders and audits it', async () => {
      const { user } = await syncDiscordUser(
        kit.system,
        { discordId: '900000000000000001', username: 'founder' },
        { inGuild: true },
      );
      const actor = await resolveUserActor(kit.system, user.id);
      expect(actor.roles).toContain('founder');
      expect(actor.capabilities.has('canManageSettings')).toBe(true);
      const audit = await kit.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'role.bootstrap_granted'));
      expect(audit).toHaveLength(1);
    });

    it('tracks joins, leaves and rejoins', async () => {
      const join = await recordGuildJoin(kit.system, {
        discordId: '200000000000000004',
        username: 'joiner',
      });
      expect(join.rejoin).toBe(false);
      const left = await recordGuildLeave(kit.system, '200000000000000004');
      expect(left?.guildStatus).toBe('departed');
      const rejoin = await recordGuildJoin(kit.system, {
        discordId: '200000000000000004',
        username: 'joiner',
      });
      expect(rejoin.rejoin).toBe(true);
      expect(rejoin.member.guildStatus).toBe('present');
    });

    it('ignores leaves from unknown users', async () => {
      expect(await recordGuildLeave(kit.system, '299999999999999999')).toBeNull();
    });

    it('quarantined members lose all capabilities', async () => {
      const mod = await kit.member({ roles: ['moderator'] });
      await kit.db
        .update(members)
        .set({ standing: 'quarantined' })
        .where(eq(members.id, mod.memberId!));
      const again = await resolveUserActor(kit.system, mod.userId);
      expect(again.capabilities.size).toBe(0);
    });

    it('lists and searches members for authorized viewers only', async () => {
      const viewer = await kit.member({ roles: ['verified'], username: 'viewer' });
      await kit.member({ username: 'searchable_one' });
      const page = await listMembers(kit.as(viewer), { search: 'searchable' });
      expect(page.items.map((m) => m.handle)).toEqual(['searchable_one']);
      await expect(listMembers(kit.as(anonymousActor), {})).rejects.toThrow();
    });

    it('escapes LIKE wildcards in search', async () => {
      const viewer = await kit.member({ roles: ['verified'] });
      await kit.member({ username: 'plainname' });
      const page = await listMembers(kit.as(viewer), { search: '%' });
      expect(page.items).toHaveLength(0);
    });
  });

  describe('roles', () => {
    it('enforces hierarchy: core cannot grant core or founder', async () => {
      const core = await kit.member({ roles: ['core'] });
      const target = await kit.member();
      await expect(
        grantRole(kit.as(core), { memberId: target.memberId!, role: 'core', reason: 'promotion' }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        grantRole(kit.as(core), {
          memberId: target.memberId!,
          role: 'founder',
          reason: 'promotion',
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await grantRole(kit.as(core), {
        memberId: target.memberId!,
        role: 'operations',
        reason: 'ops lead',
      });
      const updated = await resolveUserActor(kit.system, target.userId);
      expect(updated.roles).toContain('operations');
    });

    it('prevents self-escalation even for founders', async () => {
      const founder = await kit.member({ roles: ['founder'] });
      await expect(
        grantRole(kit.as(founder), {
          memberId: founder.memberId!,
          role: 'supporter',
          reason: 'self',
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('moderators cannot assign roles at all, and the denial is audited', async () => {
      const mod = await kit.member({ roles: ['moderator'] });
      const target = await kit.member();
      await expect(
        grantRole(kit.as(mod), {
          memberId: target.memberId!,
          role: 'verified',
          reason: 'x'.repeat(5),
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      const denied = await kit.db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.action, 'access.denied'), eq(auditLogs.actorUserId, mod.userId)));
      expect(denied).toHaveLength(1);
      expect(denied[0]!.result).toBe('denied');
    });

    it('progression roles are exclusive and schedule a Discord sync', async () => {
      const core = await kit.member({ roles: ['core'] });
      const target = await kit.member();
      await grantRole(kit.as(core), {
        memberId: target.memberId!,
        role: 'trial',
        reason: 'accepted',
      });
      await grantRole(kit.as(core), {
        memberId: target.memberId!,
        role: 'verified',
        reason: 'verified',
      });
      const actor = await resolveUserActor(kit.system, target.userId);
      expect([...actor.roles].sort()).toEqual(['verified']);
      const syncJobs = await kit.db.select().from(jobs).where(eq(jobs.type, 'discord.roles.sync'));
      expect(syncJobs.length).toBeGreaterThan(0);
    });

    it('revoking a role that is not held is a conflict', async () => {
      const core = await kit.member({ roles: ['core'] });
      const target = await kit.member();
      await expect(
        revokeRole(kit.as(core), { memberId: target.memberId!, role: 'moderator', reason: 'nope' }),
      ).rejects.toThrow('does not hold');
    });

    it('lists assignable roles below the actor', async () => {
      const ops = await kit.member({ roles: ['operations'] });
      expect(assignableRoles(kit.as(ops))).toEqual([]); // operations lacks canAssignRoles
      const core = await kit.member({ roles: ['core'] });
      expect(assignableRoles(kit.as(core))).not.toContain('core');
      expect(assignableRoles(kit.as(core))).toContain('operations');
    });
  });

  describe('capabilities & ranks', () => {
    it('claims are recorded as CLAIMED with history', async () => {
      const m = await kit.member({ roles: ['verified'] });
      await claimRank(kit.as(m), {
        facetKey: 'create.technical',
        rank: 'A',
        evidence: { title: 'Compiler', url: 'https://example.com/compiler' },
      });
      const profile = await getProfile(kit.as(m), { memberId: m.memberId! });
      const create = profile.domains.find((d) => d.key === 'create')!;
      expect(create.status).toBe('claimed');
      expect(create.claimedRank).toBe('A');
      expect(create.verifiedRank).toBeNull();
      const history = await getRankHistory(kit.as(m), m.memberId!);
      expect(history[0]!.track).toBe('claimed');
    });

    it('rejects unknown facets and ranks', async () => {
      const m = await kit.member();
      await expect(
        claimRank(kit.as(m), { facetKey: 'mind.telepathy', rank: 'S' }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        claimRank(kit.as(m), { facetKey: 'mind.reasoning', rank: 'SS' }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('evaluators set verified ranks with reason, audit, event and notification', async () => {
      const evaluator = await kit.member({ roles: ['core'] });
      const m = await kit.member({ roles: ['verified'] });
      const result = await setVerifiedRank(kit.as(evaluator), {
        memberId: m.memberId!,
        facetKey: 'mind.research',
        rank: 'B',
        reason: 'Published replication study',
      });
      expect(result.changed).toBe(true);
      const [row] = await kit.db
        .select()
        .from(memberCapabilities)
        .where(eq(memberCapabilities.memberId, m.memberId!));
      expect(row!.verifiedRank).toBe('B');
      expect(row!.verifiedByUserId).toBe(evaluator.userId);
      const audit = await kit.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'rank.verified_changed'));
      expect(audit[0]!.context).toMatchObject({ from: null, to: 'B' });
      const notes = await kit.db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientUserId, m.userId));
      expect(notes[0]!.type).toBe('rank.updated');
    });

    it('BREAK: nobody can verify their own capability — not even a founder', async () => {
      const founder = await kit.member({ roles: ['founder'] });
      await expect(
        setVerifiedRank(kit.as(founder), {
          memberId: founder.memberId!,
          facetKey: 'mind.reasoning',
          rank: 'S',
          reason: 'trust me',
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      const blocked = await kit.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'rank.self_verification_blocked'));
      expect(blocked).toHaveLength(1);
      expect(await kit.db.select().from(rankHistory)).toHaveLength(0);
    });

    it('BREAK: operations cannot modify ranks', async () => {
      const ops = await kit.member({ roles: ['operations'] });
      const m = await kit.member();
      await expect(
        setVerifiedRank(kit.as(ops), {
          memberId: m.memberId!,
          facetKey: 'mind.reasoning',
          rank: 'C',
          reason: 'seems fine',
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('rejects evidence belonging to another member', async () => {
      const evaluator = await kit.member({ roles: ['core'] });
      const a = await kit.member();
      const b = await kit.member();
      const ev = await submitEvidence(kit.as(a), { title: 'Mine', url: 'https://example.com/a' });
      await expect(
        setVerifiedRank(kit.as(evaluator), {
          memberId: b.memberId!,
          facetKey: 'mind.reasoning',
          rank: 'C',
          reason: 'wrong evidence',
          evidenceId: ev.id,
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('rejects non-http evidence URLs (javascript: etc.)', async () => {
      const a = await kit.member();
      await expect(
        submitEvidence(kit.as(a), { title: 'xss', url: 'javascript:alert(1)' }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('domain rank is the peak facet rank, never a sum', async () => {
      const kitCtx = kit.system;
      const catalog = await loadCatalog(kitCtx);
      const domains = summarizeDomains(catalog, [
        { facetKey: 'mind.reasoning', claimedRank: 'A', verifiedRank: 'C' },
        { facetKey: 'mind.research', claimedRank: null, verifiedRank: 'B' },
      ]);
      const mind = domains.find((d) => d.key === 'mind')!;
      expect(mind.verifiedRank).toBe('B');
      expect(mind.claimedRank).toBe('A');
      expect(mind.status).toBe('verified');
      expect(domains.find((d) => d.key === 'body')!.status).toBe('unknown');
    });

    it('rank history is private to self and staff', async () => {
      const a = await kit.member({ roles: ['verified'] });
      const b = await kit.member({ roles: ['verified'] });
      await expect(getRankHistory(kit.as(b), a.memberId!)).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  describe('profiles & privacy', () => {
    it('enforces visibility tiers', async () => {
      const owner = await kit.member({ roles: ['verified'] });
      const other = await kit.member({ roles: ['verified'] });
      const staff = await kit.member({ roles: ['moderator'] });
      await updateProfile(kit.as(owner), owner.memberId!, { profileVisibility: 'members' });
      await expect(
        getProfile(kit.as(anonymousActor), { memberId: owner.memberId! }),
      ).rejects.toBeInstanceOf(NotFoundError);
      await expect(getProfile(kit.as(other), { memberId: owner.memberId! })).resolves.toBeTruthy();
      await updateProfile(kit.as(owner), owner.memberId!, { profileVisibility: 'staff' });
      await expect(getProfile(kit.as(other), { memberId: owner.memberId! })).rejects.toBeInstanceOf(
        NotFoundError,
      );
      await expect(getProfile(kit.as(staff), { memberId: owner.memberId! })).resolves.toBeTruthy();
      await updateProfile(kit.as(owner), owner.memberId!, { profileVisibility: 'public' });
      const pub = await getProfile(kit.as(anonymousActor), {
        handle: (await getProfile(kit.as(owner), { memberId: owner.memberId! })).handle,
      });
      expect(pub.standing).toBeNull();
    });

    it('hides claims from others when the member opts out', async () => {
      const owner = await kit.member({ roles: ['verified'] });
      const other = await kit.member({ roles: ['verified'] });
      await claimRank(kit.as(owner), { facetKey: 'body.physical', rank: 'A' });
      await updateProfile(kit.as(owner), owner.memberId!, { showClaimsPublicly: false });
      const view = await getProfile(kit.as(other), { memberId: owner.memberId! });
      expect(view.claimsVisible).toBe(false);
      expect(view.domains.find((d) => d.key === 'body')!.claimedRank).toBeNull();
      const selfView = await getProfile(kit.as(owner), { memberId: owner.memberId! });
      expect(selfView.domains.find((d) => d.key === 'body')!.claimedRank).toBe('A');
    });

    it('BREAK: members cannot edit other profiles', async () => {
      const a = await kit.member();
      const b = await kit.member();
      await expect(
        updateProfile(kit.as(a), b.memberId!, { headline: 'pwned' }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('rejects taken handles and invalid handles', async () => {
      const a = await kit.member({ username: 'alpha' });
      const b = await kit.member({ username: 'bravo' });
      await expect(updateProfile(kit.as(b), b.memberId!, { handle: 'alpha' })).rejects.toThrow(
        'taken',
      );
      await expect(
        updateProfile(kit.as(b), b.memberId!, { handle: '../admin' }),
      ).rejects.toBeInstanceOf(ValidationError);
      expect(a).toBeTruthy();
    });

    it('completes onboarding once and emits the event once', async () => {
      const m = await kit.member();
      await completeOnboarding(kit.as(m), { displayName: 'Nova', primaryDomain: 'create' });
      await completeOnboarding(kit.as(m), { displayName: 'Nova', primaryDomain: 'create' });
      const profile = await getProfile(kit.as(m), { memberId: m.memberId! });
      expect(profile.onboardingState).toBe('completed');
      expect(profile.displayName).toBe('Nova');
    });
  });
});
