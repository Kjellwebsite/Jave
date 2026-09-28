import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { auditLogs, jobs, trialParticipants, trials } from '@jave/database';
import { ConflictError, ForbiddenError, InvalidStateError, NotFoundError } from '../kernel/errors';
import type { UserActor } from '../permissions/actor';
import { createTestKit, type TestKit } from '../testing';
import { listAuditLogs } from '../audit/audit.service';
import { listJobs, retryDeadJob } from './admin.service';
import { enqueueJob } from './queue';

const BROKEN = 'test.broken';

describe('job administration', () => {
  let kit: TestKit;
  let founder: UserActor;
  let moderator: UserActor;
  let member: UserActor;
  let shouldFail: boolean;
  const handlers = () => ({
    [BROKEN]: async () => {
      if (shouldFail) throw new Error(`discord said no: ${'x'.repeat(400)}`);
    },
  });

  beforeEach(async () => {
    kit = await createTestKit();
    founder = await kit.member({ roles: ['founder'] });
    moderator = await kit.member({ roles: ['moderator'] });
    member = await kit.member({ roles: ['verified'] });
    shouldFail = true;
  });
  afterEach(async () => {
    await kit.close();
  });

  async function deadJob(dedupeKey?: string) {
    const id = await enqueueJob(
      kit.system,
      BROKEN,
      { secret: 'member content' },
      {
        maxAttempts: 1,
        dedupeKey,
      },
    );
    await kit.drain(handlers());
    return id!;
  }

  it('lists dead letters without payloads, with a bounded error excerpt', async () => {
    const id = await deadJob();
    const page = await listJobs(kit.as(moderator));
    expect(page.total).toBe(1);
    const [job] = page.items;
    expect(job).toMatchObject({ id, type: BROKEN, status: 'dead', attempts: 1 });
    expect(job).not.toHaveProperty('payload');
    expect(job!.lastError!.length).toBeLessThanOrEqual(301);
  });

  it('BREAK: dead adversarial jobs are hidden from staff who may not know a role exists', async () => {
    const BRIEF = 'discord.adversarial.brief';
    const briefId = await enqueueJob(
      kit.system,
      BRIEF,
      { roleId: 'r' },
      {
        maxAttempts: 1,
      },
    );
    await kit.drain({
      [BRIEF]: async () => {
        throw new Error('Cannot send messages to this user (operative Mara, Team A)');
      },
    });
    await deadJob();

    // A moderator (no adversarial capability) sees the other dead letter only, counts included.
    const forModerator = await listJobs(kit.as(moderator));
    expect(forModerator.total).toBe(1);
    expect(forModerator.items.map((job) => job.type)).toEqual([BROKEN]);
    expect(await listJobs(kit.as(moderator), { type: BRIEF })).toMatchObject({ total: 0 });

    // Core staff competing in an open trial: hidden too, and a retry answers like a missing job.
    const competitor = await kit.member({ roles: ['core'] });
    const [trial] = await kit.db
      .insert(trials)
      .values({
        title: 'Security sprint',
        category: 'security',
        brief: 'Ship it.',
        rubric: [],
        status: 'active',
        durationMinutes: 60,
      })
      .returning({ id: trials.id });
    await kit.db
      .insert(trialParticipants)
      .values({ trialId: trial!.id, memberId: competitor.memberId!, status: 'selected' });
    expect((await listJobs(kit.as(competitor))).items.map((job) => job.type)).toEqual([BROKEN]);
    await expect(retryDeadJob(kit.as(competitor), { jobId: briefId! })).rejects.toBeInstanceOf(
      NotFoundError,
    );

    // Entitled staff see and retry it; the retry's audit entry stays out of the competitor's log.
    const entitled = await listJobs(kit.as(founder));
    expect(entitled.items.map((job) => job.type).sort()).toEqual([BRIEF, BROKEN].sort());
    await retryDeadJob(kit.as(founder), { jobId: briefId! });
    const competitorLog = await listAuditLogs(kit.as(competitor), { action: 'job.retried' });
    expect(competitorLog.total).toBe(0);
    const founderLog = await listAuditLogs(kit.as(founder), { action: 'job.retried' });
    expect(founderLog.total).toBe(1);
  });

  it('BREAK: members cannot list jobs; only settings managers may retry', async () => {
    const id = await deadJob();
    await expect(listJobs(kit.as(member))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(retryDeadJob(kit.as(moderator), { jobId: id })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const [row] = await kit.db.select().from(jobs).where(eq(jobs.id, id));
    expect(row!.status).toBe('dead');
  });

  it('a retried job runs again with a fresh attempt budget, and the retry is audited', async () => {
    const id = await deadJob();
    shouldFail = false;
    const retried = await retryDeadJob(kit.as(founder), { jobId: id });
    expect(retried).toMatchObject({ status: 'pending', attempts: 0 });
    const outcomes = await kit.drain(handlers());
    expect(outcomes).toMatchObject([{ id, status: 'completed' }]);
    const audits = await kit.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'job.retried'), eq(auditLogs.targetId, String(id))));
    expect(audits).toHaveLength(1);
    expect(audits[0]!.actorUserId).toBe(founder.userId);
  });

  it('BREAK: only dead jobs can be retried, and never twice alongside a live copy', async () => {
    const pending = await enqueueJob(kit.system, 'test.idle', {}, { delayMs: 60_000 });
    await expect(retryDeadJob(kit.as(founder), { jobId: pending! })).rejects.toBeInstanceOf(
      InvalidStateError,
    );
    await expect(retryDeadJob(kit.as(founder), { jobId: 999_999 })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    const id = await deadJob('sync:team:1');
    await enqueueJob(kit.system, BROKEN, {}, { dedupeKey: 'sync:team:1', delayMs: 60_000 });
    await expect(retryDeadJob(kit.as(founder), { jobId: id })).rejects.toBeInstanceOf(
      ConflictError,
    );
  });
});
