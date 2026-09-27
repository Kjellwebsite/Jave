import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq, like } from 'drizzle-orm';
import { auditLogs, jobs } from '@jave/database';
import { DAY } from '../kernel/clock';
import { listJobs } from '../jobs/admin.service';
import type { JobHandlerMap } from '../jobs/worker';
import { listMyNotifications } from '../notifications/notifications.service';
import type { UserActor } from '../permissions/actor';
import { coreJobHandlers } from '../registry';
import { createTestKit, nextDiscordId, type TestKit } from '../testing';
import { completeOnboarding, getProfile } from '../identity/profile.service';
import { recordGuildJoin, resolveUserActor } from '../identity/users.service';
import {
  getOrCreateDraft,
  submitApplication,
  updateDraft,
} from '../applications/applicant.service';
import { decideApplication } from '../applications/decision.service';
import { reviewApplication, startReview } from '../applications/review.service';
import { COMPLETE_DRAFT } from '../applications/test-fixtures';
import { seedStarterAchievements } from '../achievements/definitions.service';
import { listMemberAchievements } from '../achievements/views.service';
import { evaluate, publishResults } from '../trials/evaluation.service';
import { submit } from '../trials/participation.service';
import { applyRankConsequence } from '../trials/rank-consequence.service';
import { closeSubmissions } from '../trials/run.service';
import { runningTrial } from '../trials/testing/fixtures';
import {
  createMission,
  publishMission,
  selfAssignMission,
  submitMission,
  verifySubmission,
} from '../missions';
import { VALID_BRIEF } from '../missions/testing/fixtures';
import {
  changeProjectStatus,
  createProject,
  recordContribution,
  verifyContribution,
} from '../projects';
import { claimTicket, closeTicket, openTicket } from '../tickets';
import { warnMember } from '../moderation/cases.service';
import { updateSettings } from '../settings/settings.service';

/**
 * GAUNTLET: one member's path through the whole organization, every step
 * through the real services, with every core job handler and event
 * subscriber running (achievements, notifications, analytics, reminders…).
 * Discord side effects stay queued for the bot, which is tested separately.
 * The point is the seams between modules — a step that only works in its
 * own module's tests fails here.
 */

vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

const CONFIGURED_CHANNELS = {
  announcements: '910000000000000001',
  applicationsReview: '910000000000000002',
  tickets: '910000000000000003',
  ticketArchive: '910000000000000004',
  trialsCategory: '910000000000000005',
  modLog: '910000000000000006',
  staffAlerts: '910000000000000007',
  achievements: '910000000000000008',
};

describe('GAUNTLET: a member from joining to a verified rank', () => {
  let kit: TestKit;
  let handlers: JobHandlerMap;
  let founder: UserActor;
  let core: UserActor;
  let ops: UserActor;
  let mod: UserActor;

  beforeEach(async () => {
    kit = await createTestKit();
    // The worker claims only job types it has handlers for, so discord.* jobs
    // stay queued for the bot, exactly as when the dashboard runs core jobs.
    handlers = coreJobHandlers();
    founder = await kit.member({ roles: ['founder'], username: 'founder' });
    core = await kit.member({ roles: ['core'], username: 'core' });
    ops = await kit.member({ roles: ['operations'], username: 'ops' });
    mod = await kit.member({ roles: ['moderator'], username: 'mod' });
    // A configured server, as /jave setup leaves it.
    await updateSettings(kit.system, 'channels', CONFIGURED_CHANNELS);
    await seedStarterAchievements(kit.as(founder));
    await settle();
  });
  afterEach(async () => {
    await kit.close();
  });

  /** Run every job due now, including the ones those jobs enqueue. */
  async function settle() {
    return kit.drain(handlers);
  }

  it('applies, joins a trial, earns a verified rank, ships, gets help and a warning', async () => {
    // ── Arrival ────────────────────────────────────────────────────────────
    const joined = await recordGuildJoin(kit.system, {
      discordId: nextDiscordId(),
      username: 'nova',
      displayName: 'Nova',
    });
    let nova = await resolveUserActor(kit.system, joined.user.id);
    await completeOnboarding(kit.as(nova), { displayName: 'Nova', primaryDomain: 'create' });
    await settle();

    // ── Application: draft → submit → review → accept ─────────────────────
    const { application } = await getOrCreateDraft(kit.as(nova));
    await updateDraft(kit.as(nova), COMPLETE_DRAFT);
    await submitApplication(kit.as(nova));
    await settle();
    await startReview(kit.as(core), { applicationId: application.id });
    await reviewApplication(kit.as(core), {
      applicationId: application.id,
      recommendation: 'accept',
      score: 5,
    });
    const decision = await decideApplication(kit.as(core), {
      applicationId: application.id,
      decision: 'accept',
      reason: 'Shipped real work; references check out.',
      applicantMessage: 'Welcome to JAVELIN. Prove it.',
    });
    expect(decision).toMatchObject({ status: 'accepted', grantedRole: 'trial' });
    await settle();
    nova = await resolveUserActor(kit.system, nova.userId);
    expect(nova.roles).toContain('trial');

    // ── Trial: team, submission, evaluation, results, rank ───────────────
    const teammate = await kit.member({ roles: ['trial'], username: 'orbit' });
    const { trialId, assignment } = await runningTrial(kit, ops, [nova, teammate]);
    await settle();
    await submit(kit.as(nova), { trialId, summary: 'A working product with real users.' });
    await closeSubmissions(kit.as(ops), { trialId });
    await settle();
    await evaluate(kit.as(core), {
      trialId,
      teamId: assignment.teams[0]!.id,
      scores: { shipped: 9, value: 8 },
    });
    await publishResults(kit.as(ops), { trialId });
    await settle();
    const consequence = await applyRankConsequence(kit.as(core), {
      trialId,
      memberId: nova.memberId!,
    });
    await settle();
    const profileAfterTrial = await getProfile(kit.as(nova), { memberId: nova.memberId! });
    const create = profileAfterTrial.domains.find((domain) => domain.key === 'create');
    expect(create?.verifiedRank, 'a verified rank in CREATE').not.toBeNull();
    expect(consequence).toBeTruthy();

    // ── Mission ───────────────────────────────────────────────────────────
    const draftMission = await createMission(kit.as(ops), {
      title: 'Harden the uploader',
      brief: VALID_BRIEF,
      type: 'build',
    });
    await publishMission(kit.as(ops), { missionId: draftMission.id });
    const assignment1 = await selfAssignMission(kit.as(nova), { missionId: draftMission.id });
    await submitMission(kit.as(nova), {
      assignmentId: assignment1.id,
      submission: 'Uploads are resumable and virus-scanned; notes in the PR.',
      evidence: {
        title: 'Uploader pull request',
        url: 'https://github.com/example/uploader/pull/3',
      },
    });
    await verifySubmission(kit.as(ops), { assignmentId: assignment1.id });
    await settle();

    // ── Project: create, contribute, verify, ship ─────────────────────────
    const project = await createProject(kit.as(nova), { title: 'Orbital', visibility: 'public' });
    const contribution = await recordContribution(kit.as(nova), {
      projectId: project.id,
      kind: 'code',
      title: 'Offline sync engine',
      url: 'https://github.com/example/orbital/pull/7',
    });
    await verifyContribution(kit.as(ops), {
      contributionId: contribution.id,
      note: 'Reviewed the PR; it is solid.',
    });
    await changeProjectStatus(kit.as(nova), { projectId: project.id, status: 'building' });
    await changeProjectStatus(kit.as(nova), { projectId: project.id, status: 'shipped' });
    await settle();

    // ── Support ticket ────────────────────────────────────────────────────
    const ticket = await openTicket(kit.as(nova), {
      category: 'general',
      subject: 'Access to the build server',
      body: 'My trial team needs access to the staging build server.',
    });
    await claimTicket(kit.as(mod), { ticketId: ticket.id });
    await closeTicket(kit.as(mod), { ticketId: ticket.id, reason: 'Access granted.' });
    await settle();

    // ── Moderation ────────────────────────────────────────────────────────
    await warnMember(kit.as(mod), {
      targetUserId: nova.userId,
      reason: 'Posted a teammate’s email address in a public channel.',
    });
    await settle();

    // A week passes: reminders, sweeps and retention jobs have their say.
    kit.clock.advance(8 * DAY);
    await settle();

    // ── The record ────────────────────────────────────────────────────────
    const achievements = await listMemberAchievements(kit.as(nova), {
      memberId: nova.memberId!,
    });
    const keys = achievements.map((a) => a.key);
    for (const key of [
      'first_trial',
      'trial_pass',
      'first_mission',
      'first_project',
      'first_verified_contribution',
      'project_shipped',
    ]) {
      expect(keys, `achievement ${key}`).toContain(key);
    }

    const inbox = await listMyNotifications(kit.as(nova), { limit: 100 });
    const types = new Set(inbox.items.map((n) => n.type));
    for (const type of [
      'application.updated',
      'trial.result',
      'rank.updated',
      'achievement.unlocked',
      'mission.reviewed',
      'moderation.notice',
    ]) {
      expect([...types], `notification ${type}`).toContain(type);
    }

    const profile = await getProfile(kit.as(nova), { memberId: nova.memberId! });
    expect(profile.stats).toMatchObject({ trials: 1, trialsPassed: 1 });

    const queuedForBot = new Set(
      (await kit.db.select({ type: jobs.type }).from(jobs).where(like(jobs.type, 'discord.%'))).map(
        (job) => job.type,
      ),
    );
    for (const type of [
      'discord.roles.sync',
      'discord.applications.review_card',
      'discord.trials.provision',
      'discord.tickets.open_thread',
      'discord.moderation.apply',
    ]) {
      expect([...queuedForBot], `discord job ${type}`).toContain(type);
    }

    // Every core job and subscriber along the way succeeded.
    const dead = await listJobs(kit.as(founder), { status: 'dead', limit: 100 });
    expect(dead.items.map((job) => `${job.type}: ${job.lastError}`)).toEqual([]);
    const pending = await kit.db.select().from(jobs).where(eq(jobs.status, 'running'));
    expect(pending).toHaveLength(0);

    // The audit trail names the decisions that shaped this member.
    const audited = await kit.db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(and(eq(auditLogs.result, 'success')));
    const actions = new Set(audited.map((a) => a.action));
    for (const action of ['application.decided', 'moderation.case_created']) {
      expect([...actions], `audit ${action}`).toContain(action);
    }
  });
});
