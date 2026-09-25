import { isNull } from 'drizzle-orm';
import { z } from 'zod';
import { inviteCodes, securityTrigger } from '@jave/database';
import { activeRoles, findMemberByDiscordId, upsertDiscordUser } from '../identity/users.service';
import { DAY, MINUTE } from '../kernel/clock';
import { type ServiceContext, withTransaction } from '../kernel/context';
import { ConflictError, InvalidStateError } from '../kernel/errors';
import { snowflakeToDate } from '../kernel/ids';
import { parseInput } from '../kernel/validation';
import { getSettings } from '../settings/settings.service';
import { type SecurityActionKey, TRIGGER_LABELS } from './alerts';
import { executeCase, loadLiveCases, timeoutInForce } from './case-engine';
import {
  EVIDENCE_MAX_MESSAGE_IDS,
  EVIDENCE_MAX_SIGNALS,
  INVITE_CODES_CACHE_MS,
  MAX_OWN_INVITE_CODES,
  MAX_RECENT_MESSAGES,
  MAX_SCAN_CHARS,
  SIGNAL_DETAIL_INPUT_MAX,
} from './constants';
import { securityReference } from './copy';
import { enqueueDiscordJob, moderationDeleteMessagesContract } from './discord-jobs';
import { type AutomodEvaluation, evaluateMessage } from './engine/automod';
import { type AutomodAction, MAX_RISK_MULTIPLIER, signalDetail } from './engine/risk';
import {
  buildEvidence,
  createSecurityEvent,
  discordProfileSchema,
  signalInputSchema,
} from './security.service';
import { holdsStaffRole, loadTarget, requireSystemActor } from './targets';

const snowflake = z.string().regex(/^\d{17,20}$/, 'must be a Discord ID');
const inviteCode = z.string().regex(/^[A-Za-z0-9-]{2,32}$/);

/** Hard cap on message content accepted for screening (Discord's own limit is 4000). */
export const MAX_MESSAGE_INPUT = 16_000;
/** Hard cap on the mention count accepted (Discord caps real mentions far lower). */
export const MAX_MENTION_COUNT_INPUT = 1000;
const MAX_EXTRA_INVITE_CODES = 50;
const MAX_MODIFIERS = 8;
const OWN_INVITE_CODES_CACHE_KEY = 'moderation:own-invite-codes';

const ACTION_TAKEN: Record<Exclude<AutomodAction, 'none'>, SecurityActionKey> = {
  delete: 'message_deleted',
  timeout: 'timeout',
  quarantine: 'quarantine',
};

export const automodEvaluationSchema = z.object({
  signals: z.array(signalInputSchema).max(EVIDENCE_MAX_SIGNALS),
  modifiers: z
    .array(
      z.object({
        key: z.string().regex(/^[a-z][a-z_]{0,39}$/),
        factor: z.number().min(1).max(MAX_RISK_MULTIPLIER),
        detail: z.string().max(SIGNAL_DETAIL_INPUT_MAX),
      }),
    )
    .max(MAX_MODIFIERS)
    .default([]),
  riskScore: z.number().int().min(0).max(100),
  action: z.enum(['none', 'delete', 'timeout', 'quarantine']),
  trigger: z.enum(securityTrigger.enumValues).nullable(),
  exempt: z.boolean().default(false),
});

export const applyAutomodDecisionSchema = z.object({
  discordUser: discordProfileSchema,
  evaluation: automodEvaluationSchema,
  channelId: snowflake,
  messageIds: z.array(snowflake).min(1).max(EVIDENCE_MAX_MESSAGE_IDS),
  excerpt: z.string().max(MAX_MESSAGE_INPUT).optional(),
});

export interface AutomodOutcome {
  /** What was actually done (may be less than the evaluation asked for). */
  applied: AutomodAction | 'flagged';
  securityEventId: string | null;
  caseId: string | null;
  /** The same message was already processed (at-least-once delivery). */
  duplicate: boolean;
  /** Why the decision was downgraded, if it was. */
  note: string | null;
}

const NOTHING: AutomodOutcome = {
  applied: 'none',
  securityEventId: null,
  caseId: null,
  duplicate: false,
  note: null,
};

/**
 * Act on an automod evaluation (system only): record a security event, delete
 * the flagged messages, and for timeout/quarantine open an automod case
 * (moderatorUserId null). Staff and exempt roles are never actioned — their
 * events are recorded as `flagged` for human review. Idempotent per message.
 */
export async function applyAutomodDecision(
  ctx: ServiceContext,
  input: z.input<typeof applyAutomodDecisionSchema>,
): Promise<AutomodOutcome> {
  const data = parseInput(applyAutomodDecisionSchema, input);
  await requireSystemActor(ctx, { type: 'automod', id: null });
  const { evaluation } = data;
  const { trigger, action } = evaluation;
  if (action === 'none' || !trigger || evaluation.exempt) return NOTHING;

  const user = await upsertDiscordUser(ctx, data.discordUser);
  const target = await loadTarget(ctx, { userId: user.id });
  const settings = await getSettings(ctx, 'moderation');
  const protectedTarget =
    holdsStaffRole(target.roles) ||
    target.roles.some((role) => settings.exemptRoles.includes(role));
  const firstMessageId = data.messageIds[0] ?? '';
  const evidence = buildEvidence({
    signals: evaluation.signals,
    channelId: data.channelId,
    messageIds: data.messageIds,
    excerpt: data.excerpt?.slice(0, MAX_SCAN_CHARS),
    extra: {
      modifiers: evaluation.modifiers.map((m) => ({ ...m, detail: signalDetail(m.detail) })),
    },
  });

  return withTransaction(ctx, async (tx): Promise<AutomodOutcome> => {
    const { event, created } = await createSecurityEvent(tx, {
      userId: target.userId,
      trigger,
      riskScore: evaluation.riskScore,
      source: 'automod',
      evidence,
      actionTaken: protectedTarget ? 'flagged' : ACTION_TAKEN[action],
      channelId: data.channelId,
      reportedByUserId: null,
      dedupeKey: `automod:${firstMessageId}`,
    });
    const base = { securityEventId: event.id, caseId: null, duplicate: false };
    if (!created) return { ...base, applied: 'none', duplicate: true, note: 'already processed' };
    if (protectedTarget) {
      return { ...base, applied: 'flagged', note: 'author is staff or exempt; flagged for review' };
    }

    const reference = securityReference(event.number);
    await enqueueDiscordJob(
      tx,
      moderationDeleteMessagesContract,
      {
        channelId: data.channelId,
        messageIds: data.messageIds,
        auditReason: `JAVE automod ${reference} — ${TRIGGER_LABELS[trigger]}`,
        securityEventId: event.id,
      },
      { dedupeKey: `automod-delete:${firstMessageId}` },
    );
    if (action === 'delete') return { ...base, applied: 'delete', note: null };

    const now = tx.clock.now();
    const live = await loadLiveCases(tx, target.userId);
    // A quarantine that never took effect in Discord does not restrain anyone:
    // escalate to a timeout instead of treating the author as handled.
    const quarantineHolds = live.quarantine !== null && live.quarantine.discordSync !== 'failed';
    if (live.ban || quarantineHolds) {
      return { ...base, applied: 'delete', note: 'already quarantined or banned' };
    }
    const caseAction = live.quarantine && action === 'quarantine' ? 'timeout' : action;
    if (caseAction === 'timeout' && timeoutInForce(live.timeout, now)) {
      return { ...base, applied: 'delete', note: 'already timed out' };
    }
    try {
      const record = await executeCase(tx, {
        action: caseAction,
        // The message itself proves the author is in the server.
        target: { ...target, inGuild: true },
        reason: `Automod: ${TRIGGER_LABELS[trigger].toLowerCase()}, risk ${evaluation.riskScore}/100 (${reference}).`,
        source: 'automod',
        durationSeconds: caseAction === 'timeout' ? settings.spamTimeoutSeconds : null,
        securityEventId: event.id,
      });
      return { ...base, applied: caseAction, caseId: record.id, note: null };
    } catch (error) {
      // A concurrent message already escalated this author: keep the event and deletion.
      if (error instanceof ConflictError || error instanceof InvalidStateError) {
        return { ...base, applied: 'delete', note: error.userMessage };
      }
      throw error;
    }
  });
}

/** This server's invite codes (mirrored by the invites module), cached briefly. */
async function loadOwnInviteCodes(ctx: ServiceContext): Promise<string[]> {
  return ctx.cache.getOrLoad(OWN_INVITE_CODES_CACHE_KEY, INVITE_CODES_CACHE_MS, async () => {
    const rows = await ctx.db
      .select({ code: inviteCodes.code })
      .from(inviteCodes)
      .where(isNull(inviteCodes.deletedAt))
      .limit(MAX_OWN_INVITE_CODES);
    return rows.map((row) => row.code);
  });
}

export const screenMessageSchema = z.object({
  author: discordProfileSchema,
  channelId: snowflake,
  messageId: snowflake,
  content: z.string().max(MAX_MESSAGE_INPUT),
  mentionCount: z.number().int().min(0).max(MAX_MENTION_COUNT_INPUT),
  mentionsEveryone: z.boolean().default(false),
  /** The author's earlier messages the bot remembers (content + time). */
  recent: z
    .array(z.object({ content: z.string().max(MAX_MESSAGE_INPUT), at: z.coerce.date() }))
    .max(MAX_RECENT_MESSAGES)
    .default([]),
  /** Extra allowed invite codes (e.g. the vanity URL). */
  extraInviteCodes: z.array(inviteCode).max(MAX_EXTRA_INVITE_CODES).default([]),
  /** Caller-level exemption (e.g. a channel where links are expected). */
  exempt: z.boolean().default(false),
});

export interface ScreenMessageResult {
  evaluation: AutomodEvaluation;
  outcome: AutomodOutcome;
}

/**
 * One-call automod for the bot's message handler (system only): resolves the
 * author's roles, account age and join time, evaluates the message against
 * the live settings, and applies the decision.
 */
export async function screenMessage(
  ctx: ServiceContext,
  input: z.input<typeof screenMessageSchema>,
): Promise<ScreenMessageResult> {
  const data = parseInput(screenMessageSchema, input);
  await requireSystemActor(ctx, { type: 'automod', id: null });
  const [moderation, security] = await Promise.all([
    getSettings(ctx, 'moderation'),
    getSettings(ctx, 'security'),
  ]);
  const now = ctx.clock.now();
  const member = await findMemberByDiscordId(ctx, data.author.discordId);
  const roles = member ? await activeRoles(ctx, member.id) : [];
  const evaluation = evaluateMessage({
    content: data.content,
    mentionCount: data.mentionCount,
    mentionsEveryone: data.mentionsEveryone,
    authorRoles: roles,
    accountAgeDays: (now.getTime() - snowflakeToDate(data.author.discordId).getTime()) / DAY,
    memberAgeMinutes: member?.joinedGuildAt
      ? (now.getTime() - member.joinedGuildAt.getTime()) / MINUTE
      : null,
    recent: data.recent,
    now,
    settings: moderation,
    ownInviteCodes: [...(await loadOwnInviteCodes(ctx)), ...data.extraInviteCodes],
    exempt: data.exempt || Boolean(data.author.isBot),
    raidMode: security.raidMode,
    newAccountDays: security.suspiciousAccountAgeDays,
  });
  if (evaluation.action === 'none') return { evaluation, outcome: NOTHING };
  const outcome = await applyAutomodDecision(ctx, {
    discordUser: data.author,
    evaluation,
    channelId: data.channelId,
    messageIds: [data.messageId],
    excerpt: data.content,
  });
  return { evaluation, outcome };
}
