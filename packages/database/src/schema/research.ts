import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { createdAt, deletedAt, id, snowflake, ts, updatedAt } from './_shared';
import { users } from './identity';

export const researchStatus = pgEnum('research_status', [
  'new',
  'needs_review',
  'reviewed',
  'verified',
  'archived',
]);

export const evidenceLevel = pgEnum('evidence_level', [
  'unknown',
  'anecdotal',
  'observational',
  'experimental',
  'peer_reviewed',
  'meta_analysis',
]);

export const sidusSyncStatus = pgEnum('sidus_sync_status', [
  'not_synced',
  'pending',
  'synced',
  'failed',
]);

/** Outcome of metadata enrichment (Crossref / arXiv). */
export const researchEnrichmentStatus = pgEnum('research_enrichment_status', [
  'pending',
  'enriched',
  'not_found',
  'failed',
  'skipped',
]);

/** SIDUS SCIENCE research items. Discord messages can become research items. */
export const researchItems = pgTable(
  'research_items',
  {
    id: id(),
    title: varchar('title', { length: 300 }).notNull(),
    /** True while the title is a heuristic guess; enrichment may replace it. */
    titleGuessed: boolean('title_guessed').notNull().default(false),
    authors: text('authors')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    source: varchar('source', { length: 120 }),
    url: text('url'),
    /** Normalized URL used for dedupe. */
    canonicalUrl: text('canonical_url'),
    doi: varchar('doi', { length: 200 }),
    arxivId: varchar('arxiv_id', { length: 32 }),
    topic: varchar('topic', { length: 80 }),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    summary: text('summary'),
    evidenceLevel: evidenceLevel('evidence_level').notNull().default('unknown'),
    status: researchStatus('status').notNull().default('new'),
    publishedOn: date('published_on', { mode: 'string' }),
    submittedByUserId: uuid('submitted_by_user_id')
      .notNull()
      .references(() => users.id),
    reviewedByUserId: uuid('reviewed_by_user_id').references(() => users.id),
    reviewedAt: ts('reviewed_at'),
    discordMessageId: snowflake('discord_message_id'),
    discordMessageUrl: text('discord_message_url'),
    enrichmentStatus: researchEnrichmentStatus('enrichment_status').notNull().default('pending'),
    enrichedAt: ts('enriched_at'),
    enrichmentError: text('enrichment_error'),
    sidusSyncStatus: sidusSyncStatus('sidus_sync_status').notNull().default('not_synced'),
    sidusExternalId: varchar('sidus_external_id', { length: 128 }),
    sidusSyncedAt: ts('sidus_synced_at'),
    /** Why the last sync did not happen or failed (e.g. integration not configured). */
    sidusSyncError: text('sidus_sync_error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex('research_items_doi_uq').on(t.doi),
    uniqueIndex('research_items_canonical_url_uq').on(t.canonicalUrl),
    uniqueIndex('research_items_discord_message_uq').on(t.discordMessageId),
    uniqueIndex('research_items_arxiv_uq').on(t.arxivId),
    index('research_items_status_idx').on(t.status, t.createdAt),
    index('research_items_submitter_idx').on(t.submittedByUserId, t.createdAt),
  ],
);
