import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  calendar,
  claimRank,
  DAY,
  HOUR,
  missions,
  setVerifiedRank,
  trials,
  type UserActor,
} from '@jave/core';
import { createTestKit, type TestKit } from '@jave/core/testing';
import { members as membersTable, trials as trialsTable } from '@jave/database';
import type { ActivityErrorBody, MissionControlResponse } from '../contract';
import { apiRequest, readJson, testDeps, tokenFor } from '../testing/support';
import { ACTIVITY_TOKEN_TTL_MS } from '../token';
import { handleMissionControl } from './mission-control';

let kit: TestKit;

beforeEach(async () => {
  kit = await createTestKit();
});

afterEach(async () => {
  await kit.close();
});

const TRIAL_KEYS = [
  'category',
  'closesAt',
  'deadlineAt',
  'phase',
  'ref',
  'scheduledStartAt',
  'status',
  'teamName',
  'title',
].sort();

async function missionControl(token: string | undefined, deps = testDeps(kit)) {
  return handleMissionControl(apiRequest('GET', '/me', { token }), deps);
}

/** A member with a claim, a verified rank, an active mission, a running trial and an event. */
async function seedMember(): Promise<{ member: UserActor; teammate: UserActor }> {
  const founder = await kit.member({ roles: ['founder'] });
  const operations = await kit.member({ roles: ['operations'] });
  const member = await kit.member({ roles: ['trial'], username: 'mara' });
  const teammate = await kit.member({ roles: ['trial'] });

  await claimRank(kit.as(member), { facetKey: 'create.projects', rank: 'B' });
  await claimRank(kit.as(member), { facetKey: 'mind.reasoning', rank: 'A' });
  await setVerifiedRank(kit.as(founder), {
    memberId: member.memberId!,
    facetKey: 'mind.reasoning',
    rank: 'B',
    reason: 'Demonstrated in a proctored session.',
  });

  const draft = await missions.createMission(kit.as(operations), {
    title: 'Prototype sprint',
    brief: 'Ship a working prototype and document what you learned.',
    type: 'build',
    evidenceRequired: false,
    durationHours: 72,
  });
  await missions.publishMission(kit.as(operations), { missionId: draft.id, announce: false });
  await missions.assignMission(kit.as(operations), {
    missionId: draft.id,
    memberIds: [member.memberId!],
  });

  const trial = await trials.createTrial(kit.as(operations), {
    title: 'Night Build',
    category: 'build',
    summary: 'Build something that works before sunrise.',
    brief: 'MISSION\nShip a working tool for a real user before the deadline.',
    rubric: [
      { key: 'shipped', label: 'Working product', weight: 3 },
      { key: 'value', label: 'User value', weight: 1 },
    ],
    facetKeys: ['create.projects'],
    durationMinutes: 120,
    teamSize: 2,
  });
  await trials.openRecruitment(kit.as(operations), { trialId: trial.id });
  const statement = 'I ship working software under pressure and I want to prove it here.';
  for (const actor of [member, teammate]) {
    await trials.applyToTrial(kit.as(actor), { trialId: trial.id, statement });
  }
  await trials.selectParticipants(kit.as(operations), {
    trialId: trial.id,
    mode: 'manual',
    memberIds: [member.memberId!, teammate.memberId!],
  });
  await trials.assignTeams(kit.as(operations), {
    trialId: trial.id,
    strategy: 'random',
    seed: 'x',
  });
  await trials.startTrial(kit.as(operations), { trialId: trial.id });
  // Hidden from participants: must never surface in the Activity.
  await kit.db
    .update(trialsTable)
    .set({ adversarialEnabled: true })
    .where(eq(trialsTable.id, trial.id));

  await calendar.scheduleEvent(kit.as(operations), {
    title: 'Build night',
    kind: 'workshop',
    startsAt: new Date(kit.clock.now().getTime() + DAY),
    location: 'Lab 3, Berlin',
  });
  await calendar.scheduleEvent(kit.as(operations), {
    title: 'Demo day',
    kind: 'talk',
    startsAt: new Date(kit.clock.now().getTime() + 2 * DAY),
    location: 'https://meet.example.com/demo?token=secret',
  });
  return { member, teammate };
}

describe('GET /api/activity/me', () => {
  it('returns the caller’s ranks, missions, running trial and next events', async () => {
    const { member } = await seedMember();
    const response = await missionControl(tokenFor(kit, member));
    expect(response.status).toBe(200);
    const body = await readJson<MissionControlResponse>(response);
    expect(body.serverNow).toBe(kit.clock.now().getTime());
    expect(body.canHostGames).toBe(true);

    const mind = body.profile!.domains.find((d) => d.key === 'mind')!;
    expect(mind).toMatchObject({ verifiedRank: 'B', claimedRank: 'A', status: 'verified' });
    const create = body.profile!.domains.find((d) => d.key === 'create')!;
    expect(create).toMatchObject({ verifiedRank: null, claimedRank: 'B', status: 'claimed' });
    const body_ = body.profile!.domains.find((d) => d.key === 'body')!;
    expect(body_.status).toBe('unknown');

    expect(body.missions).toHaveLength(1);
    expect(body.missions[0]).toMatchObject({ title: 'Prototype sprint', status: 'assigned' });
    expect(body.missions[0]!.dueAt).toBe(kit.clock.now().getTime() + 72 * HOUR);

    expect(body.trial).toMatchObject({ title: 'Night Build', status: 'active', phase: 'open' });
    expect(body.trial!.deadlineAt).toBe(kit.clock.now().getTime() + 2 * HOUR);
    expect(Object.keys(body.trial!).sort()).toEqual(TRIAL_KEYS);

    expect(body.events.map((e) => e.title)).toEqual(['Build night', 'Demo day']);
    expect(body.events[0]!.location).toEqual({ kind: 'text', label: 'Lab 3, Berlin' });
    // Links are reduced to their host: no path, no query string, nothing clickable.
    expect(body.events[1]!.location).toEqual({ kind: 'url', label: 'meet.example.com' });
  });

  it('BREAK: never carries adversarial, staff-only or account data', async () => {
    const { member } = await seedMember();
    const raw = await (await missionControl(tokenFor(kit, member))).text();
    for (const forbidden of [
      'adversarial',
      'Adversarial',
      'standing',
      'discordId',
      member.discordId,
      member.userId,
      'seed',
      'brief',
      'rubric',
      'token=secret',
    ]) {
      expect(raw, forbidden).not.toContain(forbidden);
    }
  });

  it('shows an empty Mission Control to an account without a JAVELIN profile', async () => {
    const outsider = await kit.member({ inGuild: false });
    await kit.db
      .update(membersTable)
      .set({ deletedAt: kit.clock.now() })
      .where(eq(membersTable.id, outsider.memberId!));
    const body = await readJson<MissionControlResponse>(
      await missionControl(tokenFor(kit, outsider)),
    );
    expect(body).toMatchObject({ profile: null, missions: [], trial: null, events: [] });
    expect(body.canHostGames).toBe(false);
  });

  it('BREAK: missing, forged, foreign-secret and expired tokens are 401', async () => {
    const member = await kit.member({ roles: ['member'] });
    const valid = tokenFor(kit, member);
    const cases = [
      undefined,
      'garbage',
      `${valid}x`,
      tokenFor(kit, member, { secret: 'another-secret-another-secret-another-01' }),
    ];
    for (const token of cases) {
      const response = await missionControl(token);
      expect(response.status, String(token).slice(0, 12)).toBe(401);
      expect((await readJson<ActivityErrorBody>(response)).error.code).toBe('UNAUTHENTICATED');
    }
    const wrongScheme = await handleMissionControl(
      apiRequest('GET', '/me', { headers: { authorization: `Basic ${valid}` } }),
      testDeps(kit),
    );
    expect(wrongScheme.status).toBe(401);
    kit.clock.advance(ACTIVITY_TOKEN_TTL_MS);
    expect((await missionControl(valid)).status).toBe(401);
  });

  it('BREAK: a banned member cannot host games', async () => {
    const member = await kit.member({ roles: ['verified'] });
    await kit.db
      .update(membersTable)
      .set({ standing: 'banned' })
      .where(eq(membersTable.id, member.memberId!));
    const body = await readJson<MissionControlResponse>(
      await missionControl(tokenFor(kit, member)),
    );
    expect(body.canHostGames).toBe(false);
  });

  it('BREAK: unexpected failures return only an error reference', async () => {
    const member = await kit.member({ roles: ['member'] });
    const token = tokenFor(kit, member);
    const broken = testDeps(kit, {
      context: () => {
        const ctx = kit.as({ kind: 'anonymous' });
        return {
          ...ctx,
          rootDb: new Proxy(ctx.rootDb, {
            get() {
              throw new Error('connection refused at 10.0.0.5:5432 password=hunter2');
            },
          }),
        };
      },
    });
    const response = await missionControl(token, broken);
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).toMatch(/E-[0-9A-Z]{8}/);
    expect(text).not.toContain('hunter2');
    expect(text).not.toContain('10.0.0.5');
  });
});
