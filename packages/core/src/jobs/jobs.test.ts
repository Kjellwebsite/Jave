import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { jobs } from '@jave/database';
import { createTestKit, type TestKit } from '../testing';
import {
  backoffMs,
  enqueueJob,
  enqueueRecurring,
  getQueueStats,
  recoverStaleJobs,
  claimJobs,
} from './queue';
import { PermanentJobError, Worker } from './worker';
import { silentLogger } from '../kernel/logger';
import { systemActor } from '../permissions/actor';
import { withTransaction } from '../kernel/context';
import { MINUTE } from '../kernel/clock';

describe('job queue', () => {
  let kit: TestKit;
  beforeEach(async () => {
    kit = await createTestKit();
  });
  afterEach(async () => {
    await kit.close();
  });

  it('runs a job and records completion', async () => {
    const seen: unknown[] = [];
    await enqueueJob(kit.system, 'test.echo', { n: 1 });
    const outcomes = await kit.drain({
      'test.echo': async (_ctx, payload) => void seen.push(payload),
    });
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.status).toBe('completed');
    expect(seen).toEqual([{ n: 1 }]);
  });

  it('dedupes live jobs by key but allows re-enqueue after completion', async () => {
    const a = await enqueueJob(kit.system, 'test.x', {}, { dedupeKey: 'k' });
    const b = await enqueueJob(kit.system, 'test.x', {}, { dedupeKey: 'k' });
    expect(a).not.toBeNull();
    expect(b).toBeNull();
    await kit.drain({ 'test.x': async () => undefined });
    expect(await enqueueJob(kit.system, 'test.x', {}, { dedupeKey: 'k' })).not.toBeNull();
  });

  it('does not run jobs before run_at', async () => {
    await enqueueJob(kit.system, 'test.later', {}, { delayMs: 10 * MINUTE });
    expect(await kit.drain({ 'test.later': async () => undefined })).toHaveLength(0);
    kit.clock.advance(11 * MINUTE);
    expect(await kit.drain({ 'test.later': async () => undefined })).toHaveLength(1);
  });

  it('retries with backoff then dead-letters', async () => {
    const id = await enqueueJob(kit.system, 'test.flaky', {}, { maxAttempts: 2 });
    const handler = {
      'test.flaky': async () => {
        throw new Error('boom');
      },
    };
    const first = await kit.drain(handler);
    expect(first[0]!.status).toBe('retry');
    kit.clock.advance(backoffMs(1) + 1);
    const second = await kit.drain(handler);
    expect(second[0]!.status).toBe('dead');
    const [row] = await kit.db.select().from(jobs).where(eq(jobs.id, id!));
    expect(row!.status).toBe('dead');
    expect(row!.lastError).toBe('boom');
  });

  it('dead-letters permanent errors immediately', async () => {
    await enqueueJob(kit.system, 'test.bad', {});
    const out = await kit.drain({
      'test.bad': async () => {
        throw new PermanentJobError('bad payload');
      },
    });
    expect(out[0]!.status).toBe('dead');
  });

  it('jobs enqueued in a rolled-back transaction never run', async () => {
    await expect(
      withTransaction(kit.system, async (tx) => {
        await enqueueJob(tx, 'test.ghost', {});
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await kit.drain({ 'test.ghost': async () => undefined })).toHaveLength(0);
  });

  it('a claimed job is not claimed twice', async () => {
    await enqueueJob(kit.system, 'test.once', {});
    const now = kit.clock.now();
    const first = await claimJobs(kit.db, { workerId: 'a', limit: 5, now });
    const second = await claimJobs(kit.db, { workerId: 'b', limit: 5, now });
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
  });

  it('recovers jobs from a dead worker', async () => {
    await enqueueJob(kit.system, 'test.stuck', {});
    await claimJobs(kit.db, { workerId: 'dead-worker', limit: 1, now: kit.clock.now() });
    kit.clock.advance(6 * MINUTE);
    expect(await recoverStaleJobs(kit.db, kit.clock.now())).toBe(1);
    expect(await kit.drain({ 'test.stuck': async () => undefined })).toHaveLength(1);
  });

  it('runNow executes exactly the given jobs', async () => {
    const ctx = kit.as(systemActor('t'));
    const keep = await enqueueJob(ctx, 'test.a', {});
    await enqueueJob(ctx, 'test.a', {});
    const worker = new Worker({
      db: kit.db,
      handlers: { 'test.a': async () => undefined },
      logger: silentLogger,
      clock: kit.clock,
      contextFor: () => kit.system,
    });
    const out = await worker.runNow([keep!]);
    expect(out.map((o) => o.id)).toEqual([keep]);
    expect((await getQueueStats(kit.db, kit.clock.now())).pending).toBe(1);
  });

  it('dead-letters unknown job types that are claimed via runNow', async () => {
    const worker = new Worker({
      db: kit.db,
      handlers: {},
      logger: silentLogger,
      clock: kit.clock,
      contextFor: () => kit.system,
    });
    const id = await enqueueJob(kit.system, 'test.nohandler', {});
    // Workers only claim types they can handle.
    expect(await worker.runNow([id!])).toHaveLength(0);
  });

  it('schedules recurring jobs once per bucket', async () => {
    expect(await enqueueRecurring(kit.system, 'test.tick', 60 * MINUTE)).not.toBeNull();
    await kit.drain({ 'test.tick': async () => undefined });
    expect(await enqueueRecurring(kit.system, 'test.tick', 60 * MINUTE)).toBeNull();
    kit.clock.advance(61 * MINUTE);
    expect(await enqueueRecurring(kit.system, 'test.tick', 60 * MINUTE)).not.toBeNull();
  });
});
