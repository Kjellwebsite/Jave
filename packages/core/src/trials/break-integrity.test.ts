import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { auditLogs, members, notifications, trialParticipants } from '@jave/database';
import { MINUTE } from '../kernel/clock';
import { ForbiddenError, NotFoundError, ValidationError } from '../kernel/errors';
import { createTestKit, type TestKit } from '../testing';
import * as publicApi from './index';
import {
  applyRankConsequence,
  assignTeams,
  cancelTrial,
  closeSubmissions,
  createTrial,
  evaluate,
  openRecruitment,
  publishResults,
  remainingTime,
  selectParticipants,
  submit,
  sweepOverdueTrials,
  updateTrial,
} from './index';
import { closeSubmissionsInternal, startTrialInternal } from './run.service';
import {
  configureDiscord,
  CUSTOM_TRIAL,
  members as makeMembers,
  PGLITE_HOOK_TIMEOUT_MS,
  PGLITE_SUITE,
  recruitingTrial,
  runningTrial,
} from './testing/fixtures';

const TOP_MARKS = { shipped: 9, value: 9 };
const SUMMARY = 'A working product, deployed, with real users.';

describe('trials: BREAK — integrity of the public surface and the roster', PGLITE_SUITE, () => {
  let kit: TestKit;
  beforeEach(async () => {
    kit = await createTestKit();
    await configureDiscord(kit);
  }, PGLITE_HOOK_TIMEOUT_MS);
  afterEach(async () => {
    await kit.close();
  }, PGLITE_HOOK_TIMEOUT_MS);

  it('BREAK: authorization-free internals are not public; automatic triggers refuse users', async () => {
    const exported = Object.keys(publicApi);
    for (const internal of [
      'startTrialInternal',
      'closeSubmissionsInternal',
      'loadTemplate',
      'assertFacetKeys',
    ])
      expect(exported).not.toContain(internal);

    const ops = await kit.member({ roles: ['operations'] });
    const [a] = await makeMembers(kit, 1);
    const { trialId } = await runningTrial(kit, ops, [a!]);
    kit.clock.advance(CUSTOM_TRIAL.durationMinutes! * MINUTE * 2);
    await expect(sweepOverdueTrials(kit.as(ops))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      closeSubmissionsInternal(kit.as(a!), trialId, { trigger: 'deadline' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      startTrialInternal(kit.as(a!), trialId, { trigger: 'scheduled' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    // Still active: nothing above moved it.
    expect(await sweepOverdueTrials(kit.system)).toEqual([trialId]);
  });

  it('BREAK: a rank consequence never exceeds what the trial measured', async () => {
    const ops = await kit.member({ roles: ['operations'] });
    const core = await kit.member({ roles: ['core'] });
    const [a, b] = await makeMembers(kit, 2);
    const { trialId, assignment } = await runningTrial(kit, ops, [a!, b!]);
    await submit(kit.as(a!), { trialId, summary: SUMMARY });
    await closeSubmissions(kit.as(ops), { trialId });
    await evaluate(kit.as(ops), { trialId, teamId: assignment.teams[0]!.id, scores: TOP_MARKS });
    const published = await publishResults(kit.as(ops), { trialId });
    expect(published.results[0]!.recommendedRank).toBe('A');

    await expect(
      applyRankConsequence(kit.as(core), { trialId, memberId: a!.memberId!, rank: 'S' }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      applyRankConsequence(kit.as(core), { trialId, memberId: a!.memberId!, rank: 'Z' }),
    ).rejects.toBeInstanceOf(ValidationError);
    // A more conservative rank is the evaluator's call.
    await expect(
      applyRankConsequence(kit.as(core), { trialId, memberId: b!.memberId!, rank: 'C' }),
    ).resolves.toMatchObject({ rank: 'C' });
  });

  it('BREAK: members who lost eligibility after selection are removed, not placed on a team', async () => {
    const ops = await kit.member({ roles: ['operations'] });
    const [a, b, c] = await makeMembers(kit, 3);
    const trialId = await recruitingTrial(kit, ops, [a!, b!, c!]);
    await selectParticipants(kit.as(ops), {
      trialId,
      mode: 'manual',
      memberIds: [a!.memberId!, b!.memberId!, c!.memberId!],
    });
    await kit.db
      .update(members)
      .set({ standing: 'quarantined' })
      .where(eq(members.id, c!.memberId!));

    const assignment = await assignTeams(kit.as(ops), { trialId, strategy: 'random', seed: 's' });
    expect(assignment.removed).toBe(1);
    expect(assignment.teams.flatMap((team) => team.memberIds).sort()).toEqual(
      [a!.memberId!, b!.memberId!].sort(),
    );
    const [removed] = await kit.db
      .select()
      .from(trialParticipants)
      .where(
        and(eq(trialParticipants.trialId, trialId), eq(trialParticipants.memberId, c!.memberId!)),
      );
    expect(removed).toMatchObject({ status: 'removed', teamId: null });
    const [notice] = await kit.db
      .select()
      .from(notifications)
      .where(eq(notifications.recipientUserId, c!.userId));
    expect(notice!.body).toContain('taken off the roster');
    const [audit] = await kit.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'trial.teams_assigned'));
    expect(audit!.context).toMatchObject({ removedIneligible: [c!.memberId] });

    // A reshuffle before the start re-checks too — selection is closed by then.
    await kit.db
      .update(members)
      .set({ guildStatus: 'departed' })
      .where(eq(members.id, b!.memberId!));
    const reshuffle = await assignTeams(kit.as(ops), { trialId, strategy: 'random', seed: 't' });
    expect(reshuffle.teams.flatMap((team) => team.memberIds)).toEqual([a!.memberId!]);
    await kit.db
      .update(members)
      .set({ guildStatus: 'departed' })
      .where(eq(members.id, a!.memberId!));
    await expect(
      assignTeams(kit.as(ops), { trialId, strategy: 'random', seed: 'u' }),
    ).rejects.toThrow('is still eligible');
    // The refused reshuffle rolled back: the previous team is intact.
    const [kept] = await kit.db
      .select()
      .from(trialParticipants)
      .where(
        and(eq(trialParticipants.trialId, trialId), eq(trialParticipants.memberId, a!.memberId!)),
      );
    expect(kept).toMatchObject({ status: 'selected', teamId: reshuffle.teams[0]!.id });
  });

  it('BREAK: IDOR — countdowns follow the member view: no drafts, no foreign cancelled trials', async () => {
    const ops = await kit.member({ roles: ['operations'] });
    const [applicant, outsider] = await makeMembers(kit, 2);
    const draft = await createTrial(kit.as(ops), CUSTOM_TRIAL);
    await expect(remainingTime(kit.as(outsider!), { trialId: draft.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(remainingTime(kit.as(ops), { trialId: draft.id })).resolves.toMatchObject({
      phase: 'not_started',
    });

    const trialId = await recruitingTrial(kit, ops, [applicant!]);
    await expect(remainingTime(kit.as(outsider!), { trialId })).resolves.toBeTruthy();
    await cancelTrial(kit.as(ops), { trialId, reason: 'Brief leaked before the start.' });
    await expect(remainingTime(kit.as(outsider!), { trialId })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(remainingTime(kit.as(applicant!), { trialId })).resolves.toMatchObject({
      phase: 'closed',
    });
  });

  it('BREAK: schedules, capacity and the public summary are validated', async () => {
    const ops = await kit.member({ roles: ['operations'] });
    const now = kit.clock.now().getTime();
    const closes = new Date(now + 120 * MINUTE);
    const early = new Date(now + 60 * MINUTE);
    await expect(
      createTrial(kit.as(ops), {
        ...CUSTOM_TRIAL,
        recruitmentClosesAt: closes,
        scheduledStartAt: early,
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    const trial = await createTrial(kit.as(ops), { ...CUSTOM_TRIAL, scheduledStartAt: early });
    await expect(
      updateTrial(kit.as(ops), { trialId: trial.id, recruitmentClosesAt: closes }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      openRecruitment(kit.as(ops), { trialId: trial.id, recruitmentClosesAt: closes }),
    ).rejects.toBeInstanceOf(ValidationError);

    const silent = await createTrial(kit.as(ops), { ...CUSTOM_TRIAL, summary: '' });
    await expect(openRecruitment(kit.as(ops), { trialId: silent.id })).rejects.toThrow(
      'public summary',
    );

    const [a, b] = await makeMembers(kit, 2);
    const trialId = await recruitingTrial(kit, ops, [a!, b!]);
    await selectParticipants(kit.as(ops), {
      trialId,
      mode: 'manual',
      memberIds: [a!.memberId!, b!.memberId!],
    });
    await expect(updateTrial(kit.as(ops), { trialId, maxParticipants: 1 })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(updateTrial(kit.as(ops), { trialId, maxParticipants: 2 })).resolves.toMatchObject({
      maxParticipants: 2,
    });
  });
});
