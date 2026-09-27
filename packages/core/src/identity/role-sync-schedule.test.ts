import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { jobs } from '@jave/database';
import { createTestKit, type TestKit } from '../testing';
import { claimJobs, completeJob } from '../jobs/queue';
import { grantRoleUnchecked } from './roles.service';
import { DISCORD_ROLE_SYNC_JOB } from './users.service';

describe('discord role sync scheduling', () => {
  let kit: TestKit;
  beforeEach(async () => {
    kit = await createTestKit();
  });
  afterEach(async () => {
    await kit.close();
  });

  it('a role change while the member’s sync is running re-runs the sync afterwards', async () => {
    const target = await kit.member();
    const memberId = target.memberId!;
    await grantRoleUnchecked(kit.system, { memberId, role: 'supporter', reason: 'first' });
    const [running] = await claimJobs(kit.db, {
      workerId: 'test',
      limit: 10,
      now: kit.clock.now(),
      types: [DISCORD_ROLE_SYNC_JOB],
    });
    expect(running).toBeDefined();

    // The running sync may already have read the roles; this change must not be lost.
    await grantRoleUnchecked(kit.system, { memberId, role: 'verified', reason: 'second' });
    const [flagged] = await kit.db.select().from(jobs).where(eq(jobs.id, running!.id));
    expect(flagged!.rerunRequested).toBe(true);

    await completeJob(kit.db, running!.id, kit.clock.now());
    const pending = await kit.db
      .select()
      .from(jobs)
      .where(and(eq(jobs.type, DISCORD_ROLE_SYNC_JOB), eq(jobs.status, 'pending')));
    expect(pending).toHaveLength(1);
    expect(pending[0]!.payload).toEqual({ memberId });
  });
});
