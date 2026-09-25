import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  auditLogs,
  evidence,
  memberAchievements,
  missionAssignments,
  members,
} from '@jave/database';
import { createTestKit, type TestKit } from '../testing';
import { HOUR } from '../kernel/clock';
import { withTransaction } from '../kernel/context';
import { ConflictError, InvalidStateError, NotFoundError, ValidationError } from '../kernel/errors';
import type { UserActor } from '../permissions/actor';
import { updateSettings } from '../settings/settings.service';
import { createAchievementDefinition, seedStarterAchievements } from '../achievements';
import {
  abandonMission,
  acceptMission,
  archiveMission,
  assignMission,
  closeMission,
  createMission,
  DISCORD_MISSION_ANNOUNCE_JOB,
  DISCORD_MISSION_REFRESH_CARD_JOB,
  getMemberMissionHistory,
  getMissionCard,
  getMissionDetail,
  listMyMissions,
  listOpenMissions,
  listSubmissionsForReview,
  markMissionAnnounced,
  MISSION_EXPIRE_JOB,
  MISSION_REMINDER_JOB,
  publishMission,
  rejectSubmission,
  reopenMission,
  selfAssignMission,
  submitMission,
  updateMission,
  verifySubmission,
} from './index';
import { expireAssignment } from './sweeps';
import {
  DATABASE_SUITE_TIMEOUTS,
  EVIDENCE,
  eventsOfType,
  inboxOf,
  jobsOfType,
  missionTestHandlers as handlers,
  openMission,
  runJob,
  VALID_BRIEF,
} from './testing/fixtures';

const MISSIONS_CHANNEL = '423456789012345678';
const ANNOUNCEMENTS_CHANNEL = '523456789012345678';

vi.setConfig(DATABASE_SUITE_TIMEOUTS);

describe('missions', () => {
  let kit: TestKit;
  let ops: UserActor;
  let reviewer: UserActor;

  beforeEach(async () => {
    kit = await createTestKit();
    ops = await kit.member({ roles: ['operations'] });
    reviewer = await kit.member({ roles: ['operations'] });
  });
  afterEach(async () => {
    await kit.close();
  });

  describe('lifecycle', () => {
    it('runs draft → open → self-assign → submit → verify with evidence, event and reward', async () => {
      await seedStarterAchievements(kit.system);
      await createAchievementDefinition(kit.system, {
        key: 'prototype_pilot',
        title: 'Prototype Pilot',
        summary: 'Prototype sprint verified.',
        description: 'Delivered the prototype sprint.',
        category: 'missions',
        criteria: { type: 'manual' },
      });
      await kit.drain(handlers);
      const draft = await createMission(kit.as(ops), {
        title: 'Prototype sprint',
        brief: VALID_BRIEF,
        type: 'build',
        facetKey: 'create.technical',
        durationHours: 48,
        rewardAchievementKey: 'prototype_pilot',
      });
      expect(draft.status).toBe('draft');
      const member = await kit.member();
      await expect(
        getMissionDetail(kit.as(member), { missionId: draft.id }),
      ).rejects.toBeInstanceOf(NotFoundError);

      const { mission } = await publishMission(kit.as(ops), { missionId: draft.id });
      expect(mission.status).toBe('open');
      expect(await eventsOfType(kit, 'mission.published')).toHaveLength(1);
      const open = await listOpenMissions(kit.as(member));
      expect(open.items.map((m) => m.number)).toEqual(['M-0001']);
      expect(open.items[0]?.myAssignment).toBeNull();

      const assignment = await selfAssignMission(kit.as(member), { missionId: mission.id });
      expect(assignment.status).toBe('accepted');
      expect(assignment.dueAt).toEqual(new Date(kit.clock.now().getTime() + 48 * HOUR));

      await expect(
        submitMission(kit.as(member), { assignmentId: assignment.id, submission: 'Done.' }),
      ).rejects.toBeInstanceOf(ValidationError);
      kit.clock.advance(HOUR);
      const submitted = await submitMission(kit.as(member), {
        assignmentId: assignment.id,
        submission: 'Prototype live; notes in the README.',
        evidence: EVIDENCE,
      });
      expect(submitted).toMatchObject({ status: 'submitted', attempts: 1 });

      const [verified] = await verifySubmission(kit.as(reviewer), {
        assignmentId: assignment.id,
        feedback: 'Clean work.',
      });
      expect(verified).toMatchObject({ status: 'verified', verifiedByUserId: reviewer.userId });
      const [proof] = await kit.db
        .select()
        .from(evidence)
        .where(eq(evidence.id, verified!.evidenceId!));
      expect(proof).toMatchObject({
        memberId: member.memberId,
        kind: 'mission',
        facetKey: 'create.technical',
        status: 'accepted',
        url: EVIDENCE.url,
        title: 'Mission M-0001: Prototype sprint',
      });
      const completed = await eventsOfType(kit, 'mission.completed');
      expect(completed.map((e) => e.subjectMemberId)).toEqual([member.memberId]);
      expect((await inboxOf(kit, member)).map((n) => n.title)).toContain('MISSION VERIFIED');

      await kit.drain(handlers);
      const awards = await kit.db
        .select()
        .from(memberAchievements)
        .where(eq(memberAchievements.memberId, member.memberId!));
      expect(awards.map((a) => a.achievementKey).sort()).toEqual([
        'first_mission',
        'prototype_pilot',
      ]);

      const history = await getMemberMissionHistory(kit.as(member), { memberId: member.memberId! });
      expect(history[0]).toMatchObject({ number: 'M-0001', status: 'verified' });
      const completedMine = await listMyMissions(kit.as(member), { scope: 'completed' });
      expect(completedMine).toHaveLength(1);
      expect(await listMyMissions(kit.as(member))).toEqual([]);
    });

    it('runs staff assignment → accept → reject → resubmit → verify', async () => {
      const mission = await openMission(kit, ops, { evidenceRequired: true });
      const member = await kit.member();
      const result = await assignMission(kit.as(ops), {
        missionId: mission.id,
        memberIds: [member.memberId!],
        durationHours: 72,
      });
      const assignment = result.assigned[0]!;
      expect(assignment.status).toBe('assigned');
      const inbox = await inboxOf(kit, member);
      expect(inbox.map((n) => n.title)).toContain('MISSION ASSIGNED');
      expect(inbox.find((n) => n.title === 'MISSION ASSIGNED')?.body).toMatch(
        /^M-0001 — Prototype sprint\./,
      );

      await expect(
        submitMission(kit.as(member), {
          assignmentId: assignment.id,
          submission: 'Early.',
          evidence: EVIDENCE,
        }),
      ).rejects.toThrow('Accept the mission before submitting.');
      await acceptMission(kit.as(member), { assignmentId: assignment.id });
      await submitMission(kit.as(member), {
        assignmentId: assignment.id,
        submission: 'First pass.',
        evidence: EVIDENCE,
      });
      const [returned] = await rejectSubmission(kit.as(reviewer), {
        assignmentId: assignment.id,
        feedback: 'Add the test results.',
      });
      expect(returned).toMatchObject({ status: 'rejected', feedback: 'Add the test results.' });
      const returnedNote = (await inboxOf(kit, member)).find((n) => n.title === 'MISSION RETURNED');
      expect(returnedNote?.body).toContain('Feedback: Add the test results. 2 attempt(s) left.');

      const resubmitted = await submitMission(kit.as(member), {
        assignmentId: assignment.id,
        submission: 'Second pass with tests.',
        evidence: EVIDENCE,
      });
      expect(resubmitted.attempts).toBe(2);
      const [verified] = await verifySubmission(kit.as(reviewer), { assignmentId: assignment.id });
      expect(verified?.status).toBe('verified');
      const audit = await kit.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'mission.verified'));
      expect(audit).toHaveLength(1);
    });

    it('announces on publish to the missions channel, falling back to announcements', async () => {
      const draftA = await createMission(kit.as(ops), {
        title: 'Alpha',
        brief: VALID_BRIEF,
        type: 'research',
      });
      expect((await publishMission(kit.as(ops), { missionId: draftA.id })).announced).toBe(false);

      await updateSettings(kit.system, 'channels', { announcements: ANNOUNCEMENTS_CHANNEL });
      const draftB = await createMission(kit.as(ops), {
        title: 'Bravo',
        brief: VALID_BRIEF,
        type: 'research',
      });
      await publishMission(kit.as(ops), { missionId: draftB.id });
      await updateSettings(kit.system, 'channels', { missions: MISSIONS_CHANNEL });
      const draftC = await createMission(kit.as(ops), {
        title: 'Charlie',
        brief: VALID_BRIEF,
        type: 'research',
      });
      await publishMission(kit.as(ops), { missionId: draftC.id });
      const announceJobs = await jobsOfType(kit, DISCORD_MISSION_ANNOUNCE_JOB);
      expect(announceJobs.map((j) => j.payload)).toEqual([
        { missionId: draftB.id, channelId: ANNOUNCEMENTS_CHANNEL },
        { missionId: draftC.id, channelId: MISSIONS_CHANNEL },
      ]);
    });

    it('closes, reopens and archives, refreshing an announced card', async () => {
      const mission = await openMission(kit, ops);
      const card = await getMissionCard(kit.system, { missionId: mission.id });
      expect(card).toMatchObject({ number: 'M-0001', acceptEnabled: true, announcement: null });
      expect(card?.acceptCustomId).toBe(`missions:accept:${mission.id}`);
      expect(
        await markMissionAnnounced(kit.system, {
          missionId: mission.id,
          channelId: MISSIONS_CHANNEL,
          messageId: '623456789012345678',
        }),
      ).toEqual({ stored: true });
      expect(
        await markMissionAnnounced(kit.system, {
          missionId: mission.id,
          channelId: MISSIONS_CHANNEL,
          messageId: '723456789012345678',
        }),
      ).toEqual({ stored: false });

      const member = await kit.member();
      const assignment = await selfAssignMission(kit.as(member), { missionId: mission.id });
      const closed = await closeMission(kit.as(ops), { missionId: mission.id });
      expect(closed.status).toBe('closed');
      expect((await getMissionCard(kit.system, { missionId: mission.id }))?.acceptEnabled).toBe(
        false,
      );
      await expect(
        selfAssignMission(kit.as(await kit.member()), { missionId: mission.id }),
      ).rejects.toBeInstanceOf(InvalidStateError);
      expect((await jobsOfType(kit, DISCORD_MISSION_REFRESH_CARD_JOB)).length).toBeGreaterThan(0);

      await reopenMission(kit.as(ops), { missionId: mission.id });
      await closeMission(kit.as(ops), { missionId: mission.id });
      const archived = await archiveMission(kit.as(ops), { missionId: mission.id });
      expect(archived.status).toBe('archived');
      const [expired] = await kit.db
        .select()
        .from(missionAssignments)
        .where(eq(missionAssignments.id, assignment.id));
      expect(expired?.status).toBe('expired');
      expect((await inboxOf(kit, member)).map((n) => n.body)).toContain(
        'M-0001 — Prototype sprint. The mission was archived before a submission arrived.',
      );
      await expect(
        getMissionDetail(kit.as(member), { missionId: mission.id }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('refuses to archive while submissions await review', async () => {
      const mission = await openMission(kit, ops);
      const member = await kit.member();
      const assignment = await selfAssignMission(kit.as(member), { missionId: mission.id });
      await submitMission(kit.as(member), { assignmentId: assignment.id, submission: 'Done.' });
      await closeMission(kit.as(ops), { missionId: mission.id });
      await expect(archiveMission(kit.as(ops), { missionId: mission.id })).rejects.toBeInstanceOf(
        ConflictError,
      );
      await verifySubmission(kit.as(reviewer), { assignmentId: assignment.id });
      expect((await archiveMission(kit.as(ops), { missionId: mission.id })).status).toBe(
        'archived',
      );
    });

    it('updates missions and forces team missions to staff assignment', async () => {
      const draft = await createMission(kit.as(ops), {
        title: 'Squad',
        brief: VALID_BRIEF,
        type: 'build',
      });
      const team = await updateMission(kit.as(ops), {
        missionId: draft.id,
        patch: { type: 'team' },
      });
      expect(team).toMatchObject({ type: 'team', selfAssignable: false });
      await publishMission(kit.as(ops), { missionId: draft.id, announce: false });
      await expect(
        updateMission(kit.as(ops), { missionId: draft.id, patch: { type: 'build' } }),
      ).rejects.toThrow('only change while it is a draft');
      const renamed = await updateMission(kit.as(ops), {
        missionId: draft.id,
        patch: { title: 'Squad run' },
      });
      expect(renamed.title).toBe('Squad run');
      await expect(
        createMission(kit.as(ops), {
          title: 'Solo team',
          brief: VALID_BRIEF,
          type: 'team',
          selfAssignable: true,
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe('staff assignment', () => {
    it('reports members it cannot assign instead of failing the batch', async () => {
      const mission = await openMission(kit, ops, { maxAssignees: 2 });
      const a = await kit.member();
      const b = await kit.member();
      const c = await kit.member();
      const banned = await kit.member();
      await kit.db
        .update(members)
        .set({ standing: 'banned' })
        .where(eq(members.id, banned.memberId!));
      const ghost = '00000000-0000-4000-8000-000000000001';
      const first = await assignMission(kit.as(ops), {
        missionId: mission.id,
        memberIds: [a.memberId!, ghost, banned.memberId!],
      });
      expect(first.assigned.map((x) => x.memberId)).toEqual([a.memberId]);
      expect(first.skipped).toEqual([
        { memberId: ghost, reason: 'not_found' },
        { memberId: banned.memberId, reason: 'ineligible' },
      ]);
      const second = await assignMission(kit.as(ops), {
        missionId: mission.id,
        memberIds: [a.memberId!, b.memberId!, c.memberId!],
      });
      expect(second.assigned.map((x) => x.memberId)).toEqual([b.memberId]);
      expect(second.skipped).toEqual([
        { memberId: a.memberId, reason: 'already_assigned' },
        { memberId: c.memberId, reason: 'mission_full' },
      ]);
    });

    it('restarts an abandoned assignment when staff reassign it', async () => {
      const mission = await openMission(kit, ops);
      const member = await kit.member();
      const assignment = await selfAssignMission(kit.as(member), { missionId: mission.id });
      await abandonMission(kit.as(member), { assignmentId: assignment.id });
      await expect(selfAssignMission(kit.as(member), { missionId: mission.id })).rejects.toThrow(
        'Ask staff to reassign you',
      );
      const again = await assignMission(kit.as(ops), {
        missionId: mission.id,
        memberIds: [member.memberId!],
      });
      expect(again.assigned[0]).toMatchObject({
        id: assignment.id,
        status: 'assigned',
        attempts: 0,
      });
    });
    it('notifies every review of every assignment cycle, including after a staff re-assignment', async () => {
      const mission = await openMission(kit, ops);
      const member = await kit.member();
      const first = await selfAssignMission(kit.as(member), { missionId: mission.id });
      await submitMission(kit.as(member), { assignmentId: first.id, submission: 'First pass.' });
      await rejectSubmission(kit.as(reviewer), {
        assignmentId: first.id,
        feedback: 'Needs a working demo.',
      });
      await abandonMission(kit.as(member), { assignmentId: first.id });

      kit.clock.advance(HOUR);
      const { assigned } = await assignMission(kit.as(ops), {
        missionId: mission.id,
        memberIds: [member.memberId!],
      });
      expect(assigned[0]).toMatchObject({ id: first.id, attempts: 0 });
      await acceptMission(kit.as(member), { assignmentId: first.id });
      await submitMission(kit.as(member), { assignmentId: first.id, submission: 'Second pass.' });
      await rejectSubmission(kit.as(reviewer), {
        assignmentId: first.id,
        feedback: 'Close. Add the benchmark.',
      });
      await submitMission(kit.as(member), { assignmentId: first.id, submission: 'Third pass.' });
      await verifySubmission(kit.as(reviewer), { assignmentId: first.id });

      const reviews = (await inboxOf(kit, member)).filter((n) => n.type === 'mission.reviewed');
      expect(reviews.map((n) => n.title).sort()).toEqual([
        'MISSION RETURNED',
        'MISSION RETURNED',
        'MISSION VERIFIED',
      ]);
      const bodies = reviews.map((n) => n.body);
      expect(bodies.some((body) => body.includes('Feedback: Needs a working demo.'))).toBe(true);
      expect(bodies.some((body) => body.includes('Feedback: Close. Add the benchmark.'))).toBe(
        true,
      );
    });
  });

  describe('team missions', () => {
    it('one submission moves the whole team; one verification completes every member', async () => {
      const mission = await openMission(kit, ops, { type: 'team', title: 'Relay build' });
      const [a, b, c, d] = await Promise.all([
        kit.member(),
        kit.member(),
        kit.member(),
        kit.member(),
      ]);
      await assignMission(kit.as(ops), {
        missionId: mission.id,
        memberIds: [a!.memberId!, b!.memberId!, c!.memberId!],
        teamKey: 'alpha',
      });
      await assignMission(kit.as(ops), {
        missionId: mission.id,
        memberIds: [d!.memberId!],
        teamKey: 'beta',
      });
      const rows = await kit.db
        .select()
        .from(missionAssignments)
        .where(eq(missionAssignments.missionId, mission.id));
      const byMember = new Map(rows.map((r) => [r.memberId, r]));
      const aAssignment = byMember.get(a!.memberId!)!;
      await acceptMission(kit.as(a!), { assignmentId: aAssignment.id });
      await acceptMission(kit.as(b!), { assignmentId: byMember.get(b!.memberId!)!.id });

      await submitMission(kit.as(a!), {
        assignmentId: aAssignment.id,
        submission: 'Team alpha delivery.',
      });
      const after = await kit.db
        .select()
        .from(missionAssignments)
        .where(eq(missionAssignments.missionId, mission.id));
      const alpha = after.filter((r) => r.teamKey === 'alpha');
      expect(alpha.map((r) => r.status)).toEqual(['submitted', 'submitted', 'submitted']);
      expect(alpha.every((r) => r.submittedByMemberId === a!.memberId)).toBe(true);
      expect(after.find((r) => r.teamKey === 'beta')?.status).toBe('assigned');

      const queue = await listSubmissionsForReview(kit.as(reviewer));
      expect(queue.total).toBe(1);
      expect(queue.items[0]?.members).toHaveLength(3);

      const verified = await verifySubmission(kit.as(reviewer), {
        assignmentId: byMember.get(c!.memberId!)!.id,
      });
      expect(verified).toHaveLength(3);
      const completed = await eventsOfType(kit, 'mission.completed');
      expect(new Set(completed.map((e) => e.subjectMemberId))).toEqual(
        new Set([a!.memberId, b!.memberId, c!.memberId]),
      );
      const proofs = await kit.db
        .select()
        .from(evidence)
        .where(and(eq(evidence.sourceType, 'mission'), eq(evidence.sourceId, mission.id)));
      expect(proofs).toHaveLength(3);
    });

    it('requires a team key for team missions and refuses one elsewhere', async () => {
      const team = await openMission(kit, ops, { type: 'team' });
      const solo = await openMission(kit, ops, { type: 'individual' });
      const m = await kit.member();
      await expect(
        assignMission(kit.as(ops), { missionId: team.id, memberIds: [m.memberId!] }),
      ).rejects.toThrow('team missions need a team key');
      await expect(
        assignMission(kit.as(ops), { missionId: solo.id, memberIds: [m.memberId!], teamKey: 'x' }),
      ).rejects.toThrow('only team missions take a team key');
      await expect(selfAssignMission(kit.as(m), { missionId: team.id })).rejects.toThrow(
        'assigned by staff',
      );
    });
  });

  describe('deadlines', () => {
    it('expires overdue assignments on the sweep and notifies the member', async () => {
      const mission = await openMission(kit, ops, { durationHours: 48 });
      const member = await kit.member();
      const assignment = await selfAssignMission(kit.as(member), { missionId: mission.id });
      kit.clock.advance(48 * HOUR - 1);
      await runJob(kit, MISSION_EXPIRE_JOB);
      expect(await eventsOfType(kit, 'mission.expired')).toHaveLength(0);
      kit.clock.advance(1);
      await expect(
        submitMission(kit.as(member), { assignmentId: assignment.id, submission: 'Late.' }),
      ).rejects.toThrow('The deadline has passed.');
      await runJob(kit, MISSION_EXPIRE_JOB);
      const [row] = await kit.db
        .select()
        .from(missionAssignments)
        .where(eq(missionAssignments.id, assignment.id));
      expect(row?.status).toBe('expired');
      const expired = await eventsOfType(kit, 'mission.expired');
      expect(expired.map((e) => e.subjectMemberId)).toEqual([member.memberId]);
      expect((await inboxOf(kit, member)).map((n) => n.title)).toContain('MISSION EXPIRED');
      await runJob(kit, MISSION_EXPIRE_JOB);
      expect(await eventsOfType(kit, 'mission.expired')).toHaveLength(1);
    });

    it('BREAK: a sweep working from a stale snapshot never expires a re-assigned row', async () => {
      const mission = await openMission(kit, ops, { durationHours: 24 });
      const member = await kit.member();
      const assignment = await selfAssignMission(kit.as(member), { missionId: mission.id });
      kit.clock.advance(25 * HOUR);
      const [snapshot] = await kit.db
        .select()
        .from(missionAssignments)
        .where(eq(missionAssignments.id, assignment.id));
      await abandonMission(kit.as(member), { assignmentId: assignment.id });
      await assignMission(kit.as(ops), { missionId: mission.id, memberIds: [member.memberId!] });

      const expired = await withTransaction(kit.system, (tx) =>
        expireAssignment(tx, snapshot!, mission, 'deadline'),
      );
      expect(expired).toBe(false);
      const [row] = await kit.db
        .select()
        .from(missionAssignments)
        .where(eq(missionAssignments.id, assignment.id));
      expect(row?.status).toBe('assigned');
      expect(await eventsOfType(kit, 'mission.expired')).toEqual([]);
    });

    it('never expires work that was submitted in time', async () => {
      const mission = await openMission(kit, ops, { durationHours: 2 });
      const member = await kit.member();
      const assignment = await selfAssignMission(kit.as(member), { missionId: mission.id });
      await submitMission(kit.as(member), { assignmentId: assignment.id, submission: 'On time.' });
      kit.clock.advance(3 * HOUR);
      await runJob(kit, MISSION_EXPIRE_JOB);
      const [row] = await kit.db
        .select()
        .from(missionAssignments)
        .where(eq(missionAssignments.id, assignment.id));
      expect(row?.status).toBe('submitted');
    });

    it('closes missions whose deadline passed', async () => {
      const deadline = new Date(kit.clock.now().getTime() + 10 * HOUR);
      const mission = await openMission(kit, ops, { deadlineAt: deadline });
      kit.clock.set(deadline);
      await expect(
        selfAssignMission(kit.as(await kit.member()), { missionId: mission.id }),
      ).rejects.toThrow('deadline has passed');
      await runJob(kit, MISSION_EXPIRE_JOB);
      const detail = await getMissionDetail(kit.as(ops), { missionId: mission.id });
      expect(detail.mission.status).toBe('closed');
      expect(await eventsOfType(kit, 'mission.closed')).toHaveLength(1);
    });

    it('sends one reminder 24 hours before the due date, and none for short assignments', async () => {
      const long = await openMission(kit, ops, { durationHours: 72 });
      const short = await openMission(kit, ops, { durationHours: 12, title: 'Quick fix' });
      const member = await kit.member();
      await selfAssignMission(kit.as(member), { missionId: long.id });
      await selfAssignMission(kit.as(member), { missionId: short.id });
      const reminders = async () =>
        (await inboxOf(kit, member)).filter((n) => n.title === 'MISSION DEADLINE');

      await runJob(kit, MISSION_REMINDER_JOB);
      expect(await reminders()).toHaveLength(0);
      kit.clock.advance(47 * HOUR);
      await runJob(kit, MISSION_REMINDER_JOB);
      expect(await reminders()).toHaveLength(0);
      kit.clock.advance(HOUR);
      await runJob(kit, MISSION_REMINDER_JOB);
      await runJob(kit, MISSION_REMINDER_JOB);
      const sent = await reminders();
      expect(sent).toHaveLength(1);
      expect(sent[0]?.body).toBe('M-0001 — Prototype sprint. Due in 24h.');
    });
  });

  describe('views', () => {
    it('shows assignee identities to staff only', async () => {
      const mission = await openMission(kit, ops);
      const a = await kit.member({ username: 'visible_a' });
      const b = await kit.member();
      await selfAssignMission(kit.as(a), { missionId: mission.id });
      const memberView = await getMissionDetail(kit.as(b), { missionId: mission.id });
      expect(memberView.assignments).toBeNull();
      expect(memberView.assigneeCount).toBe(1);
      expect(memberView.myAssignment).toBeNull();
      expect(JSON.stringify(memberView)).not.toContain('visible_a');
      const ownView = await getMissionDetail(kit.as(a), { missionId: mission.id });
      expect(ownView.myAssignment?.status).toBe('accepted');
      const staffView = await getMissionDetail(kit.as(ops), { missionId: mission.id });
      expect(staffView.assignments?.map((x) => x.memberHandle)).toEqual(['visible_a']);
    });

    it('limits mission history to verified work for other viewers and hides private profiles', async () => {
      const mission = await openMission(kit, ops);
      const other = await openMission(kit, ops, { title: 'Second' });
      const member = await kit.member();
      const viewer = await kit.member();
      const done = await selfAssignMission(kit.as(member), { missionId: mission.id });
      await selfAssignMission(kit.as(member), { missionId: other.id });
      await submitMission(kit.as(member), { assignmentId: done.id, submission: 'Done.' });
      await verifySubmission(kit.as(reviewer), { assignmentId: done.id });
      const publicHistory = await getMemberMissionHistory(kit.as(viewer), {
        memberId: member.memberId!,
      });
      expect(publicHistory.map((h) => h.status)).toEqual(['verified']);
      expect(publicHistory[0]?.assignment).toBeNull();
      expect(
        await getMemberMissionHistory(kit.as(member), { memberId: member.memberId! }),
      ).toHaveLength(2);
      await kit.db
        .update(members)
        .set({ profileVisibility: 'staff' })
        .where(eq(members.id, member.memberId!));
      await expect(
        getMemberMissionHistory(kit.as(viewer), { memberId: member.memberId! }),
      ).rejects.toBeInstanceOf(NotFoundError);
      expect(
        await getMemberMissionHistory(kit.as(ops), { memberId: member.memberId! }),
      ).toHaveLength(2);
    });

    it('masks hidden reward achievements for members', async () => {
      await seedStarterAchievements(kit.system);
      const mission = await openMission(kit, ops, { rewardAchievementKey: 'relentless' });
      const member = await kit.member();
      const [item] = (await listOpenMissions(kit.as(member))).items;
      expect(item?.reward).toEqual({ hidden: true, rarity: 'exceptional' });
      expect((await getMissionCard(kit.system, { missionId: mission.id }))?.rewardTitle).toBe(
        'HIDDEN ACHIEVEMENT',
      );
      const staffDetail = await getMissionDetail(kit.as(ops), { missionId: mission.id });
      expect(staffDetail.mission.reward).toMatchObject({ hidden: false, key: 'relentless' });
    });
  });
});
