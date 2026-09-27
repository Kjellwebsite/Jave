import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { auditLogs, domainEvents, jobs, rateLimitBuckets, sessions } from '@jave/database';
import { DAY } from '../kernel/clock';
import { cappedCount } from '../kernel/pagination';
import { createTestKit, type TestKit } from '../testing';
import { coreJobHandlers, coreRecurringJobs } from '../registry';
import { HOUSEKEEPING_JOB, pruneOperationalData, RETENTION_DAYS } from './index';

describe('housekeeping: retention', () => {
  let kit: TestKit;
  beforeEach(async () => {
    kit = await createTestKit();
  });
  afterEach(async () => {
    await kit.close();
  });

  const ago = (days: number) => new Date(kit.clock.now().getTime() - days * DAY);

  it('prunes finished operational rows past retention and nothing else', async () => {
    const user = await kit.member();
    const old = ago(RETENTION_DAYS.deliveryLogs + 1);
    await kit.db.insert(jobs).values([
      { type: 't.old', status: 'completed', completedAt: ago(RETENTION_DAYS.completedJobs + 1) },
      { type: 't.recent', status: 'completed', completedAt: ago(RETENTION_DAYS.completedJobs - 1) },
      {
        type: 't.cancelled',
        status: 'cancelled',
        completedAt: ago(RETENTION_DAYS.completedJobs + 1),
      },
      { type: 't.dead-old', status: 'dead', completedAt: ago(RETENTION_DAYS.deadJobs + 1) },
      { type: 't.dead-recent', status: 'dead', completedAt: ago(RETENTION_DAYS.completedJobs + 1) },
      // Live work is never touched, however old.
      { type: 't.pending', status: 'pending', runAt: old, createdAt: old },
      { type: 't.running', status: 'running', runAt: old, createdAt: old, lockedAt: old },
    ]);
    await kit.db.insert(sessions).values([
      {
        userId: user.userId,
        tokenHash: 'a'.repeat(64),
        expiresAt: ago(RETENTION_DAYS.endedSessions + 1),
      },
      {
        userId: user.userId,
        tokenHash: 'b'.repeat(64),
        expiresAt: ago(-10),
        revokedAt: ago(RETENTION_DAYS.endedSessions + 1),
      },
      { userId: user.userId, tokenHash: 'c'.repeat(64), expiresAt: ago(-10) },
    ]);
    await kit.db.insert(rateLimitBuckets).values([
      { key: 'old', windowStart: ago(RETENTION_DAYS.rateLimitBuckets + 1), count: 3 },
      { key: 'live', windowStart: ago(0), count: 3 },
    ]);
    // The organization's record stays, whatever its age.
    await kit.db.insert(auditLogs).values({ actorType: 'system', action: 'x.old', createdAt: old });
    await kit.db
      .insert(domainEvents)
      .values({ type: 'x.old', aggregateType: 'x', aggregateId: '1', occurredAt: old });

    const report = await pruneOperationalData(kit.system);
    expect(report).toMatchObject({
      completedJobs: 2,
      deadJobs: 1,
      endedSessions: 2,
      rateLimitBuckets: 1,
    });
    const left = (await kit.db.select({ type: jobs.type }).from(jobs)).map((j) => j.type).sort();
    expect(left).toEqual(['t.dead-recent', 't.pending', 't.recent', 't.running']);
    expect(await kit.db.select().from(sessions)).toHaveLength(1);
    expect(await kit.db.select().from(rateLimitBuckets)).toHaveLength(1);
    expect(await kit.db.select().from(auditLogs).where(eq(auditLogs.action, 'x.old'))).toHaveLength(
      1,
    );
    expect(await kit.db.select().from(domainEvents)).toHaveLength(1);
    // Idempotent.
    expect(Object.values(await pruneOperationalData(kit.system)).every((n) => n === 0)).toBe(true);
  });

  it('runs daily through the core registry', async () => {
    expect(coreRecurringJobs).toContainEqual({ type: HOUSEKEEPING_JOB, everyMs: DAY });
    expect(coreJobHandlers()[HOUSEKEEPING_JOB]).toBeTypeOf('function');
  });

  it('capped counts are exact below the cap and extend with the offset', async () => {
    await kit.database.exec(
      "insert into audit_logs (actor_type, action) select 'system', 'x.bulk' from generate_series(1, 25)",
    );
    const where = eq(auditLogs.action, 'x.bulk');
    expect(await cappedCount(kit.db, auditLogs, where, { cap: 50 })).toEqual({
      total: 25,
      capped: false,
    });
    expect(await cappedCount(kit.db, auditLogs, where, { cap: 10 })).toEqual({
      total: 10,
      capped: true,
    });
    expect(await cappedCount(kit.db, auditLogs, where, { cap: 10, offset: 10 })).toEqual({
      total: 20,
      capped: true,
    });
    expect(await cappedCount(kit.db, auditLogs, where, { cap: 10, offset: 20 })).toEqual({
      total: 25,
      capped: false,
    });
  });
});
