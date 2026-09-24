import { index, integer, jsonb, pgEnum, pgTable, text, uuid, varchar } from 'drizzle-orm/pg-core';
import { createdAt, id, ts } from './_shared';
import { users } from './identity';

export const aiRequestStatus = pgEnum('ai_request_status', [
  'ok',
  'error',
  'refused',
  'rate_limited',
  'disabled',
  /** Reserved before the provider call so concurrent requests count against the daily limit. */
  'pending',
]);

/**
 * AI usage ledger. Prompts are not stored — only a hash, for abuse
 * investigation and dedupe, plus token accounting.
 */
export const aiRequests = pgTable(
  'ai_requests',
  {
    id: id(),
    userId: uuid('user_id').references(() => users.id),
    feature: varchar('feature', { length: 32 }).notNull(),
    /** 'discord' | 'dashboard'. */
    surface: varchar('surface', { length: 16 }),
    provider: varchar('provider', { length: 32 }).notNull(),
    model: varchar('model', { length: 64 }).notNull(),
    status: aiRequestStatus('status').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    latencyMs: integer('latency_ms').notNull().default(0),
    errorCode: varchar('error_code', { length: 64 }),
    promptHash: varchar('prompt_hash', { length: 64 }),
    createdAt: createdAt(),
  },
  (t) => [
    index('ai_requests_user_idx').on(t.userId, t.createdAt),
    index('ai_requests_time_idx').on(t.createdAt),
  ],
);

export const aiProposalStatus = pgEnum('ai_proposal_status', [
  'pending',
  'confirmed',
  'executed',
  'rejected',
  'expired',
  'failed',
]);

/**
 * PREVIEW → CONFIRM → EXECUTE → REPORT.
 * AI output can only ever create a pending proposal. A human with the
 * capability required by `kind` must confirm before anything executes.
 */
export const aiActionProposals = pgTable(
  'ai_action_proposals',
  {
    id: id(),
    kind: varchar('kind', { length: 48 }).notNull(),
    requestedByUserId: uuid('requested_by_user_id')
      .notNull()
      .references(() => users.id),
    aiRequestId: uuid('ai_request_id').references(() => aiRequests.id),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    /** SHA-256 of the canonical payload shown in the preview; re-checked before execution. */
    payloadHash: varchar('payload_hash', { length: 64 }).notNull(),
    preview: text('preview').notNull(),
    status: aiProposalStatus('status').notNull().default('pending'),
    decidedByUserId: uuid('decided_by_user_id').references(() => users.id),
    decidedAt: ts('decided_at'),
    executedAt: ts('executed_at'),
    result: jsonb('result').$type<Record<string, unknown>>(),
    error: text('error'),
    expiresAt: ts('expires_at').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('ai_action_proposals_status_idx').on(t.status, t.createdAt),
    index('ai_action_proposals_requester_idx').on(t.requestedByUserId, t.status),
    index('ai_action_proposals_expiry_idx').on(t.status, t.expiresAt),
  ],
);
