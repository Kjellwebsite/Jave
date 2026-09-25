import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { auditLogs, missionAssignments, members } from '@jave/database';
import { createTestKit, type TestKit } from '../testing';
import { HOUR } from '../kernel/clock';
import {
  ConflictError,
  ForbiddenError,
  InvalidStateError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from '../kernel/errors';
import { resolveUserActor } from '../identity/users.service';
import { anonymousActor, type UserActor } from '../permissions/actor';
import {
  abandonMission,
  acceptMission,
  archiveMission,
  assignMission,
  closeMission,
  createMission,
  getMissionCard,
  getMissionDetail,
  listSubmissionsForReview,
  markMissionAnnounced,
  publishMission,
  rejectSubmission,
  reopenMission,
  selfAssignMission,
  submitMission,
  updateMission,
  verifySubmission,
} from './index';
import { DATABASE_SUITE_TIMEOUTS, EVIDENCE, openMission, VALID_BRIEF } from './testing/fixtures';

vi.setConfig(DATABASE_SUITE_TIMEOUTS);

/** Message of an error and of its cause (driver errors arrive wrapped). */
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return `${error.message} ${error.cause instanceof Error ? error.cause.message : ''}`;
}

describe('missions — adversarial', () => {
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

  async function audits(action: string) {
    return kit.db.select().from(auditLogs).where(eq(auditLogs.action, action));
  }

  it('BREAK: a reviewer cannot verify or reject their own mission', async () => {
    const mission = await openMission(kit, ops);
    const own = await selfAssignMission(kit.as(ops), { missionId: mission.id });
    await submitMission(kit.as(ops), { assignmentId: own.id, submission: 'My own work.' });
    await expect(verifySubmission(kit.as(ops), { assignmentId: own.id })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      rejectSubmission(kit.as(ops), { assignmentId: own.id, feedback: 'Reject myself.' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const blocked = await audits('mission.self_review_blocked');
    expect(blocked).toHaveLength(2);
    expect(blocked[0]).toMatchObject({ result: 'denied', actorUserId: ops.userId });
    const queue = await listSubmissionsForReview(kit.as(ops));
    expect(queue.items[0]?.isOwn).toBe(true);
    const [verified] = await verifySubmission(kit.as(reviewer), { assignmentId: own.id });
    expect(verified?.status).toBe('verified');
  });

  it('BREAK: a staff member on a team cannot verify the team through a teammate’s assignment', async () => {
    const mission = await openMission(kit, reviewer, { type: 'team' });
    const mate = await kit.member();
    const { assigned } = await assignMission(kit.as(reviewer), {
      missionId: mission.id,
      memberIds: [ops.memberId!, mate.memberId!],
      teamKey: 'red',
    });
    const mateAssignment = assigned.find((a) => a.memberId === mate.memberId)!;
    const opsAssignment = assigned.find((a) => a.memberId === ops.memberId)!;
    // Walking away from the team does not make ops an outsider who may review it.
    await abandonMission(kit.as(ops), { assignmentId: opsAssignment.id });
    await acceptMission(kit.as(mate), { assignmentId: mateAssignment.id });
    await submitMission(kit.as(mate), { assignmentId: mateAssignment.id, submission: 'Team red.' });
    const queue = await listSubmissionsForReview(kit.as(ops));
    expect(queue.items[0]).toMatchObject({ teamKey: 'red', isOwn: true });
    await expect(
      verifySubmission(kit.as(ops), { assignmentId: mateAssignment.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      rejectSubmission(kit.as(ops), { assignmentId: mateAssignment.id, feedback: 'Sabotage.' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const [verified] = await verifySubmission(kit.as(reviewer), {
      assignmentId: mateAssignment.id,
    });
    expect(verified?.memberId).toBe(mate.memberId);
  });

  it('BREAK: leaving a team for another does not make a staff member an outsider who may review it', async () => {
    const mission = await openMission(kit, reviewer, { type: 'team' });
    const mate = await kit.member();
    const { assigned } = await assignMission(kit.as(reviewer), {
      missionId: mission.id,
      memberIds: [ops.memberId!, mate.memberId!],
      teamKey: 'red',
    });
    const mateAssignment = assigned.find((a) => a.memberId === mate.memberId)!;
    const opsAssignment = assigned.find((a) => a.memberId === ops.memberId)!;
    await abandonMission(kit.as(ops), { assignmentId: opsAssignment.id });
    await acceptMission(kit.as(mate), { assignmentId: mateAssignment.id });
    await submitMission(kit.as(mate), { assignmentId: mateAssignment.id, submission: 'Team red.' });

    await expect(
      assignMission(kit.as(ops), {
        missionId: mission.id,
        memberIds: [ops.memberId!],
        teamKey: 'blue',
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const [blocked] = await audits('mission.self_assign_blocked');
    expect(blocked).toMatchObject({ result: 'denied', actorUserId: ops.userId });

    const moved = await assignMission(kit.as(reviewer), {
      missionId: mission.id,
      memberIds: [ops.memberId!],
      teamKey: 'blue',
    });
    expect(moved).toEqual({
      assigned: [],
      skipped: [{ memberId: ops.memberId, reason: 'team_locked' }],
    });
    const [opsRow] = await kit.db
      .select()
      .from(missionAssignments)
      .where(eq(missionAssignments.id, opsAssignment.id));
    expect(opsRow).toMatchObject({ status: 'abandoned', teamKey: 'red' });
    await expect(
      verifySubmission(kit.as(ops), { assignmentId: mateAssignment.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const rejoined = await assignMission(kit.as(reviewer), {
      missionId: mission.id,
      memberIds: [ops.memberId!],
      teamKey: 'red',
    });
    expect(rejoined.assigned[0]).toMatchObject({ id: opsAssignment.id, status: 'assigned' });
  });

  it('BREAK: staff cannot assign a mission to themselves, alone or inside a batch', async () => {
    const mission = await openMission(kit, reviewer, { selfAssignable: false });
    const other = await kit.member();
    await expect(
      assignMission(kit.as(ops), {
        missionId: mission.id,
        memberIds: [other.memberId!, ops.memberId!],
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const rows = await kit.db
      .select()
      .from(missionAssignments)
      .where(eq(missionAssignments.missionId, mission.id));
    expect(rows).toEqual([]);
    expect(await audits('mission.self_assign_blocked')).toHaveLength(1);

    const { assigned } = await assignMission(kit.as(reviewer), {
      missionId: mission.id,
      memberIds: [ops.memberId!],
    });
    expect(assigned.map((a) => a.memberId)).toEqual([ops.memberId]);
  });

  it('BREAK: a submission holds the mission lock archiving takes, so it cannot slip past the archive check', async () => {
    // PGlite runs one transaction at a time, so the READ COMMITTED race
    // (archive finds nothing pending, a submission commits, the archive goes
    // ahead) cannot be replayed here. Assert the mechanism instead: a trigger
    // refuses any move to SUBMITTED by a transaction that does not hold a row
    // lock on the mission (a locked row's xmax is the locking transaction).
    await kit.db.execute(
      sql.raw(`create function test_require_mission_lock() returns trigger
        language plpgsql as $$ begin
          if not exists (
            select 1 from missions where id = new.mission_id and xmax = pg_current_xact_id()::xid
          ) then
            raise exception 'mission % not locked by this transaction', new.mission_id;
          end if;
          return new;
        end $$`),
    );
    await kit.db.execute(
      sql.raw(`create trigger test_require_mission_lock before update on mission_assignments
        for each row when (new.status = 'submitted' and old.status <> 'submitted')
        execute function test_require_mission_lock()`),
    );
    const mission = await openMission(kit, ops);
    const member = await kit.member();
    const own = await selfAssignMission(kit.as(member), { missionId: mission.id });
    await closeMission(kit.as(ops), { missionId: mission.id });

    const unlocked = await kit.db
      .update(missionAssignments)
      .set({ status: 'submitted' })
      .where(eq(missionAssignments.id, own.id))
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(describeError(unlocked)).toContain('not locked by this transaction');

    const submitted = await submitMission(kit.as(member), {
      assignmentId: own.id,
      submission: 'Done before the archive.',
    });
    expect(submitted.status).toBe('submitted');
    await expect(archiveMission(kit.as(ops), { missionId: mission.id })).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it('BREAK: members and moderators cannot create, assign, publish or review missions', async () => {
    const member = await kit.member();
    const moderator = await kit.member({ roles: ['moderator'] });
    const mission = await openMission(kit, ops);
    const target = await kit.member();
    for (const actor of [member, moderator]) {
      await expect(
        createMission(kit.as(actor), { title: 'Mine', brief: VALID_BRIEF, type: 'build' }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        assignMission(kit.as(actor), { missionId: mission.id, memberIds: [target.memberId!] }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(closeMission(kit.as(actor), { missionId: mission.id })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    }
    const own = await selfAssignMission(kit.as(target), { missionId: mission.id });
    await submitMission(kit.as(target), { assignmentId: own.id, submission: 'Work.' });
    await expect(verifySubmission(kit.as(member), { assignmentId: own.id })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(listSubmissionsForReview(kit.as(member))).rejects.toBeInstanceOf(ForbiddenError);
    expect((await audits('access.denied')).length).toBeGreaterThanOrEqual(8);
    await expect(
      assignMission(kit.as(anonymousActor), {
        missionId: mission.id,
        memberIds: [target.memberId!],
      }),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it('BREAK: nobody can accept, submit or abandon someone else’s assignment (IDOR)', async () => {
    const mission = await openMission(kit, ops);
    const victim = await kit.member();
    const attacker = await kit.member();
    const { assigned } = await assignMission(kit.as(ops), {
      missionId: mission.id,
      memberIds: [victim.memberId!],
    });
    const target = assigned[0]!;
    await expect(
      acceptMission(kit.as(attacker), { assignmentId: target.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await acceptMission(kit.as(victim), { assignmentId: target.id });
    await expect(
      submitMission(kit.as(attacker), { assignmentId: target.id, submission: 'Hijacked.' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      abandonMission(kit.as(attacker), { assignmentId: target.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
    // Staff are not assignees either: capabilities do not open someone else's assignment.
    await expect(
      submitMission(kit.as(ops), { assignmentId: target.id, submission: 'Staff override.' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    const [row] = await kit.db
      .select()
      .from(missionAssignments)
      .where(eq(missionAssignments.id, target.id));
    expect(row).toMatchObject({ status: 'accepted', submission: null });
    const detail = await getMissionDetail(kit.as(attacker), { missionId: mission.id });
    expect(detail.assignments).toBeNull();
    expect(detail.myAssignment).toBeNull();
  });

  it('BREAK: drafts are invisible and unassignable to members', async () => {
    const draft = await createMission(kit.as(ops), {
      title: 'Secret',
      brief: VALID_BRIEF,
      type: 'build',
    });
    const member = await kit.member();
    await expect(getMissionDetail(kit.as(member), { missionId: draft.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(selfAssignMission(kit.as(member), { missionId: draft.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      assignMission(kit.as(ops), { missionId: draft.id, memberIds: [member.memberId!] }),
    ).rejects.toBeInstanceOf(InvalidStateError);
  });

  it('BREAK: invalid transitions are refused', async () => {
    const mission = await openMission(kit, ops);
    const member = await kit.member();
    const assignment = await selfAssignMission(kit.as(member), { missionId: mission.id });
    await expect(
      acceptMission(kit.as(member), { assignmentId: assignment.id }),
    ).rejects.toBeInstanceOf(InvalidStateError);
    await expect(
      verifySubmission(kit.as(reviewer), { assignmentId: assignment.id }),
    ).rejects.toBeInstanceOf(InvalidStateError);
    await expect(publishMission(kit.as(ops), { missionId: mission.id })).rejects.toBeInstanceOf(
      InvalidStateError,
    );
    await expect(reopenMission(kit.as(ops), { missionId: mission.id })).rejects.toBeInstanceOf(
      InvalidStateError,
    );
    await expect(archiveMission(kit.as(ops), { missionId: mission.id })).rejects.toBeInstanceOf(
      InvalidStateError,
    );
    const draft = await createMission(kit.as(ops), {
      title: 'Draft',
      brief: VALID_BRIEF,
      type: 'build',
    });
    await expect(closeMission(kit.as(ops), { missionId: draft.id })).rejects.toBeInstanceOf(
      InvalidStateError,
    );
    await submitMission(kit.as(member), { assignmentId: assignment.id, submission: 'Done.' });
    await expect(
      abandonMission(kit.as(member), { assignmentId: assignment.id }),
    ).rejects.toBeInstanceOf(InvalidStateError);
    await verifySubmission(kit.as(reviewer), { assignmentId: assignment.id });
    await expect(
      submitMission(kit.as(member), { assignmentId: assignment.id, submission: 'Again.' }),
    ).rejects.toBeInstanceOf(InvalidStateError);
    await expect(selfAssignMission(kit.as(member), { missionId: mission.id })).rejects.toThrow(
      'already completed',
    );
    await closeMission(kit.as(ops), { missionId: mission.id });
    await archiveMission(kit.as(ops), { missionId: mission.id });
    await expect(
      updateMission(kit.as(ops), { missionId: mission.id, patch: { title: 'Revived' } }),
    ).rejects.toBeInstanceOf(InvalidStateError);
  });

  it('BREAK: resubmission is capped', async () => {
    const mission = await openMission(kit, ops);
    const member = await kit.member();
    const assignment = await selfAssignMission(kit.as(member), { missionId: mission.id });
    for (let attempt = 1; attempt <= 3; attempt++) {
      await submitMission(kit.as(member), {
        assignmentId: assignment.id,
        submission: `Try ${attempt}.`,
      });
      await rejectSubmission(kit.as(reviewer), {
        assignmentId: assignment.id,
        feedback: 'Not yet.',
      });
    }
    await expect(
      submitMission(kit.as(member), { assignmentId: assignment.id, submission: 'Try 4.' }),
    ).rejects.toThrow('No submission attempts left.');
  });

  it('BREAK: malformed and oversized input is rejected', async () => {
    const mission = await openMission(kit, ops, { evidenceRequired: true });
    const member = await kit.member();
    const assignment = await selfAssignMission(kit.as(member), { missionId: mission.id });
    const base = { title: 'Valid title', brief: VALID_BRIEF, type: 'build' as const };
    const badMissions: Record<string, unknown>[] = [
      { ...base, title: 'T'.repeat(121) },
      { ...base, title: 'Two\nlines' },
      { ...base, brief: 'short' },
      { ...base, brief: 'B'.repeat(4001) },
      { ...base, brief: `${VALID_BRIEF}\u0000` },
      { ...base, type: 'heist' },
      { ...base, maxAssignees: 0 },
      { ...base, maxAssignees: -5 },
      { ...base, durationHours: 0 },
      { ...base, durationHours: 1e6 },
      { ...base, deadlineAt: 'yesterday-ish' },
      { ...base, rewardAchievementKey: 'Not A Key' },
      { ...base, status: 'open' },
    ];
    for (const input of badMissions) {
      await expect(
        createMission(kit.as(ops), input as never),
        JSON.stringify(input).slice(0, 80),
      ).rejects.toBeInstanceOf(ValidationError);
    }
    await expect(
      createMission(kit.as(ops), {
        ...base,
        deadlineAt: new Date(kit.clock.now().getTime() - HOUR),
      }),
    ).rejects.toThrow('must be in the future');
    await expect(
      createMission(kit.as(ops), { ...base, rewardAchievementKey: 'does_not_exist' }),
    ).rejects.toThrow('unknown or inactive achievement');
    await expect(
      createMission(kit.as(ops), { ...base, facetKey: 'mind.telepathy' }),
    ).rejects.toThrow('Unknown capability.');

    const badSubmissions: Record<string, unknown>[] = [
      { assignmentId: assignment.id, submission: '' },
      { assignmentId: assignment.id, submission: 'S'.repeat(4001), evidence: EVIDENCE },
      {
        assignmentId: assignment.id,
        submission: 'x',
        evidence: { title: 'Link', url: 'javascript:alert(1)' },
      },
      {
        assignmentId: assignment.id,
        submission: 'x',
        evidence: { title: 'Link', url: 'data:text/html,hi' },
      },
      { assignmentId: assignment.id, submission: 'x', evidence: { title: 'L', url: EVIDENCE.url } },
      { assignmentId: assignment.id, submission: 'x', evidence: { ...EVIDENCE, extra: true } },
      { assignmentId: 'not-a-uuid', submission: 'x' },
    ];
    for (const input of badSubmissions) {
      await expect(
        submitMission(kit.as(member), input as never),
        JSON.stringify(input).slice(0, 80),
      ).rejects.toBeInstanceOf(ValidationError);
    }
    const tooMany = Array.from(
      { length: 51 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    );
    await expect(
      assignMission(kit.as(ops), { missionId: mission.id, memberIds: tooMany }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      assignMission(kit.as(ops), {
        missionId: mission.id,
        memberIds: [member.memberId!, member.memberId!],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      assignMission(kit.as(ops), {
        missionId: mission.id,
        memberIds: [member.memberId!],
        dueAt: new Date(kit.clock.now().getTime() + HOUR),
        durationHours: 5,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      rejectSubmission(kit.as(reviewer), { assignmentId: assignment.id, feedback: 'no' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('BREAK: concurrent double-verification and double-submission take effect once', async () => {
    const mission = await openMission(kit, ops);
    const member = await kit.member();
    const assignment = await selfAssignMission(kit.as(member), { missionId: mission.id });
    const submits = await Promise.allSettled([
      submitMission(kit.as(member), { assignmentId: assignment.id, submission: 'One.' }),
      submitMission(kit.as(member), { assignmentId: assignment.id, submission: 'Two.' }),
    ]);
    expect(submits.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const third = await kit.member({ roles: ['operations'] });
    const verifies = await Promise.allSettled([
      verifySubmission(kit.as(reviewer), { assignmentId: assignment.id }),
      verifySubmission(kit.as(third), { assignmentId: assignment.id }),
    ]);
    expect(verifies.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failure = verifies.find((r) => r.status === 'rejected');
    expect(failure?.status === 'rejected' && failure.reason).toBeInstanceOf(ConflictError);
    const [row] = await kit.db
      .select()
      .from(missionAssignments)
      .where(eq(missionAssignments.id, assignment.id));
    expect(row?.attempts).toBe(1);
  });

  it('BREAK: concurrent self-assignment cannot overfill a mission', async () => {
    const mission = await openMission(kit, ops, { maxAssignees: 1 });
    const [a, b, c] = await Promise.all([kit.member(), kit.member(), kit.member()]);
    const results = await Promise.allSettled(
      [a!, b!, c!].map((m) => selfAssignMission(kit.as(m), { missionId: mission.id })),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const card = await getMissionCard(kit.system, { missionId: mission.id });
    expect(card).toMatchObject({ slotsLeft: 0, acceptEnabled: false });
  });

  it('BREAK: time edges — exactly at the due date and the deadline is too late', async () => {
    const deadline = new Date(kit.clock.now().getTime() + 5 * HOUR);
    const mission = await openMission(kit, ops, { durationHours: 2, deadlineAt: deadline });
    const member = await kit.member();
    const assignment = await selfAssignMission(kit.as(member), { missionId: mission.id });
    kit.clock.advance(2 * HOUR);
    await expect(
      submitMission(kit.as(member), {
        assignmentId: assignment.id,
        submission: 'Exactly on time?',
      }),
    ).rejects.toThrow('The deadline has passed.');
    // Two hours before the deadline, a 2-hour duration is capped at the deadline itself.
    kit.clock.advance(HOUR + HOUR / 2);
    const staffAssigned = await kit.member();
    const { assigned } = await assignMission(kit.as(ops), {
      missionId: mission.id,
      memberIds: [staffAssigned.memberId!],
    });
    expect(assigned[0]?.dueAt).toEqual(deadline);
    kit.clock.set(deadline);
    await expect(
      acceptMission(kit.as(staffAssigned), { assignmentId: assigned[0]!.id }),
    ).rejects.toThrow('The deadline has passed.');
    await expect(
      selfAssignMission(kit.as(await kit.member()), { missionId: mission.id }),
    ).rejects.toThrow('deadline has passed');
    await expect(
      assignMission(kit.as(ops), {
        missionId: mission.id,
        memberIds: [(await kit.member()).memberId!],
        dueAt: new Date(deadline.getTime() + HOUR),
      }),
    ).rejects.toThrow('The mission deadline has passed.');
    // Before the sweep closes it, a lapsed mission still refuses new work.
    await expect(
      assignMission(kit.as(ops), {
        missionId: mission.id,
        memberIds: [(await kit.member()).memberId!],
        durationHours: 1,
      }),
    ).rejects.toBeInstanceOf(InvalidStateError);
  });

  it('BREAK: members in bad standing cannot take or submit missions', async () => {
    const mission = await openMission(kit, ops);
    const member = await kit.member();
    const assignment = await selfAssignMission(kit.as(member), { missionId: mission.id });
    await kit.db
      .update(members)
      .set({ standing: 'quarantined' })
      .where(eq(members.id, member.memberId!));
    const quarantined = await resolveUserActor(kit.system, member.userId);
    await expect(
      submitMission(kit.as(quarantined), {
        assignmentId: assignment.id,
        submission: 'Still here.',
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      selfAssignMission(kit.as(quarantined), {
        missionId: (await openMission(kit, ops, { title: 'Other' })).id,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('BREAK: only the system may drive the Discord callbacks', async () => {
    const mission = await openMission(kit, ops);
    const member = await kit.member();
    await expect(
      markMissionAnnounced(kit.as(member), {
        missionId: mission.id,
        channelId: '123456789012345678',
        messageId: '223456789012345678',
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getMissionCard(kit.as(ops), { missionId: mission.id })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      markMissionAnnounced(kit.system, {
        missionId: mission.id,
        channelId: 'general',
        messageId: '1',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
