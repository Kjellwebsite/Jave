import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  achievementDefinitions,
  adversarialEvaluations,
  adversarialObservations,
  adversarialRoles,
  adversarialScenarios,
  auditLogs,
  jobs,
  memberAchievements,
  members,
  missionAssignments,
  modCases,
  referrals,
  sessions,
  trialEvaluations,
  trialParticipants,
  trials,
  trialTeams,
  users,
} from '@jave/database';
import { seedStarterScenarios } from '../adversarial/scenarios.service';
import { recordAudit } from '../audit/audit.service';
import { recordGuildJoin, resolveUserActor, upsertDiscordUser } from '../identity/users.service';
import { banMember } from '../moderation/cases.service';
import { screenJoin } from '../moderation/raid.service';
import { systemActor } from '../permissions/actor';
import { createTestKit, type TestKit } from '../testing';
import { ERASED_DISPLAY_NAME, ERASED_USERNAME } from './constants';
import { eraseMember } from './erasure.service';
import {
  buildFootprint,
  departed,
  type Footprint,
  MARKER_PREFIX,
  NOVA,
  scanForText,
} from './test-support';

vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

/**
 * Kept records that may still hold a term after erasure, and why. Anything
 * else found by the scan is a leak.
 */
const ALLOWED_AFTER_ERASURE: Record<string, string> = {
  // Completed jobs are operational rows pruned after 14 days (housekeeping);
  // live and dead jobs are scrubbed.
  'jobs.payload': 'completed jobs only (asserted below)',
  'jobs.result': 'completed jobs only (asserted below)',
};

describe('privacy: erasure', () => {
  let kit: TestKit;
  let f: Footprint;

  beforeEach(async () => {
    kit = await createTestKit();
    f = await buildFootprint(kit);
  });
  afterEach(async () => {
    await kit.close();
  });

  async function erase(overrides: Partial<Parameters<typeof eraseMember>[1]> = {}) {
    const [member] = await kit.db
      .select({ handle: members.handle })
      .from(members)
      .where(eq(members.id, f.nova.memberId!));
    return eraseMember(kit.as(f.founder), {
      memberId: f.nova.memberId!,
      reason: 'Data-subject request DSR-7, verified by email.',
      confirmHandle: member!.handle,
      ...overrides,
    });
  }

  it('leaves no trace of what she wrote or her names outside the kept records', async () => {
    const [before] = await kit.db
      .select({ handle: members.handle })
      .from(members)
      .where(eq(members.id, f.nova.memberId!));
    const needles = [MARKER_PREFIX, NOVA.displayName, NOVA.username, NOVA.github, before!.handle];
    // The footprint really is there first.
    const found = await scanForText(kit, needles);
    expect(Object.keys(found).length).toBeGreaterThan(10);

    await departed(kit, f.nova);
    const report = await erase();
    expect(report.counts.ticketMessages).toBeGreaterThan(0);
    expect(report.counts.sessions).toBe(1);

    const left = await scanForText(kit, needles);
    const leaks = Object.keys(left).filter((column) => !(column in ALLOWED_AFTER_ERASURE));
    expect(leaks, JSON.stringify(left)).toEqual([]);
    // The allowance is only for finished jobs.
    const liveJobs = await kit.db.select().from(jobs);
    for (const job of liveJobs.filter((j) => j.status !== 'completed')) {
      const text = JSON.stringify(job.payload);
      for (const needle of needles) expect(text.toLowerCase()).not.toContain(needle.toLowerCase());
    }
  });

  it('BREAK: staff-written text about her in missions, trials, referrals and exercises loses her name', async () => {
    const name = NOVA.displayName;
    const [assignment] = await kit.db
      .select()
      .from(missionAssignments)
      .where(eq(missionAssignments.memberId, f.nova.memberId!));
    const feedback = `${name}, the retry path has no tests yet.`;
    await kit.db
      .update(missionAssignments)
      .set({ feedback })
      .where(eq(missionAssignments.id, assignment!.id));
    // mission.rejected targets the mission, not her assignment.
    await recordAudit(kit.as(f.ops), {
      action: 'mission.rejected',
      targetType: 'mission',
      targetId: assignment!.missionId,
      context: { assignmentId: assignment!.id, feedback },
    });

    // A trial she competed in: a team evaluation and an exercise on her team.
    const [trial] = await kit.db
      .insert(trials)
      .values({
        title: 'Security sprint',
        category: 'security',
        brief: 'Ship it.',
        rubric: [],
        status: 'completed',
        durationMinutes: 60,
      })
      .returning({ id: trials.id });
    const [team] = await kit.db
      .insert(trialTeams)
      .values({ trialId: trial!.id, name: 'Team A', ordinal: 1 })
      .returning({ id: trialTeams.id });
    await kit.db.insert(trialParticipants).values([
      { trialId: trial!.id, memberId: f.nova.memberId!, status: 'selected', teamId: team!.id },
      { trialId: trial!.id, memberId: f.teammate.memberId!, status: 'selected', teamId: team!.id },
    ]);
    await kit.db.insert(trialEvaluations).values({
      trialId: trial!.id,
      teamId: team!.id,
      evaluatorUserId: f.core.userId,
      overallScore: 7,
      notes: `${name} carried the demo.`,
    });
    await seedStarterScenarios(kit.as(f.founder));
    const [scenario] = await kit.db.select().from(adversarialScenarios).limit(1);
    const [role] = await kit.db
      .insert(adversarialRoles)
      .values({
        trialId: trial!.id,
        teamId: team!.id,
        operativeMemberId: f.teammate.memberId!,
        scenarioId: scenario!.id,
        objective: 'Ask for the sandbox deploy key.',
        scenarioTitle: scenario!.title,
        technique: scenario!.technique,
        guardrails: scenario!.guardrails,
        sandboxAssets: scenario!.sandboxAssets,
        authorizationNote: `Keep ${name} out of the DMs.`,
        abortReason: `${name} spotted it early.`,
      })
      .returning({ id: adversarialRoles.id });
    await kit.db.insert(adversarialObservations).values({
      roleId: role!.id,
      observerUserId: f.core.userId,
      subjectMemberId: f.nova.memberId!,
      outcome: 'reported',
      description: `${name} reported the request in the team channel.`,
    });
    await kit.db.insert(adversarialEvaluations).values({
      roleId: role!.id,
      evaluatorUserId: f.core.userId,
      securityCultureScore: 8,
      summary: `${name} reported it within minutes.`,
      debrief: `Thank ${name} in the debrief.`,
      overrideJustification: `${name} was fast.`,
    });

    // A referral decision and a revoked achievement.
    await kit.db.insert(referrals).values({
      inviteeUserId: f.nova.userId,
      inviterUserId: f.teammate.userId,
      method: 'invite',
      reviewNote: `${name} was invited by a classmate.`,
    });
    await kit.db.insert(achievementDefinitions).values({
      key: 'erasure_probe',
      title: 'PROBE',
      description: 'A test achievement.',
      category: 'projects',
      criteria: { type: 'manual' },
    });
    await kit.db.insert(memberAchievements).values({
      memberId: f.nova.memberId!,
      achievementKey: 'erasure_probe',
      revokedAt: kit.clock.now(),
      revokeReason: `Awarded to ${name} by mistake.`,
    });

    expect(Object.keys(await scanForText(kit, [name])).length).toBeGreaterThan(8);
    await departed(kit, f.nova);
    await erase();
    const left = await scanForText(kit, [name]);
    const leaks = Object.keys(left).filter((column) => !(column in ALLOWED_AFTER_ERASURE));
    expect(leaks, JSON.stringify(left)).toEqual([]);
  });

  it('keeps the organization’s record, pseudonymous', async () => {
    await departed(kit, f.nova);
    await erase();
    const [user] = await kit.db.select().from(users).where(eq(users.id, f.nova.userId));
    expect(user).toMatchObject({ username: ERASED_USERNAME, displayName: null, avatarHash: null });
    expect(user!.discordId).toBe(f.nova.discordId);
    expect(user!.deletedAt).not.toBeNull();
    const [member] = await kit.db.select().from(members).where(eq(members.id, f.nova.memberId!));
    expect(member).toMatchObject({
      displayName: ERASED_DISPLAY_NAME,
      headline: null,
      bio: null,
      profileVisibility: 'staff',
      showOnLeaderboards: false,
    });
    expect(member!.handle).toMatch(/^erased-[a-z0-9]{8}$/);
    // The warning stays, with her name replaced.
    const [warning] = await kit.db
      .select()
      .from(modCases)
      .where(eq(modCases.targetUserId, f.nova.userId));
    expect(warning!.reason).toBe(`${ERASED_DISPLAY_NAME} posted a teammate's email address.`);
    expect(await kit.db.select().from(sessions).where(eq(sessions.userId, f.nova.userId))).toEqual(
      [],
    );
    const [audit] = await kit.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'privacy.erased'), eq(auditLogs.targetId, member!.id)));
    expect(audit!.actorUserId).toBe(f.founder.userId);
    expect(audit!.context).toMatchObject({
      reason: 'Data-subject request DSR-7, verified by email.',
    });
    const sync = await kit.db
      .select()
      .from(jobs)
      .where(eq(jobs.dedupeKey, `roles-sync:${member!.id}`));
    expect(sync.length).toBeGreaterThan(0);
    // Signed-in actor resolution sees no member any more.
    const actor = await resolveUserActor(kit.system, f.nova.userId);
    expect(actor.memberId).toBeNull();
    expect(actor.capabilities.size).toBe(0);
  });

  it('refuses the unsafe cases', async () => {
    // Still in the server.
    await expect(erase()).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await departed(kit, f.nova);
    // Only founders.
    await expect(
      eraseMember(kit.as(f.core), {
        memberId: f.nova.memberId!,
        reason: 'x',
        confirmHandle: 'x',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // The typed handle must match.
    await expect(erase({ confirmHandle: 'someone-else' })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    // A reason is required.
    await expect(erase({ reason: '' })).rejects.toMatchObject({ code: 'VALIDATION' });
    await erase();
    // Twice.
    await expect(erase({ confirmHandle: 'anything' })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('refuses staff and yourself', async () => {
    await departed(kit, f.mod);
    const [mod] = await kit.db.select().from(members).where(eq(members.id, f.mod.memberId!));
    await expect(
      eraseMember(kit.as(f.founder), {
        memberId: mod!.id,
        reason: 'request',
        confirmHandle: mod!.handle,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await departed(kit, f.founder);
    const [founder] = await kit.db
      .select()
      .from(members)
      .where(eq(members.id, f.founder.memberId!));
    await expect(
      eraseMember(kit.as(f.founder), {
        memberId: founder!.id,
        reason: 'request',
        confirmHandle: founder!.handle,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('a returning member starts over; erased data stays erased', async () => {
    await departed(kit, f.nova);
    await erase();
    const { member } = await recordGuildJoin(kit.system, {
      discordId: f.nova.discordId,
      username: 'nova.returns',
      displayName: 'Nova R',
    });
    expect(member.deletedAt).toBeNull();
    expect(member).toMatchObject({
      displayName: 'Nova R',
      onboardingState: 'not_started',
      bio: null,
      headline: null,
      guildStatus: 'present',
    });
    expect(member.handle).not.toMatch(/^erased-/);
    const actor = await resolveUserActor(kit.system, f.nova.userId);
    expect(actor.memberId).toBe(member.id);
    expect(actor.roles).toEqual(['member']);
  });

  it('BREAK: meeting an erased member on Discord again does not restore their name', async () => {
    await departed(kit, f.nova);
    await erase();
    // What the bot does when anyone reports one of her old messages, when an
    // invite she made is re-synced, or when she signs in to the dashboard.
    const seen = await upsertDiscordUser(kit.system, {
      discordId: f.nova.discordId,
      username: 'nova.quill',
      displayName: 'Nova Quill',
      avatarHash: 'a1b2c3',
    });
    const [row] = await kit.db.select().from(users).where(eq(users.id, f.nova.userId));
    expect(seen.id).toBe(f.nova.userId);
    expect(row).toMatchObject({ username: ERASED_USERNAME, displayName: null, avatarHash: null });
    expect(row!.deletedAt).not.toBeNull();

    // Her own return to the server is what starts her over.
    await recordGuildJoin(kit.system, {
      discordId: f.nova.discordId,
      username: 'nova.quill',
      displayName: 'Nova Quill',
    });
    const [back] = await kit.db.select().from(users).where(eq(users.id, f.nova.userId));
    expect(back).toMatchObject({ username: 'nova.quill', deletedAt: null });
  });

  it('a ban survives erasure and is re-applied on rejoin', async () => {
    await banMember(kit.as(f.core), {
      targetUserId: f.nova.userId,
      reason: 'Repeated harassment.',
    });
    // The bot applied the ban in Discord (there is no bot here: finish its job).
    await kit.db
      .update(jobs)
      .set({ status: 'completed', completedAt: kit.clock.now() })
      .where(eq(jobs.type, 'discord.moderation.apply'));
    await departed(kit, f.nova);
    await erase();
    const result = await screenJoin(kit.as(systemActor('join')), {
      discordUser: { discordId: f.nova.discordId, username: 'nova.again' },
    });
    expect(result.reapplied).toBe('ban');
  });
});
