import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { members, referrals } from '@jave/database';
import { createTestKit, type TestKit } from '../testing';
import { DAY, HOUR, MINUTE } from '../kernel/clock';
import {
  DisabledError,
  ForbiddenError,
  UnauthenticatedError,
  ValidationError,
} from '../kernel/errors';
import { anonymousActor, type UserActor } from '../permissions/actor';
import { updateSettings } from '../settings/settings.service';
import { resolveUserActor } from '../identity/users.service';
import { getServerOverview } from './overview.service';
import { SLOW_DATABASE_TIMEOUTS } from '../invites/test-support';
import { fixtures } from './test-fixtures';

const NOW = new Date('2026-06-30T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);

vi.setConfig(SLOW_DATABASE_TIMEOUTS);

describe('analytics: server overview', () => {
  let kit: TestKit;
  let ops: UserActor;
  let seed: ReturnType<typeof fixtures>;

  beforeEach(async () => {
    kit = await createTestKit();
    kit.clock.set(NOW);
    ops = await kit.member({ roles: ['operations'] });
    seed = fixtures(kit);
  });
  afterEach(async () => {
    await kit.close();
  });

  const user = async () => (await kit.member()).userId;
  const member = async () => (await kit.member()).memberId!;

  it('computes joins, leaves, net and D7/D30 retention cohorts', async () => {
    // D7 cohort window for a 7-day range: [now-14d, now-7d).
    const u1 = await user();
    const u2 = await user();
    const u3 = await user();
    await seed.guildEvent(u1, 'join', ago(10 * DAY)); // stays
    await seed.guildEvent(u2, 'join', ago(10 * DAY));
    await seed.guildEvent(u2, 'leave', ago(8 * DAY)); // left within 7d
    await seed.guildEvent(u3, 'join', ago(12 * DAY));
    await seed.guildEvent(u3, 'leave', ago(4 * DAY)); // left after 8d: retained at D7
    // D30 cohort window: [now-37d, now-30d).
    const u6 = await user();
    const u7 = await user();
    await seed.guildEvent(u6, 'join', ago(35 * DAY));
    await seed.guildEvent(u6, 'leave', ago(20 * DAY)); // left after 15d
    await seed.guildEvent(u7, 'join', ago(33 * DAY)); // stays
    // Inside the 7-day range.
    const u4 = await user();
    const u8 = await user();
    await seed.guildEvent(u4, 'join', ago(3 * DAY));
    await seed.guildEvent(u8, 'join', ago(DAY));
    // Outside every window.
    await seed.guildEvent(await user(), 'join', ago(20 * DAY));

    const overview = await getServerOverview(kit.as(ops), { rangeDays: 7 });
    expect(overview.members).toMatchObject({ joins: 2, leaves: 1, net: 1 });
    expect(overview.members.retention.d7).toMatchObject({ cohort: 3, retained: 2, rate: 0.6667 });
    expect(overview.members.retention.d30).toMatchObject({ cohort: 2, retained: 1, rate: 0.5 });
    expect(overview.members.retention.d7.window.end.toISOString()).toBe(ago(7 * DAY).toISOString());
    expect(overview.members.present).toBe(9); // ops + 8 seeded users
  });

  it('boundary: an event exactly at the range start counts, one at the end does not', async () => {
    const u = await user();
    await seed.guildEvent(u, 'join', ago(7 * DAY));
    const v = await user();
    await seed.guildEvent(v, 'join', NOW);
    const overview = await getServerOverview(kit.as(ops), { rangeDays: 7 });
    expect(overview.members.joins).toBe(1);
  });

  it('empty cohorts report null rates, never NaN', async () => {
    const overview = await getServerOverview(kit.as(ops), { rangeDays: 30 });
    expect(overview.members.retention.d7).toMatchObject({ cohort: 0, rate: null });
    expect(overview.applications.acceptanceRate).toBeNull();
    expect(overview.applications.medianHoursToDecision).toBeNull();
    expect(overview.trials.passRate).toBeNull();
    expect(overview.tickets.slaBreachRate).toBeNull();
    expect(overview.tickets.medianFirstResponseMinutes).toBeNull();
  });

  it('summarizes applications: status, acceptance rate, median time to decision', async () => {
    await seed.application(await user(), 'accepted', {
      submittedAt: ago(5 * DAY),
      decidedAt: ago(3 * DAY),
    });
    await seed.application(await user(), 'rejected', {
      submittedAt: ago(6 * DAY),
      decidedAt: ago(2 * DAY),
    });
    await seed.application(await user(), 'review', { submittedAt: ago(2 * DAY) });
    await seed.application(await user(), 'accepted', {
      submittedAt: ago(40 * DAY),
      decidedAt: ago(35 * DAY),
    });
    await seed.application(await user(), 'draft');
    const { applications } = await getServerOverview(kit.as(ops), { rangeDays: 7 });
    expect(applications.byStatus).toMatchObject({
      accepted: 2,
      rejected: 1,
      review: 1,
      draft: 1,
      interview: 0,
    });
    expect(applications).toMatchObject({
      pending: 1,
      submitted: 3,
      accepted: 1,
      rejected: 1,
      acceptanceRate: 0.5,
      medianHoursToDecision: 72,
    });
  });

  it('summarizes trials, missions, projects and contributions inside the range', async () => {
    const m1 = await member();
    const m2 = await member();
    const m3 = await member();
    const t1 = await seed.trial('completed', ago(2 * DAY));
    await seed.trial('active');
    const t3 = await seed.trial('completed', ago(50 * DAY));
    await seed.trialResult(t1, m1, 'pass', ago(2 * DAY));
    await seed.trialResult(t1, m2, 'distinction', ago(2 * DAY));
    await seed.trialResult(t1, m3, 'fail', ago(2 * DAY));
    await seed.trialResult(t3, m1, 'pass', ago(50 * DAY));
    const mission = await seed.mission('open');
    await seed.assignment(mission, m1, 'verified', ago(DAY));
    await seed.assignment(mission, m2, 'verified', ago(30 * DAY));
    await seed.assignment(mission, m3, 'submitted', null);
    await seed.project(m1, 'shipped', { shippedAt: ago(3 * DAY) });
    await seed.project(m1, 'building');
    await seed.project(m2, 'shipped', { shippedAt: ago(60 * DAY) });
    await seed.project(m3, 'shipped', { shippedAt: ago(DAY), deletedAt: ago(HOUR) });
    await seed.contribution(m1, 'verified', ago(DAY));
    await seed.contribution(m1, 'verified', ago(10 * DAY));
    await seed.contribution(m2, 'submitted', null);

    const overview = await getServerOverview(kit.as(ops), { rangeDays: 7 });
    expect(overview.trials).toMatchObject({
      active: 1,
      completed: 1,
      resultsPublished: 3,
      passed: 2,
      passRate: 0.6667,
    });
    expect(overview.missions).toEqual({ open: 1, completed: 1 });
    expect(overview.projects.byStatus).toMatchObject({ shipped: 2, building: 1 });
    expect(overview.projects.shipped).toBe(1);
    expect(overview.contributions.verified).toBe(1);
  });

  it('computes ticket first-response median and SLA breach rate', async () => {
    const opener = await user();
    const created = (d: number) => ago(d * DAY);
    await seed.ticket(opener, {
      createdAt: created(5),
      status: 'closed',
      slaDueAt: new Date(created(5).getTime() + HOUR),
      firstResponseAt: new Date(created(5).getTime() + 30 * MINUTE),
    });
    await seed.ticket(opener, {
      createdAt: created(4),
      status: 'claimed',
      slaDueAt: new Date(created(4).getTime() + HOUR),
      firstResponseAt: new Date(created(4).getTime() + 90 * MINUTE),
    });
    await seed.ticket(opener, {
      createdAt: created(3),
      slaDueAt: new Date(created(3).getTime() + HOUR),
    });
    await seed.ticket(opener, {
      createdAt: ago(HOUR),
      slaDueAt: new Date(NOW.getTime() + 59 * MINUTE),
    });
    await seed.ticket(opener, { createdAt: created(20), status: 'closed' });

    const { tickets } = await getServerOverview(kit.as(ops), { rangeDays: 7 });
    expect(tickets).toEqual({
      open: 3,
      opened: 4,
      medianFirstResponseMinutes: 60,
      slaTracked: 3,
      slaBreached: 2,
      slaBreachRate: 0.6667,
    });
  });

  it('breaks down moderation cases by action and security events by trigger', async () => {
    const target = await user();
    await seed.modCase(target, 'warn', ago(DAY));
    await seed.modCase(target, 'warn', ago(2 * DAY));
    await seed.modCase(target, 'timeout', ago(3 * DAY));
    await seed.modCase(target, 'ban', ago(30 * DAY));
    await seed.securityEvent('spam_rate', ago(DAY));
    await seed.securityEvent('spam_rate', ago(2 * DAY));
    await seed.securityEvent('join_burst', ago(40 * DAY));
    const { moderation } = await getServerOverview(kit.as(ops), { rangeDays: 7 });
    expect(moderation.casesByAction).toMatchObject({ warn: 2, timeout: 1, ban: 0, kick: 0 });
    expect(moderation.securityEventsByTrigger).toMatchObject({ spam_rate: 2, join_burst: 0 });
    const wide = await getServerOverview(kit.as(ops), { rangeDays: 90 });
    expect(wide.moderation.casesByAction.ban).toBe(1);
    expect(wide.moderation.securityEventsByTrigger.join_burst).toBe(1);
  });

  it('counts referrals attributed and validated in range', async () => {
    const invitee = await user();
    const other = await user();
    await kit.db.insert(referrals).values([
      {
        inviteeUserId: invitee,
        method: 'unknown',
        status: 'valid',
        joinedAt: ago(20 * DAY),
        validatedAt: ago(DAY),
      },
      { inviteeUserId: other, method: 'unknown', status: 'joined', joinedAt: ago(2 * DAY) },
    ]);
    const overview = await getServerOverview(kit.as(ops), { rangeDays: 7 });
    expect(overview.referrals).toEqual({ attributed: 1, validated: 1 });
  });

  it('excludes departed and deleted members from the present count', async () => {
    const before = (await getServerOverview(kit.as(ops))).members.present;
    const gone = await kit.member();
    await kit.db
      .update(members)
      .set({ guildStatus: 'departed' })
      .where(eq(members.id, gone.memberId!));
    const deleted = await kit.member();
    await kit.db.update(members).set({ deletedAt: NOW }).where(eq(members.id, deleted.memberId!));
    expect((await getServerOverview(kit.as(ops))).members.present).toBe(before);
  });

  it('BREAK: non-staff, moderators, anonymous and restricted staff cannot read analytics', async () => {
    const plain = await kit.member({ roles: ['verified'] });
    const mod = await kit.member({ roles: ['moderator'] });
    await expect(getServerOverview(kit.as(plain))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getServerOverview(kit.as(mod))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getServerOverview(kit.as(anonymousActor))).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    const restricted = await kit.member({ roles: ['core'] });
    await kit.db
      .update(members)
      .set({ standing: 'restricted' })
      .where(eq(members.id, restricted.memberId!));
    const demoted = await resolveUserActor(kit.system, restricted.userId);
    await expect(getServerOverview(kit.as(demoted))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('BREAK: only 7, 30 or 90 day ranges are accepted', async () => {
    for (const rangeDays of [0, 8, 365, -7, 1e9, '30; drop table members']) {
      await expect(
        getServerOverview(kit.as(ops), { rangeDays: rangeDays as 30 }),
      ).rejects.toBeInstanceOf(ValidationError);
    }
  });

  it('respects the analytics kill switch', async () => {
    const founder = await kit.member({ roles: ['founder'] });
    await updateSettings(kit.as(founder), 'analytics', { enabled: false });
    await expect(getServerOverview(kit.as(ops))).rejects.toBeInstanceOf(DisabledError);
  });
});
