import { getSettings, moderation } from '@jave/core';
import type { IncomingMessage, JoinedMember, MessageUpdate } from '../../gateway-events/types';
import type { BotServices } from '../../runtime';
import { systemContext } from './context';
import { isSnowflake } from './ids';

/** Discord's own message cap (Nitro). Longer content is odd input and truncated. */
export const MAX_STORED_CONTENT = 4000;
/** Authors tracked at once; the least recently active are forgotten first. */
export const MAX_TRACKED_AUTHORS = 5000;
const MS_PER_SECOND = 1000;
const PROFILE_TEXT_MAX = 64;
const AVATAR_HASH_MAX = 128;

interface RecentMessage {
  content: string;
  at: Date;
}

/**
 * Per-process memory of each author's recent messages (content + time) for
 * the spam-rate and duplicate signals. Bounded per author and in total; only
 * the current window is kept.
 */
export class RecentMessageWindow {
  private readonly byAuthor = new Map<string, RecentMessage[]>();

  constructor(
    private readonly maxAuthors = MAX_TRACKED_AUTHORS,
    private readonly maxPerAuthor = moderation.MAX_RECENT_MESSAGES,
  ) {}

  /** The author's earlier messages inside `horizonMs`; then remembers this one. */
  recordAndGet(authorId: string, message: RecentMessage, horizonMs: number): RecentMessage[] {
    const cutoff = message.at.getTime() - horizonMs;
    const kept = (this.byAuthor.get(authorId) ?? []).filter((m) => m.at.getTime() > cutoff);
    const earlier = [...kept];
    kept.push(message);
    if (kept.length > this.maxPerAuthor) kept.splice(0, kept.length - this.maxPerAuthor);
    // Re-insert so Map order is least-recently-active first.
    this.byAuthor.delete(authorId);
    this.byAuthor.set(authorId, kept);
    while (this.byAuthor.size > this.maxAuthors) {
      const oldest = this.byAuthor.keys().next().value;
      if (oldest === undefined) break;
      this.byAuthor.delete(oldest);
    }
    return earlier;
  }

  get trackedAuthors(): number {
    return this.byAuthor.size;
  }
}

const windows = new WeakMap<BotServices, RecentMessageWindow>();

export function recentWindowFor(services: BotServices): RecentMessageWindow {
  let window = windows.get(services);
  if (!window) {
    window = new RecentMessageWindow();
    windows.set(services, window);
  }
  return window;
}

function clampCount(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 0;
  return Math.max(0, Math.min(moderation.MAX_MENTION_COUNT_INPUT, n));
}

function profileText(value: string | null | undefined): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed.length > 0 ? trimmed.slice(0, PROFILE_TEXT_MAX) : null;
}

/** What automod screens, from a new message or an edit. */
interface ScreenedContent {
  guildId: string | null;
  channelId: string;
  messageId: string;
  author: IncomingMessage['author'];
  content: unknown;
  mentionCount: unknown;
  mentionsEveryone: unknown;
}

type ScreenKind = 'message' | 'edit';

/**
 * Automod for one message or edit. The pure engine runs first with no
 * exemptions and no own-invite list: it can only over-flag, so a clean result
 * there is clean for `screenMessage` too, and ordinary messages never touch
 * the database. Anything flagged goes through `screenMessage`, which resolves
 * the author's JAVE roles (exemptions come from JAVE roles, never Discord
 * roles), account age, raid mode and this server's invite codes, then
 * applies the decision. Idempotent per message ID in core, so a message
 * flagged when posted is not actioned twice when edited.
 */
async function screenContent(
  services: BotServices,
  input: ScreenedContent,
  kind: ScreenKind,
): Promise<void> {
  if (!input.guildId || input.guildId !== services.discord.guildId) return;
  if (input.author.bot) return;
  if (
    !isSnowflake(input.author.id) ||
    !isSnowflake(input.messageId) ||
    !isSnowflake(input.channelId)
  ) {
    return;
  }
  const ctx = systemContext(services, kind === 'edit' ? 'gateway:automod-edit' : 'gateway:automod');
  const settings = await getSettings(ctx, 'moderation');
  const now = services.clock.now();
  const content =
    typeof input.content === 'string' ? input.content.slice(0, MAX_STORED_CONTENT) : '';
  const mentionCount = clampCount(input.mentionCount);
  const mentionsEveryone = input.mentionsEveryone === true;
  const horizonMs =
    settings.spam.windowSeconds * moderation.DUPLICATE_WINDOW_FACTOR * MS_PER_SECOND;
  // An edit is not a new message: rate and duplicate signals were decided when
  // it was posted (it is already in the window), so edits screen content only.
  const recent =
    kind === 'message'
      ? recentWindowFor(services).recordAndGet(input.author.id, { content, at: now }, horizonMs)
      : [];

  const preview = moderation.evaluateMessage({
    content,
    mentionCount,
    mentionsEveryone,
    authorRoles: [],
    accountAgeDays: null,
    recent,
    now,
    settings,
    ownInviteCodes: [],
  });
  if (preview.action === 'none') return;

  const username = profileText(input.author.username) ?? input.author.id;
  const result = await moderation.screenMessage(ctx, {
    author: {
      discordId: input.author.id,
      username,
      displayName: profileText(input.author.globalName),
      avatarHash: input.author.avatar?.slice(0, AVATAR_HASH_MAX) ?? null,
      isBot: false,
    },
    channelId: input.channelId,
    messageId: input.messageId,
    content,
    mentionCount,
    mentionsEveryone,
    recent,
  });
  if (result.outcome.applied !== 'none') {
    ctx.logger.info(
      {
        messageId: input.messageId,
        channelId: input.channelId,
        kind,
        applied: result.outcome.applied,
        riskScore: result.evaluation.riskScore,
        trigger: result.evaluation.trigger,
      },
      'automod action',
    );
  }
  await services.runJobsNow(ctx.effects.jobIds);
}

/** Automod for a new message (see `screenContent`). */
export async function screenIncomingMessage(
  services: BotServices,
  message: IncomingMessage,
): Promise<void> {
  await screenContent(
    services,
    {
      guildId: message.guildId,
      channelId: message.channelId,
      messageId: message.id,
      author: message.author,
      content: message.content,
      mentionCount: message.mentionCount,
      mentionsEveryone: message.mentionsEveryone,
    },
    'message',
  );
}

/**
 * Automod for an edited message: posting something harmless and editing in
 * a scam link or foreign invite is screened like a new message would be.
 * Skipped: updates Discord makes itself (link embeds unfurling — the post
 * was screened when created, and screening it again could race that
 * decision), updates without an author, and webhook posts.
 */
export async function screenMessageEdit(
  services: BotServices,
  update: MessageUpdate,
): Promise<void> {
  if (!update.author || update.webhookId || update.contentEdited !== true) return;
  await screenContent(
    services,
    {
      guildId: update.guildId,
      channelId: update.channelId,
      messageId: update.id,
      author: update.author,
      content: update.content,
      mentionCount: update.mentionCount,
      mentionsEveryone: update.mentionsEveryone,
    },
    'edit',
  );
}

/**
 * Join screening: suspicious accounts, join bursts (auto raid mode per
 * settings), raid holds and re-applying live quarantines/bans on rejoin —
 * all decided by `screenJoin` from the join history in the database.
 */
export async function screenMemberJoin(services: BotServices, member: JoinedMember): Promise<void> {
  if (member.bot || !isSnowflake(member.id)) return;
  const ctx = systemContext(services, 'gateway:join-screening');
  const result = await moderation.screenJoin(ctx, {
    discordUser: {
      discordId: member.id,
      username: profileText(member.username) ?? member.id,
      displayName: profileText(member.globalName),
      avatarHash: member.avatar?.slice(0, AVATAR_HASH_MAX) ?? null,
      isBot: false,
    },
  });
  if (result.caseId || result.raidModeEnabled || result.reapplied) {
    ctx.logger.info(
      {
        userId: member.id,
        quarantined: Boolean(result.caseId),
        raidModeEnabled: result.raidModeEnabled,
        reapplied: result.reapplied,
        riskScore: result.evaluation.riskScore,
      },
      'join screening action',
    );
  }
  await services.runJobsNow(ctx.effects.jobIds);
}
