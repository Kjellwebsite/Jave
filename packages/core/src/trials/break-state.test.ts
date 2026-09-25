import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { domainEvents, jobs, notifications, trialSubmissions } from '@jave/database';
import { MINUTE } from '../kernel/clock';
import {
  ConflictError,
  ForbiddenError,
  InvalidStateError,
  NotFoundError,
  ValidationError,
} from '../kernel/errors';
import type { JobHandlerMap } from '../jobs/worker';
import { createTestKit, type TestKit } from '../testing';
import {
  applyToTrial,
  assignTeams,
  cancelTrial,
  closeSubmissions,
  createTemplate,
  createTrial,
  evaluate,
  extendDeadline,
  getTrialForParticipant,
  getTrialForStaff,
  openRecruitment,
  publishResults,
  selectParticipants,
  startTrial,
  submit,
  sweepOverdueTrials,
  withdraw,
} from './index';
import {
  configureDiscord,
  createFakeDiscordLog,
  CUSTOM_TRIAL,
  members as makeMembers,
  recruitingTrial,
  runningTrial,
  STATEMENT,
  trialHandlers,
  PGLITE_HOOK_TIMEOUT_MS,
  PGLITE_SUITE,
} from './testing/fixtures';

const SCORES = { shipped: 8, value: 6 };
const SUMMARY = 'A working product, deployed, with real users.';

describe('trials: BREAK — state, input and time', PGLITE_SUITE, () => {
  let kit: TestKit;
  let handlers: JobHandlerMap;
  beforeEach(async () => {
    kit = await createTestKit();
    handlers = trialHandlers(createFakeDiscordLog());
    await configureDiscord(kit);
  }, PGLITE_HOOK_TIMEOUT_MS);
  afterEach(async () => {
    await kit.close();
  }, PGLITE_HOOK_TIMEOUT_MS);

  it('BREAK: invalid transitions are refused with INVALID_STATE', async () => {
    const ops = await kit.member({ roles: ['operations'] });
    const [a] = await makeMembers(kit, 1);
    const draft = await createTrial(kit.as(ops), CUSTOM_TRIAL);
    await expect(startTrial(kit.as(ops), { trialId: draft.id })).rejects.toBeInstanceOf(
      InvalidStateError,
    );
    // Drafts are staff-only: applying does not even confirm they exist.
    await expect(
      applyToTrial(kit.as(a!), { trialId: draft.id, statement: STATEMENT }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await openRecruitment(kit.as(ops), { trialId: draft.id });
    await expect(openRecruitment(kit.as(ops), { trialId: draft.id })).rejects.toBeInstanceOf(
      InvalidStateError,
    );
    await expect(
      assignTeams(kit.as(ops), { trialId: draft.id, strategy: 'random' }),
    ).rejects.toThrow('no selected participants');
    await expect(publishResults(kit.as(ops), { trialId: draft.id })).rejects.toBeInstanceOf(
      InvalidStateError,
    );
    await cancelTrial(kit.as(ops), { trialId: draft.id, reason: 'Duplicate of TRIAL-0001.' });
    await expect(
      cancelTrial(kit.as(ops), { trialId: draft.id, reason: 'again' }),
    ).rejects.toBeInstanceOf(InvalidStateError);
    await expect(openRecruitment(kit.as(ops), { trialId: draft.id })).rejects.toBeInstanceOf(
      InvalidStateError,
    );
  });

  it('BREAK: malformed and oversized input never reaches the database', async () => {
    const ops = await kit.member({ roles: ['operations'] });
    const [a, b] = await makeMembers(kit, 2);
    await expect(
      getTrialForParticipant(kit.as(a!), { trialId: "1' OR '1'='1" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createTrial(kit.as(ops), { ...CUSTOM_TRIAL, title: 'x'.repeat(500) }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createTrial(kit.as(ops), { ...CUSTOM_TRIAL, facetKeys: ['mind.telepathy'] }),
    ).rejects.toThrow('Unknown capability facet');
    await expect(
      createTrial(kit.as(ops), { title: 'Only a title', category: 'build' }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createTemplate(kit.as(ops), {
        key: 'dup-rubric',
        title: 'Duplicate rubric',
        category: 'build',
        summary: 'A template with duplicate criteria.',
        brief: 'x'.repeat(60),
        durationMinutes: 60,
        rubric: [
          { key: 'impact', label: 'Impact', weight: 1 },
          { key: 'impact', label: 'Impact again', weight: 1 },
        ],
      }),
    ).rejects.toThrow('duplicate criterion key');

    const { trialId, assignment } = await runningTrial(kit, ops, [a!, b!], { teamSize: 2 });
    await expect(
      submit(kit.as(a!), { trialId, summary: SUMMARY, links: ['javascript:alert(1)'] }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      submit(kit.as(a!), { trialId, summary: 'x'.repeat(50_000) }),
    ).rejects.toBeInstanceOf(ValidationError);
    const cleaned = await submit(kit.as(a!), {
      trialId,
      summary: `NUL\u0000 bytes\u0008 are stripped: ${SUMMARY}`,
    });
    const [row] = await kit.db
      .select()
      .from(trialSubmissions)
      .where(eq(trialSubmissions.id, cleaned.id));
    expect(row!.summary).toBe(`NUL bytes are stripped: ${SUMMARY}`);

    await closeSubmissions(kit.as(ops), { trialId });
    const teamId = assignment.teams[0]!.id;
    await expect(
      evaluate(kit.as(ops), { trialId, teamId, scores: { shipped: 8 } }),
    ).rejects.toThrow('Missing: value');
    await expect(
      evaluate(kit.as(ops), { trialId, teamId, scores: { ...SCORES, bribe: 10 } }),
    ).rejects.toThrow('Unknown criterion');
    await expect(
      evaluate(kit.as(ops), { trialId, teamId, scores: { shipped: 80, value: 6 } }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('BREAK: duplicate and concurrent requests resolve cleanly', async () => {
    const ops = await kit.member({ roles: ['operations'] });
    const [a, b, c] = await makeMembers(kit, 3);
    const trialId = await recruitingTrial(kit, ops, [a!]);
    await expect(
      applyToTrial(kit.as(a!), { trialId, statement: STATEMENT }),
    ).rejects.toBeInstanceOf(ConflictError);
    const racing = await Promise.allSettled([
      applyToTrial(kit.as(b!), { trialId, statement: STATEMENT }),
      applyToTrial(kit.as(b!), { trialId, statement: STATEMENT }),
    ]);
    expect(racing.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = racing.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ConflictError);

    // Withdrawing and re-applying is allowed while recruiting.
    await withdraw(kit.as(b!), { trialId });
    await expect(
      applyToTrial(kit.as(b!), { trialId, statement: STATEMENT }),
    ).resolves.toMatchObject({ status: 'applied' });

    await applyToTrial(kit.as(c!), { trialId, statement: STATEMENT });
    await selectParticipants(kit.as(ops), {
      trialId,
      mode: 'manual',
      memberIds: [a!.memberId!, b!.memberId!, c!.memberId!],
    });
    const assignment = await assignTeams(kit.as(ops), {
      trialId,
      strategy: 'random',
      seed: 's',
      teamSize: 3,
    });
    await startTrial(kit.as(ops), { trialId });
    await expect(startTrial(kit.as(ops), { trialId })).rejects.toBeInstanceOf(InvalidStateError);

    const versions = await Promise.all(
      [a!, b!, c!].map((m) => submit(kit.as(m), { trialId, summary: SUMMARY })),
    );
    expect(versions.map((v) => v.version).sort()).toEqual([1, 2, 3]);

    await closeSubmissions(kit.as(ops), { trialId });
    await expect(closeSubmissions(kit.as(ops), { trialId })).rejects.toBeInstanceOf(
      InvalidStateError,
    );
    await evaluate(kit.as(ops), { trialId, teamId: assignment.teams[0]!.id, scores: SCORES });
    await publishResults(kit.as(ops), { trialId });
    await expect(publishResults(kit.as(ops), { trialId })).rejects.toBeInstanceOf(ConflictError);
    const resultNotes = await kit.db
      .select()
      .from(notifications)
      .where(eq(notifications.type, 'trial.result'));
    expect(resultNotes).toHaveLength(3);
  });

  it('BREAK: submissions after the close are rejected — even before the close job runs', async () => {
    const ops = await kit.member({ roles: ['operations'] });
    const [a, b] = await makeMembers(kit, 2);
    const { trialId } = await runningTrial(kit, ops, [a!, b!], { teamSize: 1 });
    const { deadlineAt } = await getTrialForStaff(kit.as(ops), { trialId });

    kit.clock.set(deadlineAt!);
    expect((await submit(kit.as(a!), { trialId, summary: SUMMARY })).isLate).toBe(false);
    kit.clock.set(new Date(deadlineAt!.getTime() + 15 * MINUTE));
    expect((await submit(kit.as(a!), { trialId, summary: SUMMARY })).isLate).toBe(true);
    kit.clock.set(new Date(deadlineAt!.getTime() + 15 * MINUTE + 1));
    await expect(submit(kit.as(b!), { trialId, summary: SUMMARY })).rejects.toThrow(
      'Submissions for',
    );

    // The close job closes it; afterwards submissions stay closed.
    await kit.drain(handlers);
    await expect(submit(kit.as(a!), { trialId, summary: SUMMARY })).rejects.toBeInstanceOf(
      InvalidStateError,
    );
    await expect(withdraw(kit.as(a!), { trialId })).rejects.toBeInstanceOf(InvalidStateError);
  });

  it('BREAK: extending a deadline reschedules warnings and the close; stale jobs do nothing', async () => {
    const ops = await kit.member({ roles: ['operations'] });
    const [a] = await makeMembers(kit, 1);
    const { trialId } = await runningTrial(kit, ops, [a!], { teamSize: 1 });
    const { deadlineAt } = await getTrialForStaff(kit.as(ops), { trialId });
    await expect(
      extendDeadline(kit.as(ops), { trialId, minutes: 0, reason: 'nothing' }),
    ).rejects.toBeInstanceOf(ValidationError);

    const extended = await extendDeadline(kit.as(ops), {
      trialId,
      minutes: 60,
      reason: 'Discord outage — one extra hour.',
    });
    expect(extended.deadlineAt!.getTime()).toBe(deadlineAt!.getTime() + 60 * MINUTE);
    const pending = await kit.db.select().from(jobs).where(eq(jobs.status, 'pending'));
    const closeJobs = pending.filter((j) => j.type === 'trials.close_submissions');
    expect(closeJobs).toHaveLength(1);
    expect(closeJobs[0]!.payload.deadlineAt).toBe(extended.deadlineAt!.toISOString());

    // The rescheduled 60-minute warning fires at the old deadline; the old warnings never do.
    kit.clock.set(deadlineAt!);
    await kit.drain(handlers);
    const warnings = await kit.db
      .select()
      .from(notifications)
      .where(eq(notifications.type, 'trial.deadline'));
    expect(warnings.map((n) => n.title)).toEqual(['DEADLINE EXTENDED', 'TRIAL DEADLINE — 1H']);

    // The old close time passes: still active.
    kit.clock.set(new Date(deadlineAt!.getTime() + 20 * MINUTE));
    await kit.drain(handlers);
    expect((await getTrialForStaff(kit.as(ops), { trialId })).status).toBe('active');

    // The new close time passes: evaluating.
    kit.clock.set(new Date(extended.deadlineAt!.getTime() + 15 * MINUTE));
    await kit.drain(handlers);
    expect((await getTrialForStaff(kit.as(ops), { trialId })).status).toBe('evaluating');
  });

  it('BREAK: late-running warnings never fire after the deadline; the sweep closes overdue trials', async () => {
    const ops = await kit.member({ roles: ['operations'] });
    const [a] = await makeMembers(kit, 1);
    const { trialId } = await runningTrial(kit, ops, [a!], { teamSize: 1 });
    const { deadlineAt } = await getTrialForStaff(kit.as(ops), { trialId });
    // Simulate a lost close job: nothing pending for this trial any more.
    await kit.db
      .update(jobs)
      .set({ status: 'cancelled' })
      .where(eq(jobs.type, 'trials.close_submissions'));
    kit.clock.set(new Date(deadlineAt!.getTime() + 30 * MINUTE));
    await kit.drain(handlers);
    const warnings = await kit.db
      .select()
      .from(notifications)
      .where(eq(notifications.type, 'trial.deadline'));
    expect(warnings).toEqual([]);
    expect((await getTrialForStaff(kit.as(ops), { trialId })).status).toBe('active');
    expect(await sweepOverdueTrials(kit.system)).toEqual([trialId]);
    expect((await getTrialForStaff(kit.as(ops), { trialId })).status).toBe('evaluating');
    expect(await sweepOverdueTrials(kit.system)).toEqual([]);
  });

  it('BREAK: recruitment windows are enforced to the millisecond', async () => {
    const ops = await kit.member({ roles: ['operations'] });
    const [a, b] = await makeMembers(kit, 2);
    const closesAt = new Date(kit.clock.now().getTime() + 60 * MINUTE);
    await expect(
      openRecruitment(kit.as(ops), {
        trialId: (await createTrial(kit.as(ops), CUSTOM_TRIAL)).id,
        recruitmentClosesAt: new Date(kit.clock.now().getTime() - 1),
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    const trial = await createTrial(kit.as(ops), CUSTOM_TRIAL);
    await openRecruitment(kit.as(ops), { trialId: trial.id, recruitmentClosesAt: closesAt });
    kit.clock.set(new Date(closesAt.getTime() - 1));
    await applyToTrial(kit.as(a!), { trialId: trial.id, statement: STATEMENT });
    kit.clock.set(closesAt);
    await expect(
      applyToTrial(kit.as(b!), { trialId: trial.id, statement: STATEMENT }),
    ).rejects.toThrow('has closed');
  });

  it('BREAK: publishing before any evaluation is refused, then recorded as INCOMPLETE when acknowledged', async () => {
    const ops = await kit.member({ roles: ['operations'] });
    const [a, b, c, d] = await makeMembers(kit, 4);
    const { trialId, assignment } = await runningTrial(kit, ops, [a!, b!, c!, d!]);
    const [first, second] = assignment.teams;
    const memberOf = (team: typeof first) =>
      [a, b, c, d].find((m) => team!.memberIds.includes(m!.memberId!))!;
    await submit(kit.as(memberOf(first)), { trialId, summary: SUMMARY });
    await closeSubmissions(kit.as(ops), { trialId });

    // The team that never submitted cannot be scored.
    await expect(
      evaluate(kit.as(ops), { trialId, teamId: second!.id, scores: SCORES }),
    ).rejects.toThrow('never submitted');

    await expect(publishResults(kit.as(ops), { trialId })).rejects.toThrow('have no evaluation');
    const published = await publishResults(kit.as(ops), { trialId, acknowledgeIncomplete: true });
    expect(published.counts).toEqual({ distinction: 0, pass: 0, fail: 0, incomplete: 4 });
    const reasons = new Map(published.results.map((r) => [r.teamId, r.incompleteReason]));
    expect(reasons.get(first!.id)).toBe('not_evaluated');
    expect(reasons.get(second!.id)).toBe('no_submission');
    const passed = await kit.db
      .select()
      .from(domainEvents)
      .where(eq(domainEvents.type, 'trial.passed'));
    expect(passed).toEqual([]);
    const bodies = (
      await kit.db.select().from(notifications).where(eq(notifications.type, 'trial.result'))
    ).map((n) => n.body);
    expect(bodies.every((body) => body.includes('INCOMPLETE'))).toBe(true);
    expect(bodies.some((body) => body.includes('your team did not submit'))).toBe(true);
  });

  it('BREAK: withdrawing hands the lead over; empty teams block the start', async () => {
    const ops = await kit.member({ roles: ['operations'] });
    const [a, b, c] = await makeMembers(kit, 3);
    const trialId = await recruitingTrial(kit, ops, [a!, b!, c!]);
    await selectParticipants(kit.as(ops), {
      trialId,
      mode: 'manual',
      memberIds: [a!.memberId!, b!.memberId!, c!.memberId!],
    });
    const assignment = await assignTeams(kit.as(ops), {
      trialId,
      strategy: 'random',
      seed: 'lead',
      teamSize: 3,
    });
    const team = assignment.teams[0]!;
    const lead = [a, b, c].find((m) => m!.memberId === team.leadMemberId)!;
    await withdraw(kit.as(lead), { trialId });
    const staff = await getTrialForStaff(kit.as(ops), { trialId });
    const leads = staff.participants.filter((p) => p.teamRole === 'lead');
    expect(leads).toHaveLength(1);
    expect(leads[0]!.memberId).not.toBe(lead.memberId);
    await expect(withdraw(kit.as(lead), { trialId })).rejects.toBeInstanceOf(NotFoundError);

    for (const member of [a, b, c].filter((m) => m !== lead))
      await withdraw(kit.as(member!), { trialId });
    await expect(startTrial(kit.as(ops), { trialId })).rejects.toThrow('has no members');
  });

  it('BREAK: selection re-checks eligibility and respects maxParticipants', async () => {
    const ops = await kit.member({ roles: ['operations'] });
    const [a, b, c] = await makeMembers(kit, 3);
    const trialId = await recruitingTrial(kit, ops, [a!, b!, c!], { maxParticipants: 2 });
    await expect(
      selectParticipants(kit.as(ops), {
        trialId,
        mode: 'manual',
        memberIds: [a!.memberId!, b!.memberId!, c!.memberId!],
      }),
    ).rejects.toThrow('at most 2');
    // c loses the TRIAL role after applying: no longer selectable.
    const { revokeRoleUnchecked } = await import('../identity/roles.service');
    await revokeRoleUnchecked(kit.system, {
      memberId: c!.memberId!,
      role: 'trial',
      reason: 'test',
    });
    await expect(
      selectParticipants(kit.as(ops), { trialId, mode: 'manual', memberIds: [c!.memberId!] }),
    ).rejects.toThrow('not eligible');
    const random = await selectParticipants(kit.as(ops), { trialId, mode: 'random', count: 5 });
    expect(random.selectedMemberIds.sort()).toEqual([a!.memberId!, b!.memberId!].sort());
    expect(random.seed).toMatch(/^[0-9a-f]{24}$/);
    await expect(
      selectParticipants(kit.as(ops), {
        trialId,
        mode: 'manual',
        memberIds: ['00000000-0000-4000-8000-000000000999'],
      }),
    ).rejects.toThrow('not eligible');
    await expect(
      selectParticipants(kit.as(a!), { trialId, mode: 'random', count: 1 }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
