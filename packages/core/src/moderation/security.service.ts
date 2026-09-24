import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import {
  members,
  securityAction,
  securityEvents,
  type SecurityEvidence,
  securityTrigger,
  users,
} from '@jave/database';
import { recordAudit } from '../audit/audit.service';
import { publishEvent } from '../events/bus';
import { upsertDiscordUser } from '../identity/users.service';
import { type ServiceContext, withTransaction } from '../kernel/context';
import { ConflictError, InvalidStateError, NotFoundError, ValidationError } from '../kernel/errors';
import { redactString, truncate } from '../kernel/redact';
import { parseInput } from '../kernel/validation';
import { notifyCapabilityHolders } from '../notifications/notifications.service';
import { authorize } from '../permissions/authorize';
import { getSettings } from '../settings/settings.service';
import {
  enqueueAlertPost,
  enqueueAlertRefresh,
  type SecurityActionKey,
  type SecurityEventRecord,
  type SecurityEventStatusKey,
  TRIGGER_LABELS,
} from './alerts';
import {
  ALERT_RECIPIENT_LIMIT,
  EVIDENCE_EXCERPT_MAX,
  EVIDENCE_MAX_MESSAGE_IDS,
  EVIDENCE_MAX_SIGNALS,
  MAX_DEDUPE_KEY_LENGTH,
  MAX_REVIEW_NOTE_LENGTH,
  MAX_SCAN_CHARS,
  SIGNAL_DETAIL_INPUT_MAX,
} from './constants';
import { securityReference } from './copy';
import type { SecurityTriggerKey } from './engine/automod';
import { stripInvisible } from './engine/normalize';
import { signalDetail } from './engine/risk';
import {
  loadSecurityEventView,
  type SecuritySourceKey,
  type SecurityEventView,
} from './security.query';
import { deny, loadTarget, rankOf, requireSystemActor } from './targets';

const snowflake = z.string().regex(/^\d{17,20}$/, 'must be a Discord ID');

export const discordProfileSchema = z.object({
  discordId: snowflake,
  username: z.string().trim().min(1).max(64),
  displayName: z.string().max(64).nullish(),
  avatarHash: z.string().max(128).nullish(),
  isBot: z.boolean().optional(),
});

export const signalInputSchema = z.object({
  key: z.string().regex(/^[a-z][a-z_]{0,39}$/, 'signal keys are snake_case'),
  weight: z.number().min(0).max(100),
  detail: z.string().max(SIGNAL_DETAIL_INPUT_MAX).optional(),
});

export interface EvidenceInput {
  signals: readonly z.infer<typeof signalInputSchema>[];
  channelId?: string | null;
  messageIds?: readonly string[];
  excerpt?: string | null;
  extra?: Record<string, unknown>;
}

/** Evidence is bounded: capped signals, message IDs, and a redacted, truncated excerpt. */
export function buildEvidence(input: EvidenceInput): SecurityEvidence {
  const excerpt = input.excerpt
    ? truncate(redactString(stripInvisible(input.excerpt)).trim(), EVIDENCE_EXCERPT_MAX)
    : undefined;
  return {
    ...input.extra,
    signals: input.signals.slice(0, EVIDENCE_MAX_SIGNALS).map((s) => ({
      key: s.key,
      weight: Math.round(s.weight),
      ...(s.detail && { detail: signalDetail(s.detail) }),
    })),
    ...(input.channelId && { channelId: input.channelId }),
    ...(input.messageIds?.length && {
      messageIds: [...new Set(input.messageIds)].slice(0, EVIDENCE_MAX_MESSAGE_IDS),
    }),
    ...(excerpt && { excerpt }),
  };
}

export interface SecurityEventInsert {
  userId: string | null;
  trigger: SecurityTriggerKey;
  riskScore: number;
  source: SecuritySourceKey;
  evidence: SecurityEvidence;
  actionTaken: SecurityActionKey;
  channelId: string | null;
  reportedByUserId: string | null;
  dedupeKey: string | null;
  /** Fan out a `security.alert` to staff (default true). */
  notifyStaff?: boolean;
}

/** Plain, markdown-free label for a user in staff notifications. */
function safeLabel(username: string): string {
  return username.replace(/[^\w.-]/g, '').slice(0, 32) || 'unknown';
}

/**
 * Internal: insert a security event with its outbox side effects (domain
 * event, staff alert, alert card). Idempotent on `dedupeKey`: a duplicate
 * returns the existing event with `created: false` and no side effects.
 */
export async function createSecurityEvent(
  ctx: ServiceContext,
  input: SecurityEventInsert,
): Promise<{ event: SecurityEventRecord; created: boolean }> {
  const now = ctx.clock.now();
  const [inserted] = await ctx.db
    .insert(securityEvents)
    .values({
      userId: input.userId,
      riskScore: Math.max(0, Math.min(100, Math.round(input.riskScore))),
      trigger: input.trigger,
      source: input.source,
      evidence: input.evidence,
      actionTaken: input.actionTaken,
      channelId: input.channelId,
      reportedByUserId: input.reportedByUserId,
      dedupeKey: input.dedupeKey,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: securityEvents.dedupeKey })
    .returning();
  if (!inserted) {
    const [existing] = await ctx.db
      .select()
      .from(securityEvents)
      .where(eq(securityEvents.dedupeKey, input.dedupeKey ?? ''));
    if (!existing) throw new ConflictError('Security event could not be recorded.');
    return { event: existing, created: false };
  }

  let subjectMemberId: string | null = null;
  let subjectLabel = 'no specific user';
  if (input.userId) {
    const [subject] = await ctx.db
      .select({ memberId: members.id, username: users.username })
      .from(users)
      .leftJoin(members, and(eq(members.userId, users.id), isNull(members.deletedAt)))
      .where(eq(users.id, input.userId));
    subjectMemberId = subject?.memberId ?? null;
    subjectLabel = subject ? `@${safeLabel(subject.username)}` : 'unknown user';
  }
  const reference = securityReference(inserted.number);
  await publishEvent(ctx, {
    type: 'security.event_raised',
    aggregateType: 'security_event',
    aggregateId: inserted.id,
    subjectMemberId,
    payload: {
      securityEventId: inserted.id,
      number: inserted.number,
      trigger: inserted.trigger,
      riskScore: inserted.riskScore,
      actionTaken: inserted.actionTaken,
      source: inserted.source,
    },
  });

  if (input.notifyStaff ?? true) {
    const settings = await getSettings(ctx, 'moderation');
    const critical = inserted.riskScore >= settings.quarantineRiskScore;
    await notifyCapabilityHolders(
      ctx,
      'canViewSecurityEvents',
      {
        type: 'security.alert',
        title: `${critical ? 'SECURITY ALERT' : 'SECURITY EVENT'} — ${TRIGGER_LABELS[inserted.trigger]}`,
        body: `${reference} · risk ${inserted.riskScore}/100 · ${subjectLabel} · action ${inserted.actionTaken.replace('_', ' ')}`,
        severity: critical ? 'critical' : 'notice',
        // Below the quarantine threshold: dashboard inbox only, no DM.
        ...(!critical && { channels: [] }),
        dedupeKey: `security:${inserted.id}`,
        data: { securityEventId: inserted.id },
      },
      {
        limit: ALERT_RECIPIENT_LIMIT,
        excludeUserIds: [input.userId, input.reportedByUserId].filter((id): id is string =>
          Boolean(id),
        ),
      },
    );
  }
  await enqueueAlertPost(ctx, inserted.id);
  return { event: inserted, created: true };
}

export const recordSecurityEventSchema = z
  .object({
    targetUserId: z.uuid().optional(),
    targetDiscordId: snowflake.optional(),
    /** System actors only: the Discord profile as seen by the gateway (upserted). */
    discordUser: discordProfileSchema.optional(),
    trigger: z.enum(securityTrigger.enumValues),
    riskScore: z.number().int().min(0).max(100),
    signals: z.array(signalInputSchema).max(EVIDENCE_MAX_SIGNALS).default([]),
    channelId: snowflake.optional(),
    messageIds: z.array(snowflake).max(EVIDENCE_MAX_MESSAGE_IDS).default([]),
    excerpt: z.string().max(MAX_SCAN_CHARS).optional(),
    actionTaken: z.enum(securityAction.enumValues).default('none'),
    dedupeKey: z.string().trim().min(1).max(MAX_DEDUPE_KEY_LENGTH).optional(),
  })
  .refine((v) => [v.targetUserId, v.targetDiscordId, v.discordUser].filter(Boolean).length <= 1, {
    message: 'Give at most one of targetUserId, targetDiscordId or discordUser.',
  });

/** Staff and integrations file reports; they cannot claim an action was taken. */
const MANUAL_ACTIONS: readonly SecurityActionKey[] = ['none', 'flagged'];

/**
 * Record a security event. System/bot: any trigger and action, may pass the
 * gateway's Discord profile. Integrations and staff need canModerate and
 * record no action (`none` / `flagged`); staff file `manual_report`s only.
 * Dedupe keys from non-system callers are namespaced so they can never
 * collide with (and suppress) automated detections.
 */
export async function recordSecurityEvent(
  ctx: ServiceContext,
  input: z.input<typeof recordSecurityEventSchema>,
): Promise<SecurityEventView & { created: boolean }> {
  const data = parseInput(recordSecurityEventSchema, input);
  const actor = ctx.actor;
  if (actor.kind !== 'system') {
    await authorize(ctx, 'canModerate', { type: 'security_event' });
    if (data.discordUser) {
      throw new ValidationError('Identify the user by targetUserId or targetDiscordId.');
    }
    // Only the bot's own detections record an action actually taken.
    if (!MANUAL_ACTIONS.includes(data.actionTaken)) {
      throw new ValidationError('Reports record no action. Open a moderation case instead.');
    }
  }
  if (actor.kind === 'user' && data.trigger !== 'manual_report') {
    throw new ValidationError('Staff reports use the manual_report trigger.');
  }

  let userId: string | null = null;
  if (data.discordUser) {
    userId = (await upsertDiscordUser(ctx, data.discordUser)).id;
  } else if (data.targetUserId || data.targetDiscordId) {
    const target = await loadTarget(
      ctx,
      data.targetUserId ? { userId: data.targetUserId } : { discordId: data.targetDiscordId ?? '' },
    );
    userId = target.userId;
  }

  const source: SecuritySourceKey =
    actor.kind === 'user' ? 'manual' : actor.kind === 'integration' ? 'integration' : 'system';
  const dedupeKey = !data.dedupeKey
    ? null
    : actor.kind === 'user'
      ? `manual:${actor.userId}:${data.dedupeKey}`
      : actor.kind === 'integration'
        ? `integration:${actor.integrationId}:${data.dedupeKey}`
        : data.dedupeKey;

  const result = await withTransaction(ctx, async (tx) => {
    const outcome = await createSecurityEvent(tx, {
      userId,
      trigger: data.trigger,
      riskScore: data.riskScore,
      source,
      evidence: buildEvidence({
        signals: data.signals,
        channelId: data.channelId,
        messageIds: data.messageIds,
        excerpt: data.excerpt,
      }),
      actionTaken: data.actionTaken,
      channelId: data.channelId ?? null,
      reportedByUserId: actor.kind === 'user' ? actor.userId : null,
      dedupeKey: dedupeKey?.slice(0, MAX_DEDUPE_KEY_LENGTH) ?? null,
    });
    if (outcome.created && actor.kind !== 'system') {
      await recordAudit(tx, {
        action: 'security.event_reported',
        targetType: 'security_event',
        targetId: outcome.event.id,
        context: {
          event: securityReference(outcome.event.number),
          trigger: data.trigger,
          riskScore: data.riskScore,
          subjectUserId: userId,
        },
      });
    }
    return outcome;
  });
  return { ...(await loadSecurityEventView(ctx, result.event.id)), created: result.created };
}

export const reviewSecurityEventSchema = z.object({
  securityEventId: z.uuid(),
  status: z.enum(['acknowledged', 'dismissed', 'actioned']),
  note: z.string().trim().max(MAX_REVIEW_NOTE_LENGTH).optional(),
});

/** open → acknowledged | dismissed | actioned; acknowledged → dismissed | actioned. */
const REVIEW_TRANSITIONS: Record<SecurityEventStatusKey, readonly SecurityEventStatusKey[]> = {
  open: ['acknowledged', 'dismissed', 'actioned'],
  acknowledged: ['dismissed', 'actioned'],
  dismissed: [],
  actioned: [],
};

/**
 * Triage a security event (canViewSecurityEvents). You cannot review an
 * event about yourself, or about staff at or above your rank.
 */
export async function reviewSecurityEvent(
  ctx: ServiceContext,
  input: z.input<typeof reviewSecurityEventSchema>,
): Promise<SecurityEventView> {
  const data = parseInput(reviewSecurityEventSchema, input);
  await authorize(ctx, 'canViewSecurityEvents', {
    type: 'security_event',
    id: data.securityEventId,
  });
  const [event] = await ctx.db
    .select()
    .from(securityEvents)
    .where(eq(securityEvents.id, data.securityEventId));
  if (!event) throw new NotFoundError('Security event');
  if (!REVIEW_TRANSITIONS[event.status].includes(data.status)) {
    throw new InvalidStateError(
      `${securityReference(event.number)} is ${event.status}; it cannot become ${data.status}.`,
    );
  }
  const actor = ctx.actor;
  if (actor.kind === 'user' && event.userId) {
    if (event.userId === actor.userId) {
      await deny(ctx, 'You cannot review a security event about yourself.', {
        type: 'security_event',
        id: event.id,
      });
    }
    const subject = await loadTarget(ctx, { userId: event.userId });
    if (rankOf(subject.roles) >= rankOf(actor.roles)) {
      await deny(ctx, 'Events about staff at or above your rank are reviewed by higher rank.', {
        type: 'security_event',
        id: event.id,
      });
    }
  }

  await withTransaction(ctx, async (tx) => {
    const now = tx.clock.now();
    const [updated] = await tx.db
      .update(securityEvents)
      .set({
        status: data.status,
        reviewedByUserId: actor.kind === 'user' ? actor.userId : null,
        reviewedAt: now,
        reviewNote: data.note || null,
        updatedAt: now,
      })
      .where(and(eq(securityEvents.id, event.id), eq(securityEvents.status, event.status)))
      .returning();
    if (!updated) {
      throw new ConflictError('Someone else reviewed this event just now. Refresh and retry.');
    }
    await recordAudit(tx, {
      action: 'security.event_reviewed',
      targetType: 'security_event',
      targetId: event.id,
      context: {
        event: securityReference(event.number),
        from: event.status,
        to: data.status,
        note: data.note ?? null,
      },
    });
    await publishEvent(tx, {
      type: 'security.event_reviewed',
      aggregateType: 'security_event',
      aggregateId: event.id,
      payload: { securityEventId: event.id, from: event.status, to: data.status },
    });
    await enqueueAlertRefresh(tx, updated);
  });
  return loadSecurityEventView(ctx, event.id);
}

export const markSecurityAlertPostedSchema = z.object({
  securityEventId: z.uuid(),
  channelId: snowflake,
  messageId: snowflake,
});

/** Bot callback for `discord.moderation.alert` (post): remember the card to edit later. System only. */
export async function markSecurityAlertPosted(
  ctx: ServiceContext,
  input: z.input<typeof markSecurityAlertPostedSchema>,
): Promise<void> {
  const data = parseInput(markSecurityAlertPostedSchema, input);
  await requireSystemActor(ctx, { type: 'security_event', id: data.securityEventId });
  const rows = await ctx.db
    .update(securityEvents)
    .set({
      alertChannelId: data.channelId,
      alertMessageId: data.messageId,
      updatedAt: ctx.clock.now(),
    })
    .where(eq(securityEvents.id, data.securityEventId))
    .returning({ id: securityEvents.id });
  if (rows.length === 0) throw new NotFoundError('Security event');
}
