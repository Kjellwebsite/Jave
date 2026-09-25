import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { auditLogs, domainEvents, jobs, members, researchItems } from '@jave/database';
import { createTestKit, type TestKit } from '../testing';
import {
  ConflictError,
  ForbiddenError,
  InvalidStateError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from '../kernel/errors';
import { anonymousActor, type UserActor } from '../permissions/actor';
import { RESEARCH_ENRICH_JOB } from './constants';
import {
  archiveResearchItem,
  getResearchItem,
  listResearchItems,
  saveFromMessage,
  saveResearchItem,
  updateResearchItem,
} from './research.service';
import { reviewResearchItem } from './review.service';

const MESSAGE_ID = '1234567890123456789';
const MESSAGE_URL = `https://discord.com/channels/111111111111111111/222222222222222222/${MESSAGE_ID}`;

/**
 * PGlite (Postgres in WASM) boots a fresh database per test; on a heavily
 * loaded machine the first boot alone can exceed the default hook timeout.
 */
const KIT_SETUP_TIMEOUT_MS = 180_000;
const INTEGRATION_TEST_TIMEOUT_MS = 60_000;

describe('research library', { timeout: INTEGRATION_TEST_TIMEOUT_MS }, () => {
  let kit: TestKit;
  let member: UserActor;
  let other: UserActor;
  let reviewer: UserActor;

  beforeEach(async () => {
    kit = await createTestKit();
    member = await kit.member({ roles: ['verified'] });
    other = await kit.member({ roles: ['verified'] });
    reviewer = await kit.member({ roles: ['operations'] });
  }, KIT_SETUP_TIMEOUT_MS);
  afterEach(async () => {
    await kit.close();
  }, KIT_SETUP_TIMEOUT_MS);

  describe('saving', () => {
    it('saves as NEW, publishes research.submitted about the submitter, queues enrichment', async () => {
      const { item, duplicate } = await saveResearchItem(kit.as(member), {
        url: 'https://doi.org/10.1038/NATURE12373?utm_source=tw',
        tags: ['Thermometry', 'thermometry', 'biology'],
      });
      expect(duplicate).toBe(false);
      expect(item).toMatchObject({
        status: 'new',
        doi: '10.1038/nature12373',
        canonicalUrl: 'https://doi.org/10.1038/nature12373',
        title: 'DOI 10.1038/nature12373',
        titleGuessed: true,
        tags: ['thermometry', 'biology'],
        submittedByUserId: member.userId,
        enrichmentStatus: 'pending',
      });
      const [event] = await kit.db
        .select()
        .from(domainEvents)
        .where(eq(domainEvents.type, 'research.submitted'));
      expect(event).toMatchObject({ aggregateId: item.id, subjectMemberId: member.memberId });
      const queued = await kit.db.select().from(jobs).where(eq(jobs.type, RESEARCH_ENRICH_JOB));
      expect(queued).toHaveLength(1);
      expect(queued[0]!.payload).toEqual({ itemId: item.id });
    });

    it('dedupes by DOI, arXiv id and canonical URL, returning the existing item', async () => {
      const first = await saveResearchItem(kit.as(member), { doi: '10.5555/ABC' });
      const again = await saveResearchItem(kit.as(other), {
        title: 'Same paper',
        url: 'https://dx.doi.org/10.5555/abc',
      });
      expect(again).toMatchObject({ duplicate: true, item: { id: first.item.id } });

      const arxiv = await saveResearchItem(kit.as(member), { arxivId: 'arXiv:1706.03762v2' });
      const arxivAgain = await saveResearchItem(kit.as(other), {
        url: 'https://arxiv.org/pdf/1706.03762v7.pdf',
      });
      expect(arxivAgain).toMatchObject({ duplicate: true, item: { id: arxiv.item.id } });

      const web = await saveResearchItem(kit.as(member), { url: 'https://Example.com/post/' });
      const webAgain = await saveResearchItem(kit.as(other), {
        url: 'https://example.com/post?utm_campaign=x#top',
      });
      expect(webAgain).toMatchObject({ duplicate: true, item: { id: web.item.id } });

      const count = await kit.db.select().from(researchItems);
      expect(count).toHaveLength(3);
    });

    it('BREAK: a duplicate save never reveals an archived item the caller cannot see', async () => {
      const { item } = await saveResearchItem(kit.as(member), {
        doi: '10.8888/hidden',
        title: 'Withdrawn study',
      });
      await archiveResearchItem(kit.as(member), { itemId: item.id });
      await expect(
        saveResearchItem(kit.as(other), { doi: '10.8888/hidden' }),
      ).rejects.toBeInstanceOf(ConflictError);
      await expect(
        saveResearchItem(kit.as(reviewer), { doi: '10.8888/hidden' }),
      ).resolves.toMatchObject({ duplicate: true, item: { id: item.id } });
    });

    it('BREAK: concurrent saves of the same reference create one item', async () => {
      const results = await Promise.all(
        [member, other, member].map((actor) =>
          saveResearchItem(kit.as(actor), { doi: '10.7777/race' }),
        ),
      );
      expect(new Set(results.map((r) => r.item.id)).size).toBe(1);
      expect(results.filter((r) => !r.duplicate)).toHaveLength(1);
    });

    it('turns a Discord message into an item, once per message', async () => {
      const input = {
        content: '**Attention Is All You Need**\nhttps://arxiv.org/abs/1706.03762v7',
        messageUrl: MESSAGE_URL,
        messageId: MESSAGE_ID,
      };
      const { item } = await saveFromMessage(kit.as(member), input);
      expect(item).toMatchObject({
        title: 'Attention Is All You Need',
        arxivId: '1706.03762',
        canonicalUrl: 'https://arxiv.org/abs/1706.03762',
        discordMessageId: MESSAGE_ID,
        discordMessageUrl: MESSAGE_URL,
      });
      const again = await saveFromMessage(kit.as(other), { ...input, content: 'edited text' });
      expect(again).toMatchObject({ duplicate: true, item: { id: item.id } });
    });

    it('BREAK: rejects malformed, hostile and oversized input', async () => {
      const ctx = kit.as(member);
      await expect(
        saveFromMessage(ctx, { content: 'lol', messageUrl: MESSAGE_URL, messageId: MESSAGE_ID }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        saveFromMessage(ctx, {
          content: 'https://example.com/paper',
          messageUrl: MESSAGE_URL.replace(MESSAGE_ID, '1234567890123456780'),
          messageId: MESSAGE_ID,
        }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        saveFromMessage(ctx, {
          content: 'https://example.com/paper',
          messageUrl: 'https://evil.example/channels/1/2/3',
          messageId: MESSAGE_ID,
        }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        saveFromMessage(ctx, {
          content: 'x'.repeat(4001),
          messageUrl: MESSAGE_URL,
          messageId: MESSAGE_ID,
        }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(saveResearchItem(ctx, { url: 'javascript:alert(1)' })).rejects.toBeInstanceOf(
        ValidationError,
      );
      await expect(
        saveResearchItem(ctx, { url: 'https://user:secret@example.com/paper' }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        saveResearchItem(ctx, { title: 'x', tags: Array.from({ length: 11 }, (_, i) => `t${i}`) }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(saveResearchItem(ctx, { title: 'x'.repeat(301) })).rejects.toBeInstanceOf(
        ValidationError,
      );
      await expect(
        saveResearchItem(ctx, { title: 'x', tags: ['<script>'] }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(saveResearchItem(ctx, {})).rejects.toBeInstanceOf(ValidationError);
      await expect(saveResearchItem(ctx, { doi: 'not-a-doi' })).rejects.toBeInstanceOf(
        ValidationError,
      );
    });

    it('BREAK: anonymous, applicants and quarantined members cannot add research', async () => {
      await expect(
        saveResearchItem(kit.as(anonymousActor), { title: 'Paper' }),
      ).rejects.toBeInstanceOf(UnauthenticatedError);
      const applicant = await kit.member({ roles: [] });
      await kit.db
        .update(members)
        .set({ standing: 'restricted' })
        .where(eq(members.id, applicant.memberId!));
      const { resolveUserActor } = await import('../identity/users.service');
      const restricted = await resolveUserActor(kit.system, applicant.userId);
      await expect(saveResearchItem(kit.as(restricted), { title: 'Paper' })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await expect(saveResearchItem(kit.system, { title: 'Paper' })).rejects.toBeInstanceOf(
        UnauthenticatedError,
      );
    });
  });

  describe('editing and archiving', () => {
    it('lets the submitter edit; a reviewed item returns to NEEDS REVIEW', async () => {
      const { item } = await saveResearchItem(kit.as(member), { title: 'Draft title' });
      await reviewResearchItem(kit.as(reviewer), { itemId: item.id, status: 'reviewed' });
      const edited = await updateResearchItem(kit.as(member), {
        itemId: item.id,
        title: 'Final title',
        url: 'https://example.com/final/',
      });
      expect(edited).toMatchObject({
        title: 'Final title',
        titleGuessed: false,
        status: 'needs_review',
        canonicalUrl: 'https://example.com/final',
      });
    });

    it('BREAK: other members cannot edit or archive (IDOR), and denials are audited', async () => {
      const { item } = await saveResearchItem(kit.as(member), { title: 'Mine' });
      await expect(
        updateResearchItem(kit.as(other), { itemId: item.id, title: 'Hijacked' }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(archiveResearchItem(kit.as(other), { itemId: item.id })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      const denials = await kit.db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.action, 'access.denied'), eq(auditLogs.targetId, item.id)));
      expect(denials).toHaveLength(2);
      expect((await getResearchItem(kit.as(member), { itemId: item.id })).title).toBe('Mine');
    });

    it('locks verified items for the submitter but not for reviewers', async () => {
      const { item } = await saveResearchItem(kit.as(member), { title: 'Locked' });
      await reviewResearchItem(kit.as(reviewer), {
        itemId: item.id,
        status: 'verified',
        evidenceLevel: 'experimental',
      });
      await expect(
        updateResearchItem(kit.as(member), { itemId: item.id, title: 'Changed' }),
      ).rejects.toBeInstanceOf(InvalidStateError);
      const fixed = await updateResearchItem(kit.as(reviewer), {
        itemId: item.id,
        title: 'Typo fixed',
      });
      expect(fixed.status).toBe('verified');
      const audit = await kit.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'research.updated'));
      expect(audit).toHaveLength(1);
    });

    it('refuses an edit that would duplicate another item', async () => {
      await saveResearchItem(kit.as(member), { doi: '10.1111/taken' });
      const { item } = await saveResearchItem(kit.as(member), { title: 'Other' });
      await expect(
        updateResearchItem(kit.as(member), { itemId: item.id, doi: '10.1111/TAKEN' }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('archives: hidden from others, visible to submitter and reviewers, restorable by reviewers', async () => {
      const { item } = await saveResearchItem(kit.as(member), { title: 'Withdrawn' });
      await archiveResearchItem(kit.as(member), {
        itemId: item.id,
        reason: 'duplicate of a better source',
      });
      await expect(archiveResearchItem(kit.as(member), { itemId: item.id })).rejects.toBeInstanceOf(
        InvalidStateError,
      );
      await expect(getResearchItem(kit.as(other), { itemId: item.id })).rejects.toBeInstanceOf(
        NotFoundError,
      );
      await expect(getResearchItem(kit.as(member), { itemId: item.id })).resolves.toMatchObject({
        status: 'archived',
      });
      expect((await listResearchItems(kit.as(other), { status: 'archived' })).items).toHaveLength(
        0,
      );
      expect(
        (await listResearchItems(kit.as(reviewer), { status: 'archived' })).items,
      ).toHaveLength(1);
      await expect(
        updateResearchItem(kit.as(member), { itemId: item.id, title: 'x' }),
      ).rejects.toBeInstanceOf(InvalidStateError);
      const restored = await reviewResearchItem(kit.as(reviewer), {
        itemId: item.id,
        status: 'needs_review',
      });
      expect(restored.status).toBe('needs_review');
    });
  });

  describe('browsing', () => {
    it('filters by status, topic, tag and text, with pagination', async () => {
      const a = await saveResearchItem(kit.as(member), {
        title: 'Sleep and memory consolidation',
        topic: 'Neuroscience',
        tags: ['sleep'],
      });
      await saveResearchItem(kit.as(member), {
        title: 'Protein folding at scale',
        topic: 'Biology',
        tags: ['proteins'],
      });
      await saveResearchItem(kit.as(other), { title: '100% effective? A_B test', tags: ['stats'] });
      await reviewResearchItem(kit.as(reviewer), { itemId: a.item.id, status: 'reviewed' });

      const viewer = kit.as(other);
      expect((await listResearchItems(viewer, {})).total).toBe(3);
      expect(
        (await listResearchItems(viewer, { status: 'reviewed' })).items.map((i) => i.id),
      ).toEqual([a.item.id]);
      expect((await listResearchItems(viewer, { topic: 'neuroscience' })).total).toBe(1);
      expect((await listResearchItems(viewer, { tag: 'Proteins' })).total).toBe(1);
      expect((await listResearchItems(viewer, { q: 'memory' })).total).toBe(1);
      expect((await listResearchItems(viewer, { q: '%' })).items.map((i) => i.title)).toEqual([
        '100% effective? A_B test',
      ]);
      expect((await listResearchItems(viewer, { q: '_' })).total).toBe(1);
      expect((await listResearchItems(viewer, { mine: true })).total).toBe(1);
      const page = await listResearchItems(viewer, { limit: 2, offset: 2 });
      expect(page).toMatchObject({ total: 3, limit: 2, offset: 2 });
      expect(page.items).toHaveLength(1);
    });

    it('BREAK: anonymous users cannot browse and bad ids are validation errors', async () => {
      await expect(listResearchItems(kit.as(anonymousActor), {})).rejects.toBeInstanceOf(
        UnauthenticatedError,
      );
      await expect(
        getResearchItem(kit.as(member), { itemId: "1' or '1'='1" }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(listResearchItems(kit.as(member), { limit: 10_000 })).rejects.toBeInstanceOf(
        ValidationError,
      );
    });
  });
});
