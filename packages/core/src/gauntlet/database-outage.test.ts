import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { auditLogs, jobs } from '@jave/database';
import { testBackend } from '@jave/database/testing';
import { recordAudit } from '../audit/audit.service';
import { listMembers } from '../identity/users.service';
import { enqueueJob } from '../jobs/queue';
import type { JobHandlerMap } from '../jobs/worker';
import { MINUTE } from '../kernel/clock';
import { createTestKit, type TestKit } from '../testing';

/**
 * GAUNTLET: the database drops connections (a failover, a restart, an
 * administrator killing sessions). Processes must not need a restart: the
 * pool replaces dead connections, and a job whose connection died mid-run is
 * retried and takes effect exactly once. Run with JAVE_TEST_BACKEND=postgres;
 * PGlite has no connections to lose.
 */

vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 });

const JOB = 'gauntlet.effect';
/** Postgres needs a moment to close the killed sockets; the pool learns of it on 'close'. */
const SETTLE_MS = 200;

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(testBackend() !== 'postgres')('GAUNTLET: database connections drop', () => {
  let kit: TestKit;

  beforeEach(async () => {
    kit = await createTestKit();
  });
  afterEach(async () => {
    await kit.close();
  });

  /** Kill every other connection this test holds to its database. */
  async function killOtherConnections(): Promise<number> {
    const rows = (await kit.db.execute(sql`
      select pg_terminate_backend(pid) as killed
      from pg_stat_activity
      where datname = current_database() and pid <> pg_backend_pid()
    `)) as unknown as { killed: boolean }[];
    await pause(SETTLE_MS);
    return rows.filter((row) => row.killed).length;
  }

  it('services keep working after the pool’s connections are killed', async () => {
    const founder = await kit.member({ roles: ['founder'] });
    // Open several pooled connections at once.
    await Promise.all(Array.from({ length: 6 }, () => listMembers(kit.as(founder), { limit: 5 })));
    expect(await killOtherConnections()).toBeGreaterThan(0);

    // A service call right after, and many in parallel, all succeed on fresh connections.
    const pages = await Promise.all(
      Array.from({ length: 8 }, () => listMembers(kit.as(founder), { limit: 5 })),
    );
    for (const page of pages) expect(page.items.length).toBeGreaterThan(0);
  });

  it('a job whose connection dies mid-run is retried and takes effect exactly once', async () => {
    let attempts = 0;
    const handlers: JobHandlerMap = {
      [JOB]: async (ctx) => {
        attempts += 1;
        if (attempts === 1) {
          // The connection running this job dies before the effect is written.
          await ctx.db.execute(sql`select pg_terminate_backend(pg_backend_pid())`);
        }
        await recordAudit(ctx, { action: 'gauntlet.effect_applied', targetType: 'gauntlet' });
      },
    };
    const id = await enqueueJob(kit.system, JOB, {});

    await kit.drain(handlers);
    const [afterFailure] = await kit.db.select().from(jobs).where(eq(jobs.id, id!));
    expect(afterFailure).toMatchObject({ status: 'pending', attempts: 1 });
    expect(afterFailure!.lastError).toBeTruthy();

    kit.clock.advance(MINUTE);
    await kit.drain(handlers);
    const [done] = await kit.db.select().from(jobs).where(eq(jobs.id, id!));
    expect(done).toMatchObject({ status: 'completed', attempts: 2 });
    const effects = await kit.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'gauntlet.effect_applied')));
    expect(effects).toHaveLength(1);
  });
});
