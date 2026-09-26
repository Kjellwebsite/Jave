import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { auditLogs, jobs } from '@jave/database';
import { createTestKit, type TestKit } from '../testing';
import { HOUR } from '../kernel/clock';
import { ForbiddenError } from '../kernel/errors';
import type { UserActor } from '../permissions/actor';
import {
  abandonMission,
  archiveMission,
  assignMission,
  closeMission,
  createMission,
  DISCORD_MISSION_REFRESH_CARD_JOB,
  listMissions,
  markMissionAnnounced,
  selfAssignMission,
  submitMission,
} from './index';
import {
  DATABASE_SUITE_TIMEOUTS,
  jobsOfType,
  openMission,
  runJob,
  VALID_BRIEF,
} from './testing/fixtures';
import { MISSION_EXPIRE_JOB } from './sweeps';

vi.setConfig(DATABASE_SUITE_TIMEOUTS);

const CARD_CHANNEL = '423456789012345678';
const CARD_MESSAGE = '623456789012345678';

async function announce(kit: TestKit, missionId: string) {
  await markMissionAnnounced(kit.system, {
    missionId,
    channelId: CARD_CHANNEL,
    messageId: CARD_MESSAGE,
  });
}

/** Refresh jobs still waiting to run (completed ones are history). */
async function pendingRefreshes(kit: TestKit) {
  return (await jobsOfType(kit, DISCORD_MISSION_REFRESH_CARD_JOB)).filter(
    (job) => job.status === 'pending',
  );
}

async function clearJobs(kit: TestKit) {
  await kit.db
    .update(jobs)
    .set({ status: 'completed' })
    .where(eq(jobs.type, DISCORD_MISSION_REFRESH_CARD_JOB));
}

describe('mission staff listing', () => {
  let kit: TestKit;
  let ops: UserActor;

  beforeEach(async () => {
    kit = await createTestKit();
    ops = await kit.member({ roles: ['operations'] });
  });
  afterEach(async () => {
    await kit.close();
  });

  it('lists every state for staff with counts, newest first', async () => {
    const draft = await createMission(kit.as(ops), {
      title: 'Draft only',
      brief: VALID_BRIEF,
      type: 'research',
    });
    const open = await openMission(kit, ops, { maxAssignees: 3 });
    const closed = await openMission(kit, ops, { title: 'Closed one' });
    await closeMission(kit.as(ops), { missionId: closed.id });
    const member = await kit.member();
    const assignment = await selfAssignMission(kit.as(member), { missionId: open.id });
    await submitMission(kit.as(member), { assignmentId: assignment.id, submission: 'Done.' });

    const all = await listMissions(kit.as(ops));
    expect(all.items.map((item) => item.id)).toEqual([closed.id, open.id, draft.id]);
    expect(all.statusCounts).toEqual({ draft: 1, open: 1, closed: 1, archived: 0 });
    const openItem = all.items.find((item) => item.id === open.id);
    expect(openItem).toMatchObject({
      number: 'M-0002',
      status: 'open',
      assigneeCount: 1,
      slotsLeft: 2,
      awaitingReview: 1,
      announced: false,
    });

    const drafts = await listMissions(kit.as(ops), { status: 'draft' });
    expect(drafts.items.map((item) => item.id)).toEqual([draft.id]);
    expect(drafts.total).toBe(1);
    expect(drafts.statusCounts.open).toBe(1);

    const research = await listMissions(kit.as(ops), { type: 'research' });
    expect(research.items.map((item) => item.id)).toEqual([draft.id]);
    expect(research.statusCounts).toEqual({ draft: 1, open: 0, closed: 0, archived: 0 });
  });

  it('BREAK: members cannot list drafts or archives, and the refusal is audited', async () => {
    await createMission(kit.as(ops), { title: 'Secret draft', brief: VALID_BRIEF, type: 'build' });
    const member = await kit.member({ roles: ['verified'] });
    await expect(listMissions(kit.as(member))).rejects.toBeInstanceOf(ForbiddenError);
    const denials = await kit.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'access.denied'));
    expect(denials.some((row) => row.actorUserId === member.userId)).toBe(true);
  });

  it('BREAK: rejects forged filters', async () => {
    await expect(
      listMissions(kit.as(ops), { status: 'deleted' as 'open', limit: 5 }),
    ).rejects.toThrow();
    await expect(listMissions(kit.as(ops), { limit: 10_000 })).rejects.toThrow();
  });
});

describe('mission card slot refresh', () => {
  let kit: TestKit;
  let ops: UserActor;

  beforeEach(async () => {
    kit = await createTestKit();
    ops = await kit.member({ roles: ['operations'] });
  });
  afterEach(async () => {
    await kit.close();
  });

  it('refreshes an announced capped card when the roster changes', async () => {
    const mission = await openMission(kit, ops, { maxAssignees: 2, durationHours: 2 });
    await announce(kit, mission.id);
    const member = await kit.member();
    const assignment = await selfAssignMission(kit.as(member), { missionId: mission.id });
    expect(await pendingRefreshes(kit)).toHaveLength(1);

    await clearJobs(kit);
    await abandonMission(kit.as(member), { assignmentId: assignment.id });
    expect(await pendingRefreshes(kit)).toHaveLength(1);

    await clearJobs(kit);
    const other = await kit.member();
    await assignMission(kit.as(ops), { missionId: mission.id, memberIds: [other.memberId!] });
    expect(await pendingRefreshes(kit)).toHaveLength(1);

    await clearJobs(kit);
    kit.clock.advance(3 * HOUR);
    // The core-only worker has no Discord handlers: the queued refresh dead-letters, which is
    // enough to show the expiry queued it.
    await runJob(kit, MISSION_EXPIRE_JOB);
    const refreshes = await jobsOfType(kit, DISCORD_MISSION_REFRESH_CARD_JOB);
    expect(refreshes.filter((job) => job.status !== 'completed')).toHaveLength(1);
  });

  it('leaves uncapped and unannounced cards alone', async () => {
    const uncapped = await openMission(kit, ops);
    await announce(kit, uncapped.id);
    await selfAssignMission(kit.as(await kit.member()), { missionId: uncapped.id });
    const unannounced = await openMission(kit, ops, { maxAssignees: 5 });
    await selfAssignMission(kit.as(await kit.member()), { missionId: unannounced.id });
    expect(await pendingRefreshes(kit)).toHaveLength(0);
  });

  it('a refresh requested while one is running runs once more afterwards', async () => {
    const mission = await openMission(kit, ops, { maxAssignees: 4 });
    await announce(kit, mission.id);
    await closeMission(kit.as(ops), { missionId: mission.id });
    const [first] = await pendingRefreshes(kit);
    expect(first).toBeDefined();
    await kit.db.update(jobs).set({ status: 'running' }).where(eq(jobs.id, first!.id));
    await archiveMission(kit.as(ops), { missionId: mission.id });
    const [running] = await kit.db.select().from(jobs).where(eq(jobs.id, first!.id));
    expect(running?.rerunRequested).toBe(true);
  });
});
