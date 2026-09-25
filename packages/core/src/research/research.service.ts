import { and, desc, eq, ilike, isNull, ne, or, type SQL, sql } from 'drizzle-orm';
import { researchItems } from '@jave/database';
import { recordAudit } from '../audit/audit.service';
import { publishEvent } from '../events/bus';
import { enqueueJob } from '../jobs/queue';
import { type ServiceContext, withTransaction } from '../kernel/context';
import {
  ConflictError,
  InvalidStateError,
  isUniqueViolation,
  NotFoundError,
  ValidationError,
} from '../kernel/errors';
import type { Page } from '../kernel/pagination';
import { parseInput } from '../kernel/validation';
import { authorize, requireMember } from '../permissions/authorize';
import { ENRICH_MAX_ATTEMPTS, RESEARCH_ENRICH_JOB } from './constants';
import { canonicalizeUrl, extractResearchCandidate } from './extraction';
import {
  assertTransition,
  canSee,
  isReviewer,
  isSubmitter,
  loadItem,
  requireContributor,
  type ResearchItemRecord,
  type ResearchItemView,
  toView,
} from './model';
import {
  archiveResearchItemSchema,
  itemIdSchema,
  type ListResearchInput,
  listResearchSchema,
  type SaveFromMessageInput,
  saveFromMessageSchema,
  type SaveResearchItemInput,
  saveResearchItemSchema,
  type UpdateResearchItemInput,
  updateResearchItemSchema,
} from './schemas';

export type ResearchOrigin = 'manual' | 'discord' | 'ai';

export interface SaveResult {
  item: ResearchItemView;
  /** True when an existing item already had this DOI, arXiv ID, URL or message. */
  duplicate: boolean;
}

interface NewItemFields {
  title: string;
  titleGuessed: boolean;
  authors: string[];
  source: string | null;
  url: string | null;
  canonicalUrl: string | null;
  doi: string | null;
  arxivId: string | null;
  topic: string | null;
  tags: string[];
  summary: string | null;
  publishedOn: string | null;
  discordMessageId: string | null;
  discordMessageUrl: string | null;
}

const DUPLICATE_REFERENCE_MESSAGE = 'Another research item already uses that DOI, arXiv ID or URL.';
const CONCURRENT_EDIT_MESSAGE =
  'This item changed while you were editing it. Reload and try again.';

async function findDuplicate(ctx: ServiceContext, fields: NewItemFields) {
  const matches: SQL[] = [];
  if (fields.doi) matches.push(eq(researchItems.doi, fields.doi));
  if (fields.arxivId) matches.push(eq(researchItems.arxivId, fields.arxivId));
  if (fields.canonicalUrl) matches.push(eq(researchItems.canonicalUrl, fields.canonicalUrl));
  if (fields.discordMessageId) {
    matches.push(eq(researchItems.discordMessageId, fields.discordMessageId));
  }
  if (matches.length === 0) return null;
  const [row] = await ctx.db
    .select()
    .from(researchItems)
    .where(or(...matches))
    .limit(1);
  if (row?.deletedAt) throw new ConflictError('This reference was removed from the library.');
  return row ?? null;
}

/** An existing item for the same reference; archived items the caller cannot see stay hidden. */
function duplicateOf(ctx: ServiceContext, row: ResearchItemRecord): SaveResult {
  if (!canSee(ctx, row)) {
    throw new ConflictError('This reference is already in the library (archived).');
  }
  return { item: toView(row), duplicate: true };
}

/** Dedupe, insert as NEW, announce, and queue metadata enrichment — atomically. */
async function persistNewItem(
  ctx: ServiceContext,
  submitter: { userId: string; memberId: string },
  fields: NewItemFields,
  origin: ResearchOrigin,
): Promise<SaveResult> {
  return withTransaction(ctx, async (tx) => {
    const existing = await findDuplicate(tx, fields);
    if (existing) return duplicateOf(tx, existing);
    let row;
    try {
      // Savepoint: a concurrent insert of the same reference must not abort the transaction.
      row = await withTransaction(tx, async (sp) => {
        const [inserted] = await sp.db
          .insert(researchItems)
          .values({
            ...fields,
            submittedByUserId: submitter.userId,
            createdAt: sp.clock.now(),
            updatedAt: sp.clock.now(),
          })
          .returning();
        return inserted!;
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const winner = await findDuplicate(tx, fields);
      if (!winner) throw error;
      return duplicateOf(tx, winner);
    }
    await publishEvent(tx, {
      type: 'research.submitted',
      aggregateType: 'research_item',
      aggregateId: row.id,
      subjectMemberId: submitter.memberId,
      payload: { origin, doi: row.doi, arxivId: row.arxivId },
    });
    await enqueueJob(
      tx,
      RESEARCH_ENRICH_JOB,
      { itemId: row.id },
      { dedupeKey: `research:enrich:${row.id}`, maxAttempts: ENRICH_MAX_ATTEMPTS },
    );
    return { item: toView(row), duplicate: false };
  });
}

/** Save a research item from explicit fields (dashboard form, AI proposal). */
export async function saveResearchItem(
  ctx: ServiceContext,
  input: SaveResearchItemInput,
  options: { origin?: ResearchOrigin } = {},
): Promise<SaveResult> {
  const actor = await requireContributor(ctx);
  const data = parseInput(saveResearchItemSchema, input);
  const fromUrl = data.url ? extractResearchCandidate(data.url) : null;
  const doi = data.doi ?? fromUrl?.doi ?? null;
  const arxivId = data.arxivId ?? fromUrl?.arxivId ?? null;
  const url =
    data.url ??
    (doi ? `https://doi.org/${doi}` : arxivId ? `https://arxiv.org/abs/${arxivId}` : null);
  const guessedTitle =
    fromUrl?.titleGuess ?? (doi ? `DOI ${doi}` : arxivId ? `arXiv:${arxivId}` : null);
  const title = data.title ?? guessedTitle;
  if (!title) throw new ValidationError('Provide a title, URL, DOI or arXiv ID.');
  return persistNewItem(
    ctx,
    actor,
    {
      title,
      titleGuessed: !data.title,
      authors: data.authors ?? [],
      source: data.source ?? null,
      url,
      canonicalUrl: url ? canonicalizeUrl(url) : null,
      doi,
      arxivId,
      topic: data.topic ?? null,
      tags: data.tags ?? [],
      summary: data.summary || null,
      publishedOn: data.publishedOn ?? null,
      discordMessageId: null,
      discordMessageUrl: null,
    },
    options.origin ?? 'manual',
  );
}

/** Turn a Discord message into a research item. One item per message. */
export async function saveFromMessage(
  ctx: ServiceContext,
  input: SaveFromMessageInput,
): Promise<SaveResult> {
  const actor = await requireContributor(ctx);
  const data = parseInput(saveFromMessageSchema, input);
  const candidate = extractResearchCandidate(data.content, data.attachments ?? []);
  if (!candidate.titleGuess) {
    throw new ValidationError('No research reference found in that message.');
  }
  return persistNewItem(
    ctx,
    actor,
    {
      title: candidate.titleGuess,
      titleGuessed: true,
      authors: [],
      source: null,
      url: candidate.url,
      canonicalUrl: candidate.canonicalUrl,
      doi: candidate.doi,
      arxivId: candidate.arxivId,
      topic: null,
      tags: [],
      summary: null,
      publishedOn: null,
      discordMessageId: data.messageId,
      discordMessageUrl: data.messageUrl,
    },
    'discord',
  );
}

/**
 * Edit bibliographic fields. Submitters edit their own items until they are
 * verified (a reviewed item returns to NEEDS REVIEW); reviewers edit any
 * non-archived item.
 */
export async function updateResearchItem(
  ctx: ServiceContext,
  input: UpdateResearchItemInput,
): Promise<ResearchItemView> {
  const data = parseInput(updateResearchItemSchema, input);
  requireMember(ctx);
  const item = await loadItem(ctx, data.itemId);
  if (!canSee(ctx, item)) throw new NotFoundError('Research item');
  const reviewer = isReviewer(ctx);
  const submitter = isSubmitter(ctx, item);
  const target = { type: 'research_item', id: item.id };
  if (!submitter && !reviewer) await authorize(ctx, 'canReviewResearch', target);
  if (!reviewer) await requireContributor(ctx);
  if (item.status === 'archived') {
    throw new InvalidStateError('Archived items cannot be edited. Restore it first.');
  }
  if (!reviewer && item.status === 'verified') {
    throw new InvalidStateError('Verified items are locked. Ask a reviewer to reopen it.');
  }

  const patch: Partial<typeof researchItems.$inferInsert> = {};
  if (data.title !== undefined) Object.assign(patch, { title: data.title, titleGuessed: false });
  if (data.authors !== undefined) patch.authors = data.authors;
  if (data.source !== undefined) patch.source = data.source;
  if (data.summary !== undefined) patch.summary = data.summary || null;
  if (data.publishedOn !== undefined) patch.publishedOn = data.publishedOn;
  if (data.topic !== undefined) patch.topic = data.topic;
  if (data.tags !== undefined) patch.tags = data.tags;
  if (data.doi !== undefined) patch.doi = data.doi;
  if (data.arxivId !== undefined) patch.arxivId = data.arxivId;
  if (data.url !== undefined) {
    patch.url = data.url;
    patch.canonicalUrl = data.url ? canonicalizeUrl(data.url) : null;
  }
  if (!reviewer && item.status === 'reviewed') patch.status = 'needs_review';
  patch.updatedAt = ctx.clock.now();

  try {
    return await withTransaction(ctx, async (tx) => {
      const [row] = await tx.db
        .update(researchItems)
        .set(patch)
        // Optimistic guard: the status checks above must still hold (e.g. not verified meanwhile).
        .where(and(eq(researchItems.id, item.id), eq(researchItems.status, item.status)))
        .returning();
      if (!row) throw new ConflictError(CONCURRENT_EDIT_MESSAGE);
      if (!submitter) {
        await recordAudit(tx, {
          action: 'research.updated',
          targetType: 'research_item',
          targetId: item.id,
          context: { fields: Object.keys(data).filter((key) => key !== 'itemId') },
        });
      }
      return toView(row);
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError(DUPLICATE_REFERENCE_MESSAGE);
    throw error;
  }
}

/** Archive an item (submitter withdraws it, or a reviewer retires it). */
export async function archiveResearchItem(
  ctx: ServiceContext,
  input: { itemId: string; reason?: string },
): Promise<ResearchItemView> {
  const data = parseInput(archiveResearchItemSchema, input);
  requireMember(ctx);
  const item = await loadItem(ctx, data.itemId);
  if (!canSee(ctx, item)) throw new NotFoundError('Research item');
  if (!isSubmitter(ctx, item)) {
    await authorize(ctx, 'canReviewResearch', { type: 'research_item', id: item.id });
  }
  if (item.status === 'archived') throw new InvalidStateError('This item is already archived.');
  assertTransition(item.status, 'archived');
  return withTransaction(ctx, async (tx) => {
    const [row] = await tx.db
      .update(researchItems)
      .set({ status: 'archived', updatedAt: tx.clock.now() })
      .where(and(eq(researchItems.id, item.id), ne(researchItems.status, 'archived')))
      .returning();
    if (!row) throw new InvalidStateError('This item is already archived.');
    await recordAudit(tx, {
      action: 'research.archived',
      targetType: 'research_item',
      targetId: item.id,
      context: { from: item.status, reason: data.reason ?? null },
    });
    return toView(row);
  });
}

export async function getResearchItem(
  ctx: ServiceContext,
  input: { itemId: string },
): Promise<ResearchItemView> {
  const { itemId } = parseInput(itemIdSchema, input);
  await authorize(ctx, 'canViewMembers', { type: 'research_item', id: itemId });
  const item = await loadItem(ctx, itemId);
  if (!canSee(ctx, item)) throw new NotFoundError('Research item');
  return toView(item);
}

function likePattern(value: string): string {
  return `%${value.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
}

/** Browse and search the library. Archived items: reviewers, or your own. */
export async function listResearchItems(
  ctx: ServiceContext,
  input: ListResearchInput = {},
): Promise<Page<ResearchItemView>> {
  await authorize(ctx, 'canViewMembers', { type: 'research_item' });
  const q = parseInput(listResearchSchema, input);
  const userId = ctx.actor.kind === 'user' ? ctx.actor.userId : null;
  const filters: SQL[] = [isNull(researchItems.deletedAt)];
  if (q.status) filters.push(eq(researchItems.status, q.status));
  else filters.push(ne(researchItems.status, 'archived'));
  const ownOnly = q.mine || (q.status === 'archived' && !isReviewer(ctx));
  if (ownOnly) {
    if (!userId) return { items: [], total: 0, limit: q.limit, offset: q.offset };
    filters.push(eq(researchItems.submittedByUserId, userId));
  }
  if (q.topic) filters.push(sql`lower(${researchItems.topic}) = lower(${q.topic})`);
  if (q.tag) filters.push(sql`${researchItems.tags} @> array[${q.tag}]::text[]`);
  if (q.q) {
    const pattern = likePattern(q.q);
    filters.push(
      or(
        ilike(researchItems.title, pattern),
        ilike(researchItems.summary, pattern),
        ilike(researchItems.doi, pattern),
      )!,
    );
  }
  const where = and(...filters);
  const [rows, [count]] = await Promise.all([
    ctx.db
      .select()
      .from(researchItems)
      .where(where)
      .orderBy(desc(researchItems.createdAt), desc(researchItems.id))
      .limit(q.limit)
      .offset(q.offset),
    ctx.db
      .select({ total: sql<number>`count(*)::int` })
      .from(researchItems)
      .where(where),
  ]);
  return { items: rows.map(toView), total: count?.total ?? 0, limit: q.limit, offset: q.offset };
}
