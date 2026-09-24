import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { analyticsSnapshots } from '@jave/database';
import { createTestKit, type TestKit } from '../testing';
import { DAY, HOUR } from '../kernel/clock';
import { ForbiddenError, ValidationError } from '../kernel/errors';
import { enqueueJob, enqueueRecurring } from '../jobs/queue';
import type { UserActor } from '../permissions/actor';
import { updateSettings } from '../settings/settings.service';
import { ANALYTICS_METRIC_KEYS } from './metrics';
import { getTimeSeries, runAnalyticsSnapshot, SNAPSHOT_BACKFILL_DAYS } from './snapshots.service';
import { SLOW_DATABASE_TIMEOUTS } from '../invites/test-support';
import { fixtures } from './test-fixtures';
import { ANALYTICS_SNAPSHOT_JOB, jobHandlers, recurringJobs } from './index';

const NOW = new Date('2026-06-30T00:05:00.000Z');
const YESTERDAY = '2026-06-29';

vi.setConfig(SLOW_DATABASE_TIMEOUTS);

describe('analytics: daily snapshots and time series', () => {
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

  async function runJob(payload: Record<string, unknown> = {}) {
    await enqueueJob(kit.system, ANALYTICS_SNAPSHOT_JOB, payload);
    const outcomes = await kit.drain(jobHandlers);
    const run = outcomes.find((o) => o.type === ANALYTICS_SNAPSHOT_JOB)!;
    return run;
  }

  async function value(day: string, metric: string, dimension = '') {
    const [row] = await kit.db
      .select({ value: analyticsSnapshots.value })
      .from(analyticsSnapshots)
      .where(
        and(
          eq(analyticsSnapshots.day, day),
          eq(analyticsSnapshots.metric, metric),
          eq(analyticsSnapshots.dimension, dimension),
        ),
      );
    return row?.value ?? null;
  }

  it('registers a daily recurring job that runs once per day bucket', async () => {
    expect(recurringJobs).toEqual([{ type: ANALYTICS_SNAPSHOT_JOB, everyMs: DAY }]);
    expect(await enqueueRecurring(kit.system, ANALYTICS_SNAPSHOT_JOB, DAY)).not.toBeNull();
    expect(await enqueueRecurring(kit.system, ANALYTICS_SNAPSHOT_JOB, DAY)).toBeNull();
  });

  it('captures yesterday’s flows and current gauges, idempotently', async () => {
    const u = (await kit.member()).userId;
    const v = (await kit.member()).userId;
    await seed.guildEvent(u, 'join', new Date('2026-06-29T08:00:00Z'));
    await seed.guildEvent(v, 'join', new Date('2026-06-29T23:59:59Z'));
    await seed.guildEvent(v, 'leave', new Date('2026-06-30T00:01:00Z')); // today: not yesterday
    await seed.modCase(u, 'warn', new Date('2026-06-29T10:00:00Z'));

    const first = await runJob();
    expect(first.status).toBe('completed');
    expect(first.result).toMatchObject({ skipped: false, day: YESTERDAY });
    expect(await value(YESTERDAY, 'members.joins')).toBe(2);
    expect(await value(YESTERDAY, 'members.leaves')).toBe(0);
    expect(await value(YESTERDAY, 'members.present')).toBe(3);
    expect(await value(YESTERDAY, 'moderation.cases', 'warn')).toBe(1);
    expect(await value(YESTERDAY, 'moderation.cases', 'ban')).toBe(0);
    expect(await value(YESTERDAY, 'members.by_role', 'member')).toBe(3);
    const rowsAfterFirst = (await kit.db.select().from(analyticsSnapshots)).length;

    await seed.guildEvent((await kit.member()).userId, 'join', new Date('2026-06-29T12:00:00Z'));
    kit.clock.advance(HOUR);
    await runJob();
    expect(await value(YESTERDAY, 'members.joins')).toBe(3);
    expect((await kit.db.select().from(analyticsSnapshots)).length).toBe(rowsAfterFirst);
  });

  it('backfills flows (not gauges) for missed days', async () => {
    const u = (await kit.member()).userId;
    await seed.guildEvent(u, 'join', new Date('2026-06-25T09:00:00Z'));
    const run = await runJob();
    expect(run.result!.backfilled).toHaveLength(SNAPSHOT_BACKFILL_DAYS);
    expect(await value('2026-06-25', 'members.joins')).toBe(1);
    expect(await value('2026-06-25', 'members.present')).toBeNull();
    const again = await runJob();
    expect(again.result!.backfilled).toEqual([]);
  });

  it('serves a gap-aware time series, with dimension totals', async () => {
    const u = (await kit.member()).userId;
    await seed.modCase(u, 'warn', new Date('2026-06-29T10:00:00Z'));
    await seed.modCase(u, 'timeout', new Date('2026-06-29T11:00:00Z'));
    await runJob();
    const joins = await getTimeSeries(kit.as(ops), { metric: 'members.joins', rangeDays: 30 });
    expect(joins.points).toHaveLength(30);
    expect(joins.points.at(-1)).toEqual({ day: YESTERDAY, value: 0 });
    expect(joins.points[0]).toEqual({ day: '2026-05-31', value: null });
    expect(joins.kind).toBe('flow');
    const total = await getTimeSeries(kit.as(ops), { metric: 'moderation.cases', rangeDays: 7 });
    expect(total.points.at(-1)!.value).toBe(2);
    const warns = await getTimeSeries(kit.as(ops), {
      metric: 'moderation.cases',
      rangeDays: 7,
      dimension: 'warn',
    });
    expect(warns.points.at(-1)!.value).toBe(1);
  });

  it('recomputes a chosen past day on request (flows only)', async () => {
    const u = (await kit.member()).userId;
    await seed.guildEvent(u, 'join', new Date('2026-06-10T09:00:00Z'));
    const run = await runJob({ day: '2026-06-10' });
    expect(run.result).toMatchObject({ day: '2026-06-10', backfilled: [] });
    expect(await value('2026-06-10', 'members.joins')).toBe(1);
    expect(await value('2026-06-10', 'members.present')).toBeNull();
  });

  it('BREAK: snapshot days must be completed, real calendar days within a year', async () => {
    for (const day of [
      '2026-06-30',
      '2026-07-01',
      '2026-02-30',
      '2024-01-01',
      '../../x',
      '2026-6-1',
    ]) {
      await expect(runAnalyticsSnapshot(kit.system, { day })).rejects.toBeInstanceOf(
        ValidationError,
      );
    }
    const failed = await runJob({ day: 'not-a-day' });
    expect(failed.status).toBe('dead');
  });

  it('BREAK: only the system runs snapshots; only staff read series; input is validated', async () => {
    const founder = await kit.member({ roles: ['founder'] });
    await expect(runAnalyticsSnapshot(kit.as(founder))).rejects.toBeInstanceOf(ForbiddenError);
    const member = await kit.member();
    await expect(
      getTimeSeries(kit.as(member), { metric: 'members.joins', rangeDays: 7 }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      getTimeSeries(kit.as(ops), { metric: 'messages.sent' as 'members.joins', rangeDays: 7 }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      getTimeSeries(kit.as(ops), { metric: 'members.joins', rangeDays: 3650 as 365 }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      getTimeSeries(kit.as(ops), { metric: 'members.joins', rangeDays: 7, dimension: 'warn' }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      getTimeSeries(kit.as(ops), {
        metric: 'moderation.cases',
        rangeDays: 7,
        dimension: "warn' or '1'='1",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('the kill switch skips snapshots', async () => {
    const founder = await kit.member({ roles: ['founder'] });
    await updateSettings(kit.as(founder), 'analytics', { enabled: false });
    const run = await runJob();
    expect(run.result).toMatchObject({ skipped: true });
    expect(await kit.db.select().from(analyticsSnapshots)).toHaveLength(0);
  });

  it('the metric catalog never tracks Discord activity as a metric', () => {
    for (const metric of ANALYTICS_METRIC_KEYS) {
      expect(metric).not.toMatch(/message|voice|reaction|xp|activity/);
    }
  });
});
