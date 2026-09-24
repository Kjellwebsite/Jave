import { count, eq } from 'drizzle-orm';
import { z } from 'zod';
import { members, users, verificationEvidence, verifications } from '@jave/database';
import type { ServiceContext } from '../kernel/context';
import { ForbiddenError, NotFoundError } from '../kernel/errors';
import { parseInput } from '../kernel/validation';
import { enqueueJob } from '../jobs/queue';
import { authorize } from '../permissions/authorize';
import { getSettings } from '../settings/settings.service';
import { STATUS_LABELS, TYPE_LABELS } from './copy';
import { loadVerification } from './repository';
import { type OpenedBy, openedBy, verificationReference } from './rules';
import { queueCardPostedSchema } from './schemas';
import type { VerificationStatus, VerificationType } from './types';

/**
 * Discord job contract — `discord.verification.queue_card`
 *
 * Keeps one staff-facing card per verification in the channel configured at
 * `settings.channels.verificationQueue`. Enqueued (inside the same
 * transaction as the state change) when a verification is requested,
 * assigned, taken into review, decided, revoked or expired — but only when
 * the queue channel is configured or a card already exists.
 *
 * The bot must:
 *  1. Parse the payload with `queueCardJobPayloadSchema`; on failure throw
 *     PermanentJobError.
 *  2. Call `getQueueCard(ctx, payload.verificationId)` with the worker's
 *     system context. It returns everything to render, including
 *     `channelId` / `messageId`.
 *  3. If `channelId` is null, complete without acting (queue channel unset).
 *  4. If `messageId` is set, edit that message in `channelId`; if Discord
 *     answers Unknown Message, post a new one instead. Otherwise post a new
 *     message in `channelId`.
 *  5. Render with `panel()`: title `${reference} — ${typeLabel}`, the status
 *     label, subject display name + handle, target label, claim, evidence
 *     count, requested / expires timestamps and the assigned verifier.
 *     `claim`, `targetLabel` and names are user-provided: pass them through
 *     `userText()`. Send with `allowedMentions: { parse: [] }`. Evidence URLs
 *     and decision notes stay in the dashboard — never on the card.
 *  6. Report the result with `markQueueCardPosted(ctx, { verificationId,
 *     channelId, messageId })`.
 *
 * Idempotent: re-running edits the same message. The card always reflects
 * the state at render time, not at enqueue time.
 *
 * Discord permissions (queue channel only): View Channel, Send Messages,
 * Embed Links, Read Message History.
 */
export const VERIFICATION_QUEUE_CARD_JOB = 'discord.verification.queue_card';

export const queueCardJobPayloadSchema = z.object({ verificationId: z.uuid() });
export type QueueCardJobPayload = z.infer<typeof queueCardJobPayloadSchema>;

/** Everything the bot needs to render a queue card. */
export interface QueueCard {
  verificationId: string;
  reference: string;
  type: VerificationType;
  typeLabel: string;
  status: VerificationStatus;
  statusLabel: string;
  claim: string;
  targetLabel: string;
  facetKey: string | null;
  requestedRank: string | null;
  grantedRank: string | null;
  subject: { memberId: string; handle: string; displayName: string };
  assignedVerifierName: string | null;
  openedBy: OpenedBy;
  evidenceCount: number;
  requestedAt: Date;
  expiresAt: Date | null;
  decidedAt: Date | null;
  /** Channel to post in: the existing card's channel, else the configured queue channel. */
  channelId: string | null;
  /** Existing card message to edit, if any. */
  messageId: string | null;
}

/** Enqueue a card refresh for the verification's current state (no-op when cards are off). */
export async function enqueueQueueCard(
  tx: ServiceContext,
  verification: {
    id: string;
    status: VerificationStatus;
    assignedVerifierUserId: string | null;
    queueMessageId: string | null;
  },
): Promise<number | null> {
  const channels = await getSettings(tx, 'channels');
  if (!channels.verificationQueue && !verification.queueMessageId) return null;
  const assignee = verification.assignedVerifierUserId ?? 'none';
  return enqueueJob(
    tx,
    VERIFICATION_QUEUE_CARD_JOB,
    { verificationId: verification.id },
    { dedupeKey: `verification-card:${verification.id}:${verification.status}:${assignee}` },
  );
}

async function displayName(ctx: ServiceContext, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const [row] = await ctx.db
    .select({ displayName: users.displayName, username: users.username })
    .from(users)
    .where(eq(users.id, userId));
  return row ? (row.displayName ?? row.username) : null;
}

/** Card data for the bot. System actors (the worker) and verifiers only. */
export async function getQueueCard(
  ctx: ServiceContext,
  verificationId: string,
): Promise<QueueCard> {
  const { verificationId: id } = parseInput(queueCardJobPayloadSchema, { verificationId });
  await authorize(ctx, 'canVerifyMembers', { type: 'verification', id });
  const v = await loadVerification(ctx, id);
  const [[subject], [evidence], channels, assignedVerifierName] = await Promise.all([
    ctx.db
      .select({ handle: members.handle, displayName: members.displayName })
      .from(members)
      .where(eq(members.id, v.subjectMemberId)),
    ctx.db
      .select({ value: count() })
      .from(verificationEvidence)
      .where(eq(verificationEvidence.verificationId, v.id)),
    getSettings(ctx, 'channels'),
    displayName(ctx, v.assignedVerifierUserId),
  ]);
  return {
    verificationId: v.id,
    reference: verificationReference(v.number),
    type: v.type,
    typeLabel: TYPE_LABELS[v.type],
    status: v.status,
    statusLabel: STATUS_LABELS[v.status],
    claim: v.claim,
    targetLabel: v.targetLabel,
    facetKey: v.facetKey,
    requestedRank: v.requestedRank,
    grantedRank: v.grantedRank,
    subject: {
      memberId: v.subjectMemberId,
      handle: subject?.handle ?? '',
      displayName: subject?.displayName ?? '',
    },
    assignedVerifierName,
    openedBy: openedBy(v),
    evidenceCount: evidence?.value ?? 0,
    requestedAt: v.requestedAt,
    expiresAt: v.expiresAt,
    decidedAt: v.decidedAt,
    channelId: v.queueChannelId ?? channels.verificationQueue ?? null,
    messageId: v.queueMessageId,
  };
}

/**
 * Bot callback: the card for `verificationId` now lives at
 * (`channelId`, `messageId`). Only the worker's system actor may call it.
 */
export async function markQueueCardPosted(
  ctx: ServiceContext,
  input: z.input<typeof queueCardPostedSchema>,
): Promise<void> {
  if (ctx.actor.kind !== 'system')
    throw new ForbiddenError('Only the JAVE worker reports queue cards.');
  const data = parseInput(queueCardPostedSchema, input);
  const rows = await ctx.db
    .update(verifications)
    .set({ queueChannelId: data.channelId, queueMessageId: data.messageId })
    .where(eq(verifications.id, data.verificationId))
    .returning({ id: verifications.id });
  if (rows.length === 0) throw new NotFoundError('Verification');
}
