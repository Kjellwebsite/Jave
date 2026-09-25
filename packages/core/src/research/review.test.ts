import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { auditLogs, domainEvents, jobs, notifications, researchItems } from '@jave/database';
import { createFakeFetch, type FakeRoute, json, text } from '@jave/ai/testing';
import { createTestKit, type TestKit } from '../testing';
import { HOUR } from '../kernel/clock';
import {
  ConflictError,
  ForbiddenError,
  InvalidStateError,
  ValidationError,
} from '../kernel/errors';
import { enqueueJob } from '../jobs/queue';
import type { UserActor } from '../permissions/actor';
import { updateSettings } from '../settings/settings.service';
import { RESEARCH_ENRICH_JOB, RESEARCH_SYNC_SIDUS_JOB } from './constants';
import { createJobHandlers } from './jobs';
import { ArxivResolver } from './metadata/arxiv';
import { CrossrefResolver } from './metadata/crossref';
import { arxivFeed, CROSSREF_WORK } from './testing/fixtures';
import { saveFromMessage, saveResearchItem } from './research.service';
import { requestSidusSync, reviewResearchItem } from './review.service';
import { HttpSidusClient, NotConfiguredSidusClient, type SidusClient } from './sidus';

/** The revision a reviewer sees; reviews must name it. */
async function currentVersion(kit: TestKit, id: string): Promise<number> {
  const [item] = await kit.db
    .select({ version: researchItems.version })
    .from(researchItems)
    .where(eq(researchItems.id, id));
  return item!.version;
}

async function row(kit: TestKit, id: string) {
  const [item] = await kit.db.select().from(researchItems).where(eq(researchItems.id, id));
  return item!;
}

function handlers(
  options: { crossref?: FakeRoute[]; arxiv?: FakeRoute[]; sidus?: SidusClient } = {},
) {
  return createJobHandlers({
    resolvers: [
      new CrossrefResolver({ fetch: createFakeFetch(options.crossref ?? [json(404, {})]).fetch }),
      new ArxivResolver({ fetch: createFakeFetch(options.arxiv ?? [text(200, '<feed/>')]).fetch }),
    ],
    sidus: options.sidus ?? new NotConfiguredSidusClient(),
  });
}

/** Drain repeatedly, jumping past retry backoff each round. */
async function drainWithRetries(kit: TestKit, map: ReturnType<typeof handlers>, rounds = 6) {
  for (let i = 0; i < rounds; i++) {
    await kit.drain(map);
    kit.clock.advance(HOUR);
  }
}

/**
 * PGlite (Postgres in WASM) boots a fresh database per test; on a heavily
 * loaded machine the first boot alone can exceed the default hook timeout.
 */
const KIT_SETUP_TIMEOUT_MS = 180_000;
const INTEGRATION_TEST_TIMEOUT_MS = 60_000;

describe(
  'research review, enrichment and Sidus sync',
  { timeout: INTEGRATION_TEST_TIMEOUT_MS },
  () => {
    let kit: TestKit;
    let member: UserActor;
    let reviewer: UserActor;

    beforeEach(async () => {
      kit = await createTestKit();
      member = await kit.member({ roles: ['verified'] });
      reviewer = await kit.member({ roles: ['operations'] });
    }, KIT_SETUP_TIMEOUT_MS);
    afterEach(async () => {
      await kit.close();
    }, KIT_SETUP_TIMEOUT_MS);

    describe('review', () => {
      it('BREAK: members without canReviewResearch cannot review', async () => {
        const { item } = await saveResearchItem(kit.as(member), { title: 'Paper' });
        const peer = await kit.member({ roles: ['verified'] });
        await expect(
          reviewResearchItem(kit.as(peer), {
            itemId: item.id,
            expectedVersion: await currentVersion(kit, item.id),
            status: 'verified',
            evidenceLevel: 'experimental',
          }),
        ).rejects.toBeInstanceOf(ForbiddenError);
        expect((await row(kit, item.id)).status).toBe('new');
      });

      it('BREAK: nobody reviews their own submission', async () => {
        const { item } = await saveResearchItem(kit.as(reviewer), { title: 'My own paper' });
        await expect(
          reviewResearchItem(kit.as(reviewer), {
            itemId: item.id,
            expectedVersion: await currentVersion(kit, item.id),
            status: 'verified',
            evidenceLevel: 'meta_analysis',
          }),
        ).rejects.toBeInstanceOf(ForbiddenError);
        const [audit] = await kit.db
          .select()
          .from(auditLogs)
          .where(eq(auditLogs.action, 'research.self_review_blocked'));
        expect(audit).toMatchObject({
          targetId: item.id,
          result: 'denied',
          actorUserId: reviewer.userId,
        });
      });

      it('verifies with an evidence level, emits events about the submitter and notifies them', async () => {
        const { item } = await saveResearchItem(kit.as(member), { title: 'Sleep study' });
        await expect(
          reviewResearchItem(kit.as(reviewer), {
            itemId: item.id,
            expectedVersion: await currentVersion(kit, item.id),
            status: 'verified',
          }),
        ).rejects.toBeInstanceOf(ValidationError);
        const verified = await reviewResearchItem(kit.as(reviewer), {
          itemId: item.id,
          expectedVersion: await currentVersion(kit, item.id),
          status: 'verified',
          evidenceLevel: 'peer_reviewed',
          topic: 'Neuroscience',
          tags: ['sleep'],
          note: 'Checked the journal page.',
        });
        expect(verified).toMatchObject({
          status: 'verified',
          evidenceLevel: 'peer_reviewed',
          reviewedByUserId: reviewer.userId,
          sidusSyncStatus: 'not_synced',
        });
        const events = await kit.db
          .select()
          .from(domainEvents)
          .where(eq(domainEvents.aggregateId, item.id));
        const reviewed = events.find((e) => e.type === 'research.reviewed');
        const verifiedEvent = events.find((e) => e.type === 'research.verified');
        expect(reviewed?.subjectMemberId).toBe(member.memberId);
        expect(verifiedEvent?.subjectMemberId).toBe(member.memberId);
        const [note] = await kit.db
          .select()
          .from(notifications)
          .where(eq(notifications.recipientUserId, member.userId));
        expect(note).toMatchObject({
          type: 'research.reviewed',
          title: 'RESEARCH VERIFIED',
          body: 'Sleep study — evidence: PEER REVIEWED.',
        });
        const sync = await kit.db.select().from(jobs).where(eq(jobs.type, RESEARCH_SYNC_SIDUS_JOB));
        expect(sync).toHaveLength(0);
      });

      it('BREAK: rejects invalid transitions and nothing-to-do reviews', async () => {
        const { item } = await saveResearchItem(kit.as(member), { title: 'Paper' });
        await expect(
          reviewResearchItem(kit.as(reviewer), {
            itemId: item.id,
            expectedVersion: await currentVersion(kit, item.id),
          }),
        ).rejects.toBeInstanceOf(ValidationError);
        await expect(
          reviewResearchItem(kit.as(reviewer), {
            itemId: item.id,
            expectedVersion: await currentVersion(kit, item.id),
            status: 'archived' as 'verified',
          }),
        ).rejects.toBeInstanceOf(ValidationError);
        await expect(
          reviewResearchItem(kit.as(reviewer), {
            itemId: item.id,
            expectedVersion: await currentVersion(kit, item.id),
            status: 'new' as 'verified',
          }),
        ).rejects.toBeInstanceOf(ValidationError);
        const { archiveResearchItem } = await import('./research.service');
        await archiveResearchItem(kit.as(member), { itemId: item.id });
        await expect(
          reviewResearchItem(kit.as(reviewer), {
            itemId: item.id,
            expectedVersion: await currentVersion(kit, item.id),
            status: 'verified',
            evidenceLevel: 'anecdotal',
          }),
        ).rejects.toBeInstanceOf(InvalidStateError);
        await expect(
          reviewResearchItem(kit.as(reviewer), {
            itemId: item.id,
            expectedVersion: await currentVersion(kit, item.id),
            evidenceLevel: 'anecdotal',
          }),
        ).rejects.toBeInstanceOf(InvalidStateError);
      });

      it('BREAK: concurrent reviews verify an item exactly once', async () => {
        const { item } = await saveResearchItem(kit.as(member), { title: 'Contested paper' });
        const second = await kit.member({ roles: ['operations'] });
        // Every reviewer opened the same revision.
        const seen = await currentVersion(kit, item.id);
        const results = await Promise.allSettled(
          [reviewer, second, reviewer].map((actor) =>
            reviewResearchItem(kit.as(actor), {
              itemId: item.id,
              expectedVersion: seen,
              status: 'verified',
              evidenceLevel: 'experimental',
            }),
          ),
        );
        for (const result of results) {
          if (result.status === 'rejected') expect(result.reason).toBeInstanceOf(ConflictError);
        }
        expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
        const verifiedEvents = await kit.db
          .select()
          .from(domainEvents)
          .where(
            and(eq(domainEvents.aggregateId, item.id), eq(domainEvents.type, 'research.verified')),
          );
        expect(verifiedEvents).toHaveLength(1);
        expect((await row(kit, item.id)).status).toBe('verified');
      });
    });

    describe('enrichment', () => {
      it('fills Crossref metadata, replaces a guessed title and moves NEW → NEEDS REVIEW', async () => {
        const { item } = await saveResearchItem(kit.as(member), {
          doi: '10.1038/nature12373',
          tags: ['bio'],
        });
        await kit.drain(handlers({ crossref: [json(200, CROSSREF_WORK)] }));
        expect(await row(kit, item.id)).toMatchObject({
          title: 'Nanometre-scale thermometry in a living cell',
          titleGuessed: false,
          authors: ['G. Kucsko', 'P. C. Maurer', 'The Lab Consortium'],
          source: 'Nature',
          publishedOn: '2013-07-31',
          summary: 'Sensitive probing of temperature & heat.',
          enrichmentStatus: 'enriched',
          status: 'needs_review',
          tags: ['bio'],
        });
      });

      it('keeps what the member wrote and uses arXiv for arXiv ids', async () => {
        const { item } = await saveResearchItem(kit.as(member), {
          arxivId: '1706.03762',
          title: 'My framing',
          summary: 'My notes',
        });
        await kit.drain(handlers({ arxiv: [text(200, arxivFeed('1706.03762'))] }));
        expect(await row(kit, item.id)).toMatchObject({
          title: 'My framing',
          summary: 'My notes',
          source: 'arXiv',
          authors: ['Ashish Vaswani', 'Noam Shazeer'],
          enrichmentStatus: 'enriched',
        });
      });

      it('records not_found and skipped outcomes', async () => {
        const unknown = await saveResearchItem(kit.as(member), { doi: '10.9999/missing' });
        const plain = await saveResearchItem(kit.as(member), {
          title: 'A blog post with no identifier',
        });
        await kit.drain(handlers());
        expect(await row(kit, unknown.item.id)).toMatchObject({
          enrichmentStatus: 'not_found',
          status: 'needs_review',
        });
        expect(await row(kit, plain.item.id)).toMatchObject({
          enrichmentStatus: 'skipped',
          status: 'needs_review',
        });
      });

      it('retries outages, then records failure on the last attempt', async () => {
        const { item } = await saveResearchItem(kit.as(member), { doi: '10.1038/nature12373' });
        const map = handlers({ crossref: [json(503, {})] });
        await kit.drain(map);
        expect((await row(kit, item.id)).enrichmentStatus).toBe('pending');
        await drainWithRetries(kit, map);
        const final = await row(kit, item.id);
        expect(final).toMatchObject({ enrichmentStatus: 'failed', status: 'needs_review' });
        expect(final.enrichmentError).toContain('HTTP 503');
        const [job] = await kit.db.select().from(jobs).where(eq(jobs.type, RESEARCH_ENRICH_JOB));
        expect(job).toMatchObject({ status: 'completed', attempts: 3 });
      });

      it('does not retry bad data, and never re-enriches a processed item', async () => {
        const { item } = await saveResearchItem(kit.as(member), { doi: '10.1038/nature12373' });
        await kit.drain(handlers({ crossref: [text(200, 'not json')] }));
        expect((await row(kit, item.id)).enrichmentStatus).toBe('failed');
        await enqueueJob(kit.system, RESEARCH_ENRICH_JOB, { itemId: item.id });
        const outcomes = await kit.drain(handlers({ crossref: [json(200, CROSSREF_WORK)] }));
        expect(outcomes[0]!.result).toMatchObject({ skipped: 'already_processed' });
        expect((await row(kit, item.id)).title).toBe('DOI 10.1038/nature12373');
      });

      it('BREAK: malformed job payloads dead-letter instead of looping', async () => {
        await enqueueJob(kit.system, RESEARCH_ENRICH_JOB, { itemId: 'nope' });
        await enqueueJob(kit.system, RESEARCH_ENRICH_JOB, {
          itemId: '5f0c6f1e-6a55-4d2c-9d7e-2d1f3b8a9c10',
        });
        const outcomes = await kit.drain(handlers());
        expect(outcomes.map((o) => o.status)).toEqual(['dead', 'dead']);
      });
    });

    describe('Sidus sync', () => {
      async function verifiedItem(title = 'Verified paper') {
        const { item } = await saveResearchItem(kit.as(member), { title, doi: '10.4242/verified' });
        await reviewResearchItem(kit.as(reviewer), {
          itemId: item.id,
          expectedVersion: await currentVersion(kit, item.id),
          status: 'verified',
          evidenceLevel: 'experimental',
        });
        return item;
      }

      it('with auto-sync on but no configuration, records not_synced with the reason (never faked)', async () => {
        await updateSettings(kit.system, 'integrations', { sidusAutoSync: true });
        const item = await verifiedItem();
        expect((await row(kit, item.id)).sidusSyncStatus).toBe('pending');
        await kit.drain(handlers());
        expect(await row(kit, item.id)).toMatchObject({
          sidusSyncStatus: 'not_synced',
          sidusSyncError: 'Sidus integration is not configured.',
          sidusExternalId: null,
        });
      });

      it('pushes verified items and records the external id, without member identity', async () => {
        await updateSettings(kit.system, 'integrations', { sidusAutoSync: true });
        const item = await verifiedItem();
        const fake = createFakeFetch([json(201, { id: 'sidus_42' })]);
        const sidus = new HttpSidusClient({
          baseUrl: 'https://sidus.example.com',
          apiKey: 'k-secret',
          fetch: fake.fetch,
        });
        await kit.drain(handlers({ sidus }));
        expect(await row(kit, item.id)).toMatchObject({
          sidusSyncStatus: 'synced',
          sidusExternalId: 'sidus_42',
          sidusSyncError: null,
        });
        const body = fake.requests[0]!.body;
        expect(JSON.parse(body)).toMatchObject({
          externalRef: item.id,
          evidenceLevel: 'experimental',
          doi: '10.4242/verified',
        });
        for (const secret of [member.userId, member.memberId!, reviewer.userId, member.discordId]) {
          expect(body).not.toContain(secret);
        }
      });

      it('BREAK: Discord attachment and message links never leave JAVE', async () => {
        await updateSettings(kit.system, 'integrations', { sidusAutoSync: true });
        const { item } = await saveFromMessage(kit.as(member), {
          content: '',
          messageId: '1234567890123456789',
          messageUrl:
            'https://discord.com/channels/111111111111111111/222222222222222222/1234567890123456789',
          attachments: [
            {
              url: 'https://cdn.discordapp.com/attachments/1/2/sleep_study_2024.pdf?ex=abc&hm=sig',
              filename: 'sleep_study_2024.pdf',
            },
          ],
        });
        expect(item.title).toBe('sleep study 2024');
        await reviewResearchItem(kit.as(reviewer), {
          itemId: item.id,
          expectedVersion: await currentVersion(kit, item.id),
          status: 'verified',
          evidenceLevel: 'observational',
        });
        const fake = createFakeFetch([json(200, { id: 'sidus_7' })]);
        await kit.drain(
          handlers({
            sidus: new HttpSidusClient({
              baseUrl: 'https://sidus.example.com',
              apiKey: 'k',
              fetch: fake.fetch,
            }),
          }),
        );
        const body = fake.requests[0]!.body;
        expect(JSON.parse(body)).toMatchObject({ url: null, canonicalUrl: null });
        expect(body).not.toMatch(/discord(app)?\.com/);
      });

      it('retries Sidus outages then marks the sync failed', async () => {
        await updateSettings(kit.system, 'integrations', { sidusAutoSync: true });
        const item = await verifiedItem();
        const sidus = new HttpSidusClient({
          baseUrl: 'https://sidus.example.com',
          apiKey: 'k',
          fetch: createFakeFetch([json(503, {})]).fetch,
        });
        const map = handlers({ sidus });
        await kit.drain(map);
        expect(await row(kit, item.id)).toMatchObject({
          sidusSyncStatus: 'pending',
          sidusSyncError: 'Sidus responded with HTTP 503.',
        });
        await drainWithRetries(kit, map, 8);
        expect((await row(kit, item.id)).sidusSyncStatus).toBe('failed');
      });

      it('fails fast on rejected credentials', async () => {
        await updateSettings(kit.system, 'integrations', { sidusAutoSync: true });
        const item = await verifiedItem();
        const sidus = new HttpSidusClient({
          baseUrl: 'https://sidus.example.com',
          apiKey: 'k',
          fetch: createFakeFetch([json(401, {})]).fetch,
        });
        await kit.drain(handlers({ sidus }));
        expect(await row(kit, item.id)).toMatchObject({
          sidusSyncStatus: 'failed',
          sidusSyncError: 'Sidus rejected the credentials.',
        });
      });

      it('manual sync: reviewers only, verified only; un-verified items are not pushed', async () => {
        const item = await verifiedItem();
        await expect(requestSidusSync(kit.as(member), { itemId: item.id })).rejects.toBeInstanceOf(
          ForbiddenError,
        );
        const queued = await requestSidusSync(kit.as(reviewer), { itemId: item.id });
        expect(queued.sidusSyncStatus).toBe('pending');
        await reviewResearchItem(kit.as(reviewer), {
          itemId: item.id,
          expectedVersion: await currentVersion(kit, item.id),
          status: 'reviewed',
        });
        const fake = createFakeFetch([json(200, { id: 'x' })]);
        await kit.drain(
          handlers({
            sidus: new HttpSidusClient({
              baseUrl: 'https://sidus.example.com',
              apiKey: 'k',
              fetch: fake.fetch,
            }),
          }),
        );
        expect(fake.requests).toHaveLength(0);
        expect(await row(kit, item.id)).toMatchObject({
          sidusSyncStatus: 'not_synced',
          sidusSyncError: 'Only VERIFIED items sync to Sidus.',
        });
        await expect(
          requestSidusSync(kit.as(reviewer), { itemId: item.id }),
        ).rejects.toBeInstanceOf(InvalidStateError);
        const audit = await kit.db
          .select()
          .from(auditLogs)
          .where(
            and(
              eq(auditLogs.action, 'research.sidus_sync_requested'),
              eq(auditLogs.targetId, item.id),
            ),
          );
        expect(audit).toHaveLength(1);
      });
    });
  },
);
